// Loads data/*.csv into Postgres using schema.sql, then verifies per-tab commission
// totals against data/reconciliation.csv.
//
//   DATABASE_URL=postgresql://... node load.mjs [--reset]   -> any Postgres (e.g. Supabase)
//   node load.mjs                                             -> local embedded copy in ./pgdata (stop the dev server first)
//
// Without --reset the loader refuses to touch a database that already has the tables.
import { parse } from 'csv-parse/sync';
import fs from 'node:fs';

const url = process.env.DATABASE_URL;
const reset = process.argv.includes('--reset');

async function connect() {
  if (url) {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
    await client.connect();
    return { query: (s, p) => client.query(s, p), exec: s => client.query(s), close: () => client.end() };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const db = new PGlite('pgdata', { extensions: { pg_trgm } });
  return { query: (s, p) => db.query(s, p), exec: s => db.exec(s), close: () => db.close() };
}

const csv = f => parse(fs.readFileSync(`data/${f}`), { columns: true, skip_empty_lines: true });
const nul = v => (v === '' || v === undefined ? null : v);

// multi-row insert in chunks; returns rows when `returning` is given
async function insertMany(db, table, cols, rows, returning, size = 200) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const ph = chunk.map((_, r) => `(${cols.map((_, c) => `$${r * cols.length + c + 1}`).join(',')})`).join(',');
    const res = await db.query(`insert into ${table}(${cols.join(',')}) values ${ph}${returning ? ` returning ${returning}` : ''}`, chunk.flat());
    out.push(...res.rows);
  }
  return out;
}

const db = await connect();
try {
  const exists = (await db.query(`select to_regclass('public.revenue_lines') t`)).rows[0].t;
  if (exists && !reset) throw new Error('Tables already exist. Re-run with --reset to drop and reload them.');
  if (reset) await db.exec('drop view if exists v_revenue; drop table if exists manager_settlements, revenue_lines, clients, artists, managers cascade;');
  await db.exec(fs.readFileSync('schema.sql', 'utf8'));
  await db.exec(fs.readFileSync('auth.sql', 'utf8')); // access tables; kept across --reset

  const lines = csv('revenue_lines.csv');
  const settlements = csv('manager_settlements.csv');
  const recon = csv('reconciliation.csv');

  const mgr = new Map(), art = new Set(), cli = new Map();
  for (const r of lines) {
    mgr.set(r.manager, mgr.get(r.manager) || r.current_manager === 'True');
    if (r.artist) art.add(r.artist);
    if (r.client_name && !cli.has(r.client_name)) cli.set(r.client_name, r);
  }
  for (const s of settlements) if (!mgr.has(s.manager)) mgr.set(s.manager, false);

  const mid = new Map((await insertMany(db, 'managers', ['name', 'is_current'], [...mgr], 'name, manager_id')).map(r => [r.name, r.manager_id]));
  const aid = new Map((await insertMany(db, 'artists', ['name'], [...art].map(n => [n]), 'name, artist_id')).map(r => [r.name, r.artist_id]));
  const cid = new Map((await insertMany(db, 'clients', ['name', 'artist_id', 'manager_id'],
    [...cli].map(([n, r]) => [n, aid.get(r.artist) ?? null, mid.get(r.manager)]), 'name, client_id')).map(r => [r.name, r.client_id]));

  await db.exec('begin');
  await insertMany(db, 'revenue_lines',
    ['line_id', 'tracker_year', 'manager_id', 'source_row', 'client_id', 'artist_id', 'commission_type', 'source',
     'statement_year', 'statement_month', 'statement_month_num', 'deposit_date', 'memo', 'amount', 'rate', 'commission',
     'actual_commission', 'fx_rate', 'commission_usd', 'support_file', 'show_date', 'sheet_url'],
    lines.map(r => [r.line_id, r.tracker_year, mid.get(r.manager), r.source_row, cid.get(r.client_name) ?? null, aid.get(r.artist) ?? null,
      nul(r.commission_type), nul(r.source) ?? (r.commission_type === 'Retainer' ? 'Retainer' : null), nul(r.statement_year), nul(r.statement_month), nul(r.statement_month_num),
      nul(r.deposit_date), nul(r.memo), nul(r.amount), nul(r.rate), nul(r.commission), nul(r.actual_commission),
      nul(r.fx_rate), nul(r.commission_usd), nul(r.support_file), nul(r.show_date), nul(r.sheet_url)]));
  await insertMany(db, 'manager_settlements',
    ['tracker_year', 'manager_id', 'source_row', 'period_label', 'expected_commission', 'actual_commission'],
    settlements.map(s => [s.tracker_year, mid.get(s.manager), s.source_row, s.period_label, nul(s.expected_commission), nul(s.actual_commission)]));
  await db.exec('commit');

  // ---- verification ----
  const count = async t => Number((await db.query(`select count(*) n from ${t}`)).rows[0].n);
  console.log(`loaded: managers=${await count('managers')} artists=${await count('artists')} clients=${await count('clients')} ` +
    `revenue_lines=${await count('revenue_lines')} (csv ${lines.length}) settlements=${await count('manager_settlements')} (csv ${settlements.length})`);

  const got = (await db.query(`select l.tracker_year::int y, m.name mgr, count(*)::int n, coalesce(sum(l.commission),0)::float8 c
    from revenue_lines l join managers m using(manager_id) group by 1,2`)).rows;
  const byKey = new Map(got.map(g => [`${g.y}|${g.mgr}`, g]));
  let bad = 0, ok = 0;
  for (const r of recon) {
    const g = byKey.get(`${r.tracker_year}|${r.manager}`);
    const exp = Number(r.export_commission), n = Number(r.lines);
    if ((g?.n ?? 0) === n && Math.abs((g?.c ?? 0) - exp) < 0.01) ok++;
    else { bad++; console.log('MISMATCH', r.tracker_year, r.manager, 'lines', g?.n, 'vs', n, 'commission', g?.c, 'vs', exp, `[${r.status}]`); }
  }
  const reconKeys = new Set(recon.map(r => `${r.tracker_year}|${r.manager}`));
  for (const k of byKey.keys()) if (!reconKeys.has(k)) console.log('in DB but not in reconciliation.csv:', k);
  console.log(`reconciliation: ${ok} of ${recon.length} tabs match line count and commission; ${bad} mismatched`);
  if (bad) process.exitCode = 1;

  // On Supabase the public API can read anything the 'anon'/'authenticated' roles can. Reloading recreates the tables,
  // which undoes supabase_lockdown.sql, so re-apply it every time (it is idempotent). Plain Postgres has no such roles: skipped.
  if (url && (await db.query(`select count(*)::int n from pg_roles where rolname in ('anon', 'authenticated')`)).rows[0].n > 0) {
    await db.exec(fs.readFileSync('supabase_lockdown.sql', 'utf8'));
    const open = (await db.query(`select count(*)::int n from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema = 'public'`)).rows[0].n;
    console.log(`Supabase lockdown re-applied: ${open === 0 ? 'public API has no access to any table' : 'WARNING: ' + open + ' public grants remain'}`);
  }
} catch (e) {
  try { await db.exec('rollback'); } catch {}
  console.error(e.message); process.exitCode = 1;
} finally { await db.close(); }
