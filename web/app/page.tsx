import { RememberArtist } from '@/lib/Tabs';
import Link from 'next/link';
import { query } from '@/lib/db';
import { FILTER_KEYS, TYPE_GROUP, basisLabel, filtersFrom, groupType, managerNames, onlyCurrent, where, yearExpr, yearOptions, type SP } from '@/lib/filters';
import { usd, day } from '@/lib/format';
import { scoped } from '@/lib/scope';
import { requireViewer } from '@/lib/session';
import { Breakdown, Donut, MeasureToggle, measureFrom } from '@/lib/Bars';
import { Drill, dbHref } from '@/lib/Drill';

export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';
const distinct = (rel: string, col: string, cur = '') =>
  query<{ v: string }>(`select distinct ${col} v from ${rel} where ${col} is not null${cur} order by 1`).then(r => r.map(x => String(x.v)));

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const viewer = await requireViewer();
  const money = viewer.sees.money;
  const rel = scoped(viewer);
  const sp = await searchParams;
  // Default view: the current year, and commission only for finance. 'All' years (year= present but empty) and the Revenue/Both toggle override these.
  const f = filtersFrom('year' in sp ? sp : { ...sp, year: String(new Date().getFullYear()) });
  const [names, mgrs] = await Promise.all([distinct(rel, 'artist', onlyCurrent(f.legacy)), managerNames(rel, f.legacy)]);
  const sort = ['name', 'lines', 'recent', 'commission', 'revenue'].includes(one(sp.sort)) ? one(sp.sort) : 'revenue';
  const measure = measureFrom(sp.measure ?? (money ? 'commission' : undefined), money);
  const short = measure === 'commission' ? 'Commission' : 'Revenue';

  // Same filters as the Database tab, except the search box here matches artist names only.
  const w = where({ ...f, q: '' });
  const conds = [w.sql.replace(/^where /, ''), 'artist is not null'].filter(Boolean);
  const params = [...w.params];
  if (f.q) { params.push(`%${f.q}%`); conds.push(`artist ilike $${params.length}`); }
  const base = `from ${rel} where ${conds.join(' and ')}`;
  const order = { name: 'artist', lines: 'n desc', recent: 'last_deposit desc nulls last', commission: 'commission desc nulls last', revenue: 'amount desc nulls last' }[sort === 'commission' && !money ? 'revenue' : sort];

  const [managers, years, tot, noArtist, byYear, byType, bySource, artists] = await Promise.all([
    distinct(rel, 'manager', onlyCurrent(f.legacy)), query<{ v: number }>(yearOptions(rel, f.basis)).then(r => r.map(x => String(x.v))),
    query(`select count(*)::int n, count(distinct artist)::int artists, coalesce(sum(amount),0)::float8 amount, coalesce(sum(commission),0)::float8 commission ${base}`, params),
    viewer.artists === null && !f.q ? query(`select count(*)::int n from ${rel} where ${[w.sql.replace(/^where /, ''), 'artist is null'].filter(Boolean).join(' and ')}`, w.params) : Promise.resolve([{ n: 0 }]),
    query(`select coalesce(${yearExpr(f.basis)}::text,'(none)') k, sum(amount)::float8 rev, sum(commission)::float8 comm ${base} group by 1 order by 1`, params),
    query(`select ${TYPE_GROUP} k, sum(amount)::float8 rev, sum(commission)::float8 comm ${base} group by 1 order by 2 desc nulls last limit 40`, params),
    query(`select coalesce(source,'(none)') k, sum(amount)::float8 rev, sum(commission)::float8 comm ${base} and coalesce(source,'') not ilike 'Live Performance%' and source is not null and source <> 'All' group by 1 order by 2 desc nulls last limit 40`, params),
    query(`select artist, count(*)::int n, sum(amount)::float8 amount, sum(commission)::float8 commission, max(deposit_date) last_deposit,
             string_agg(distinct manager, ', ') managers, max(mgr_names) mgr_names ${base} group by artist order by ${order}, artist`, params),
  ]);
  const t = tot[0];
  const topArtists = artists.map(a => ({ k: a.artist, rev: a.amount, comm: a.commission })).sort((a, b) => (measure === 'commission' ? (b.comm ?? 0) - (a.comm ?? 0) : (b.rev ?? 0) - (a.rev ?? 0)));
  // Drill-down: the Database tab with the same filters as this page (and 'artists only', since these totals skip lines with no artist).
  const base0 = { manager: f.manager, mgr: f.mgr, year: f.year, basis: f.basis, legacy: f.legacy, aq: f.q, hasartist: '1' };
  const drill = (extra: Record<string, string> = {}) => dbHref({ ...base0, ...extra });
  const yr = (k: string) => (k === '(none)' ? '(none)' : k), ty = groupType;       // Touring incl. VIP, Royalties incl. Residuals, All incl. Other/Brand/Deduction/no type

  const qs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && k !== 'q') as [string, string][]);
  if (f.q) qs.set('q', f.q);
  if (!f.year) qs.set('year', '');                      // keep 'All years' when sorting
  const sortLink = (key: string, label: string, cls = '') => {
    const u = new URLSearchParams(qs); u.set('sort', key); if (measure !== 'both') u.set('measure', measure);
    return <th className={cls}><a className={`sort ${sort === key ? 'on' : ''}`} href={`/?${u}`}>{label}</a></th>;
  };
  const Select = ({ name, label, opts }: { name: (typeof FILTER_KEYS)[number]; label: string; opts: string[] }) => (
    <label>{label}<select name={name} defaultValue={f[name]}><option value="">All</option>{opts.map(o => <option key={o} value={o}>{o}</option>)}</select></label>
  );

  // A search that lands on one artist (exact name, or the only match) becomes the remembered artist for the tabs.
  const picked = f.q ? (names.find(n => n.toLowerCase() === f.q.trim().toLowerCase()) ?? (artists.length === 1 ? artists[0].artist : '')) : '';

  return (
    <>
      {picked && <RememberArtist name={picked} />}
      <form className="filters" method="get">
        <label className="q">Find an artist<input name="q" defaultValue={f.q} placeholder="Start typing an artist name…" list="artist-names" autoComplete="off" /><datalist id="artist-names">{names.map(n => <option key={n} value={n} />)}</datalist></label>
        {f.co && <Select name="manager" label="Company" opts={managers} />}
        <Select name="mgr" label="Manager" opts={mgrs} />
        <label>Year basis
          <select name="basis" defaultValue={f.basis}>
            <option value="">Cash year (tracker sheet)</option>
            <option value="statement">Statement year (as reported)</option>
          </select>
        </label>
        <Select name="year" label={basisLabel(f.basis)} opts={years} />
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="measure" value={measure} />
        <div className="actions">
          <label className="check"><input type="checkbox" name="co" value="1" defaultChecked={!!f.co} /> Show company</label>
          <label className="check"><input type="checkbox" name="legacy" value="1" defaultChecked={!!f.legacy} /> Include legacy managers</label>
          <button type="submit">Apply</button>
          <Link className="btn ghost" href="/">Clear</Link>
        </div>
      </form>

      <div className="stats">
        <div className="stat"><b>{t.artists.toLocaleString()}</b><span>artists</span></div>
        <div className="stat"><b><Drill href={drill()}>{usd(t.amount)}</Drill></b><span>revenue</span></div>
        {money && <div className="stat"><b><Drill href={drill()}>{usd(t.commission)}</Drill></b><span>commission</span></div>}
        <div className="stat"><b><Drill href={drill()}>{t.n.toLocaleString()}</Drill></b><span>lines</span></div>
      </div>

      {money && <MeasureToggle current={measure} href={m => `/?${new URLSearchParams([...Object.entries(f).filter(([k, v]) => v && k !== 'q'), ...(f.q ? [['q', f.q]] : []), ...(f.year ? [] : [['year', '']]), ['sort', sort], ['measure', m]])}`} />}
      <div className="grid2">
        <div className="card"><h2>{short} by year</h2><Breakdown rows={byYear} measure={measure} ordered href={k => drill({ year: yr(k) })} /></div>
        <div className="card"><h2>{short} by type</h2><Breakdown rows={byType} measure={measure} limit={20} href={k => drill({ type: ty(k) })} /></div>
        <div className="card"><h2>Top sources</h2><Breakdown rows={bySource} measure={measure} limit={8} href={k => `/sources/${encodeURIComponent(k)}${f.legacy ? '?legacy=1' : ''}`} /></div>
        <div className="card"><h2>Top artists</h2><Donut rows={topArtists} measure={measure} href={k => `/artists/${encodeURIComponent(k)}${f.legacy ? '?legacy=1' : ''}`} /></div>
      </div>

      <h2 style={{ marginTop: 32 }}>All artists <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· click any figure to see its lines</span></h2>
      {artists.length === 0 ? <p className="muted">No artists match.</p> : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                {sortLink('name', 'Artist')}{f.co && <th>Company</th>}<th>Manager</th>
                {sortLink('revenue', 'Revenue', 'num')}
                {money && sortLink('commission', 'Commission', 'num')}
                {money && <th className="num" title="Commission as a share of the artist's revenue">Our share</th>}
                {sortLink('lines', 'Lines', 'num')}
                {sortLink('recent', 'Last deposit')}
              </tr>
            </thead>
            <tbody>
              {artists.map(a => (
                <tr key={a.artist}>
                  <td><Link href={`/artists/${encodeURIComponent(a.artist)}${f.legacy ? '?legacy=1' : ''}`}>{a.artist}</Link></td>
                  {f.co && <td>{a.managers}</td>}
                  <td>{a.mgr_names ?? <span className="muted">—</span>}</td>
                  <td className="num"><Drill href={drill({ artist: a.artist })}>{usd(a.amount)}</Drill></td>
                  {money && <td className="num"><Drill href={drill({ artist: a.artist })}>{usd(a.commission)}</Drill></td>}
                  {money && <td className="num">{a.amount ? `${((a.commission / a.amount) * 100).toFixed(1)}%` : ''}</td>}
                  <td className="num"><Drill href={drill({ artist: a.artist })}>{a.n.toLocaleString()}</Drill></td>
                  <td>{day(a.last_deposit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {noArtist[0].n > 0 && (
        <p className="muted">{noArtist[0].n} lines have no artist (carve-outs, payroll offsets) and aren’t shown here. <Link href="/database">Find them in the Database tab.</Link></p>
      )}
    </>
  );
}
