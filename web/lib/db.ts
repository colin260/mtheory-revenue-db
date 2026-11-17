// Uses DATABASE_URL (e.g. Supabase) when set, otherwise the local embedded copy
// created by `node load.mjs` in the parent folder.
import path from 'node:path';
import seedShows from './seed/projected_shows.json';
import seedUnderoath from './seed/underoath_merch.json';
import seedRetainers from './seed/retainers_2026.json';
import seedRefresh from './seed/sheet_refresh_2026_11.json';
import seedRefreshB from './seed/sheet_refresh_2026_11b.json';
import seedRefreshC from './seed/sheet_refresh_2026_11c.json';
import seedRefreshD from './seed/sheet_refresh_2026_11d.json';
import seedUnsupported from './seed/unsupported_2026.json';
import seedJoDeeAdj from './seed/jodee_adjustment.json';
import seedGreySlateFix from './seed/greyslate_fix.json';

type Run = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
type Db = { run: Run; tx: <T>(fn: (run: Run) => Promise<T>) => Promise<T> };
const g = globalThis as unknown as { __db?: Promise<Db> };

async function init(): Promise<Db> {
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
  if (process.env.DATABASE_URL) {
    const { Pool } = await import('pg');
    const url = process.env.DATABASE_URL;
    // Small pool: on serverless hosting every instance has its own, and the database has a fixed connection limit.
    const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
    return {
      run: (s, p) => pool.query(s, p as any[]),
      tx: async fn => {
        const c = await pool.connect();
        try {
          await c.query('begin');
          const out = await fn((s, p) => c.query(s, p as any[]));
          await c.query('commit');
          return out;
        } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
      },
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const db = new PGlite(path.resolve(process.cwd(), '../pgdata'), { extensions: { pg_trgm } });
  return { run: (s, p) => db.query(s, p as any[]), tx: fn => db.transaction(t => fn((s, p) => t.query(s, p as any[]))) };
}

const ROSTR_MANAGERS: Record<string, string[]> = {
  'Shakey Graves': ['Kayleigh Allen', 'Bodie Johnson'], 'Futurebirds': ['Kayleigh Allen', 'Bodie Johnson'], 'Nick Shoulders': ['Kayleigh Allen', 'Bodie Johnson'],
  'Langhorne Slim': ['Christopher Funk', 'Alex Brahl'], 'Sam Ryder': ['Derek Gridley', 'Lewis Allen'],
  'Kashus Culpepper': ['Jay Harren', 'Jason King', 'Audrey Moentmann'], 'Breland': ['Robby Towns'], 'Blackberry Smoke': ['Trey Wilson'],
  'Wyatt Flores': ['Braden Milford', 'William Dyer'], 'Jo Dee Messina': ['Cameo Carlson'], 'Mickey Guyton': ['Carine Abraham', 'Cameo Carlson'],
  'Corey Smith': ['Dirk Lemmenes'], 'Sara Evans': ['Craig Dunn', 'Nicole Lewis'], 'Alex Hall': ['Craig Dunn', 'Nicole Lewis'],
  'Trace Adkins': ['Greg Baker'], '21 Pilots': ['Chris Woltman'], 'Tyler Childers': ['Michael Corcoran'], 'Home Free': ['Kristy Reis', 'Luke Pierce'],
};

// artist_managers is created on first use (auth.sql does the same), so a deploy never depends on someone running SQL by hand.
// RLS stays on so Supabase's public API can't read it. Seeded only while empty; after that the Users page owns it.
async function ensureManagers(db: Db) {
  try {
    await db.run(`create table if not exists artist_managers (artist_name text not null, manager_name text not null, primary key (artist_name, manager_name))`);
    await db.run('alter table artist_managers enable row level security');
    if (!(await db.run('select 1 from artist_managers limit 1')).rows.length)
      for (const [a, m] of [['Sam Ryder', 'Derek Gridley'], ['Sam Ryder', 'Lewis Allen']]) await db.run('insert into artist_managers values ($1,$2) on conflict do nothing', [a, m]);
    // One-time load of the manager names from Rostr (2 Nov 2026). The flag keeps later edits on the Users page from being undone.
    await db.run('create table if not exists seed_flags (name text primary key)');
    await db.run('alter table seed_flags enable row level security');
    if ((await db.run(`insert into seed_flags values ('managers_rostr_2026_11') on conflict do nothing returning name`)).rows.length)
      for (const [a, names] of Object.entries(ROSTR_MANAGERS)) for (const m of names)
        await db.run('insert into artist_managers values ($1,$2) on conflict do nothing', [a, m]);
    // One-time data fix (2 Nov 2026): Kash's Aug 2026 amounts were text in the sheet and came in blank. Only fills blanks.
    if ((await db.run(`insert into seed_flags values ('kash_amounts_2026_11') on conflict do nothing returning name`)).rows.length)
      for (const [row, amt] of Object.entries({ 47: 37500, 48: 1112.81, 49: 20000, 50: 15000, 51: 15000, 52: 8000, 53: 5000, 54: 5000 }))
        await db.run(`update revenue_lines set amount = $1 where tracker_year = 2026 and source_row = $2 and amount is null
                        and manager_id = (select manager_id from managers where name = 'Full Circle')`, [amt, Number(row)]);
    // One-time loads of tracker lines (2 Nov 2026). Each is flagged, and upserts on the tracker key, so it is safe to repeat.
    await seedLines(db, 'underoath_merch_2026_11', seedUnderoath.csv);   // Underoath tour-merch lines, 2026 rows 158-188
    await seedLines(db, 'retainers_2026_11', seedRetainers.csv);         // 2026 retainers: new 'Retainers' company, Jo Dee Mar-May, Wyatt (Bluebird/Resonant) Sep
    // 4 Nov 2026 sheet refresh: Kash Sept touring (Full Circle 107-115), Sam Ryder Q3 (Biz Wash 22-32), Underoath support file names, source cleanups. Adds new rows and updates changed ones.
    await seedLines(db, 'sheet_refresh_2026_11_04', seedRefresh.csv, true);
    await seedLines(db, 'sheet_refresh_2026_11_04b', seedRefreshB.csv, true);
    await seedLines(db, 'sheet_refresh_2026_11_04c', seedRefreshC.csv, true);   // third refresh: source names on Backforty 2023 and Here There and Gone 2024/2025   // second refresh the same day: source names on Sarepta, TOP Financials, Here There and Gone 2025, One Spark, Mickey Guyton
    await seedLines(db, 'sheet_refresh_2026_11_05', seedRefreshD.csv, true);   // 5 Nov refresh: 21 Pilots source, Stern artists, WhizzBang/Biz Wash/Here There and Gone 2025 fixes
    // 4 Nov 2026: 2026 deposits (MT MS 2026 Income tracking) with no line in the trackers: commission type/source 'Unsupported', dated by the payment. Rows 9001+ so they never collide with sheet rows.
    await seedLines(db, 'unsupported_2026_11_04', seedUnsupported.csv);
    // 4 Nov 2026: $30K of Jo Dee retainers were netted against the 9/22 commission payment, so her September total is lowered by 30K.
    await seedLines(db, 'jodee_retainer_adj_2026_11_04', seedJoDeeAdj.csv);
    // 4 Nov 2026: Grey Slate. The April-June statement (6/26) already includes the 5/8 payment of 10,964.63, so that payment is supported;
    // the payment with no support is the 6/1 one of 10,258.61. Replaces the wrong 'Unsupported' 5/8 line (row 9001).
    if (!(await db.run(`select 1 from seed_flags where name = 'greyslate_unsupported_fix_2026_11_04'`)).rows.length)
      await db.run(`delete from revenue_lines where tracker_year = 2026 and source_row = 9001 and commission_type = 'Unsupported' and commission = 10964.63
                      and manager_id = (select manager_id from managers where name = 'Grey Slate')`);
    await seedLines(db, 'greyslate_unsupported_fix_2026_11_04', seedGreySlateFix.csv);
    // 4 Nov 2026: Other, Management Service and Sponsorship are all commission type 'All'.
    if ((await db.run(`insert into seed_flags values ('types_to_all_2026_11') on conflict do nothing returning name`)).rows.length)
      await db.run(`update revenue_lines set commission_type = 'All' where lower(commission_type) in ('other', 'management service', 'sponsorship')`);
    // 4 Nov 2026: Stern lines had no source; they are 'All'.
    if ((await db.run(`insert into seed_flags values ('stern_source_all_2026_11') on conflict do nothing returning name`)).rows.length)
      await db.run(`update revenue_lines set source = 'All' where source is null and manager_id = (select manager_id from managers where name = 'Stern')`);
    // 5 Nov 2026: Florence + The Machine payments (rows 9001+) are retainers, not 'Unsupported'.
    if ((await db.run(`insert into seed_flags values ('florence_retainer_2026_11_05') on conflict do nothing returning name`)).rows.length)
      await db.run(`update revenue_lines set commission_type = 'Retainer', source = 'Retainer', memo = replace(replace(memo, 'Unsupported - payment received', 'Retainer - payment received'), ', no support', '')
                    where commission_type = 'Unsupported' and manager_id = (select manager_id from managers where name = 'Florence + The Machine')`);
    // 5 Nov 2026: show dates for Jo Dee's 2026 touring rows (from the JDM Commissionable shows sheet; added to the tracker's Show Date column).
    if ((await db.run(`insert into seed_flags values ('jodee_show_dates_2026_11_05') on conflict do nothing returning name`)).rows.length)
      await db.run(`update revenue_lines l set show_date = v.d::date from (values (4,'2026-04-23'),(5,'2026-04-24'),(6,'2026-05-07'),(7,'2026-05-08'),(8,'2026-05-09'),(10,'2026-05-28'),(11,'2026-05-29'),(12,'2026-05-30'),(13,'2026-06-11'),(14,'2026-06-12'),(15,'2026-06-13'),(16,'2026-06-18'),(17,'2026-06-19'),(18,'2026-06-20'),(19,'2026-07-10'),(20,'2026-07-17'),(21,'2026-07-23'),(22,'2026-07-24'),(23,'2026-07-25'),(24,'2026-07-31')) v(r, d)
                    where l.tracker_year = 2026 and l.source_row = v.r and l.manager_id = (select manager_id from managers where name = 'Jo Dee Messina')`);
    // 5 Nov 2026: no line has '(none)' as its source. Kayleigh payroll offsets = Offset, KKR deal payout = KKR, "More Than We Ever Imagined" expenses = Touring / Live Performance,
    // beginning balances = Beginning Balance, adjustments = Adjustment, everything else without a source (One Spark etc.) = All. Merch is never Royalties.
    if ((await db.run(`insert into seed_flags values ('sources_cleanup_2026_11_05') on conflict do nothing returning name`)).rows.length) {
      await db.run(`update revenue_lines set commission_type = 'Merch' where commission_type in ('Royalties', 'Residuals') and source ilike '%merch%'`);
      await db.run(`update revenue_lines set source = 'Offset' where source is null and memo ilike '%payroll offset%'`);
      await db.run(`update revenue_lines set source = 'KKR' where source is null and memo ilike 'kkr deal payout%'`);
      await db.run(`update revenue_lines set commission_type = 'Touring', source = 'Live Performance' where source is null and memo ilike 'more than we ever imagined expenses%'`);
      await db.run(`update revenue_lines set source = 'Beginning Balance' where source is null and memo ilike 'beginning balance%'`);
      await db.run(`update revenue_lines set source = 'Adjustment' where source is null and (memo ilike 'adjust%' or memo ilike 'vans warped dc - add exp%')`);
      await db.run(`update revenue_lines set source = 'All' where source is null`);
    }
  } catch (e) { console.error('artist_managers setup failed', e); }
  try {
    await db.run(`create table if not exists projected_shows (artist text not null, show_date date not null, venue text not null, city text, state text, contact text,
      fee numeric, status text, source text, primary key (artist, show_date, venue))`);
    await db.run('alter table projected_shows enable row level security');
    // Finance can type a commission for one show on the Touring tab; it replaces fee x usual rate for that show (Colin, Nov 9 2026). Uploads never touch it.
    await db.run('alter table projected_shows add column if not exists commission_override numeric');
    if (!(await db.run('select 1 from projected_shows limit 1')).rows.length)
      for (const s of seedShows) await db.run('insert into projected_shows values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing', [s.artist, s.show_date, s.venue, s.city, s.state, s.contact, s.fee, s.status, s.source]);
  } catch (e) { console.error('projected_shows setup failed', e); }
}
// Inserts lines from a CSV in the data/revenue_lines.csv layout (overwrites an existing tracker row only when update is true), creating the company, artist and client if needed.
async function seedLines(db: Db, flag: string, csvText: string, update = false) {
  if ((await db.run('select 1 from seed_flags where name = $1', [flag])).rows.length) return;
  const { parse } = await import('csv-parse/sync');
  const lookup = async (table: string, idCol: string, name: string, extra: Record<string, unknown> = {}) => {
    const cols = ['name', ...Object.keys(extra)], vals = [name, ...Object.values(extra)];
    await db.run(`insert into ${table}(${cols.join(',')}) values (${vals.map((_, i) => `$${i + 1}`).join(',')}) on conflict (name) do nothing`, vals);
    return (await db.run(`select ${idCol} from ${table} where name = $1`, [name])).rows[0][idCol];
  };
  const cols = ['commission_type', 'source', 'statement_year', 'statement_month', 'statement_month_num', 'deposit_date', 'memo', 'amount', 'rate', 'commission', 'actual_commission', 'fx_rate', 'commission_usd', 'support_file', 'show_date', 'sheet_url'];
  const all = ['tracker_year', 'manager_id', 'source_row', 'client_id', 'artist_id', ...cols];
  for (const r of parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[]) {
    const mid = await lookup('managers', 'manager_id', r.manager, { is_current: /^(true|yes|1)$/i.test(r.current_manager ?? '') });
    const aid = r.artist ? await lookup('artists', 'artist_id', r.artist) : null;
    const cid = r.client_name ? await lookup('clients', 'client_id', r.client_name, { artist_id: aid, manager_id: mid }) : null;
    const vals = [Number(r.tracker_year), mid, Number(r.source_row), cid, aid, ...cols.map(c => (r[c] ?? '') === '' ? null : r[c])];
    await db.run(`insert into revenue_lines(line_id, ${all.join(',')}) values ((select coalesce(max(line_id),0)+1 from revenue_lines), ${all.map((_, i) => `$${i + 1}`).join(',')})
                    on conflict (tracker_year, manager_id, source_row) ${update ? `do update set client_id = excluded.client_id, artist_id = excluded.artist_id, ${cols.map(c => `${c} = excluded.${c}`).join(', ')}` : 'do nothing'}`, vals);
  }
  await db.run('insert into seed_flags values ($1) on conflict do nothing', [flag]);
}
const get = () => (g.__db ??= init().then(async db => { await ensureManagers(db); return db; }));
export async function query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await (await get()).run(sql, params)).rows as T[];
}
export async function transaction<T>(fn: (run: Run) => Promise<T>): Promise<T> {
  return (await get()).tx(fn);
}
