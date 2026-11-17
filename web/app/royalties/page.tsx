import Link from 'next/link';
import { query } from '@/lib/db';
import { scoped } from '@/lib/scope';
import { requireViewer } from '@/lib/session';
import { usd, day } from '@/lib/format';
import { LinesTable } from '@/lib/LinesTable';
import { avg, PERIOD } from '@/lib/stats';
import { Drill, dbHref } from '@/lib/Drill';
import { basisLabel, onlyCurrent, orderBy, yearExpr, yearOptions } from '@/lib/filters';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';
// Sortable columns of the sources table: SQL expression + the direction a first click uses. A second click flips it (?dir=asc|desc).
const SRC_COLS: Record<string, { expr: (money: boolean) => string; first: 'asc' | 'desc' }> = {
  name: { expr: () => 'src', first: 'asc' }, revenue: { expr: () => 'rev', first: 'desc' }, commission: { expr: () => 'comm', first: 'desc' },
  artists: { expr: () => 'artists', first: 'desc' }, lines: { expr: () => 'n', first: 'desc' },
  avgpay: { expr: m => (m ? 'comm / nullif(n_comm, 0)' : 'rev / nullif(n_amt, 0)'), first: 'desc' },
  avgmonth: { expr: m => (m ? 'comm / nullif(months, 0)' : 'rev / nullif(months, 0)'), first: 'desc' },
  first: { expr: () => 'first_deposit', first: 'asc' }, recent: { expr: () => 'last_deposit', first: 'desc' },
};
// The by-artist table is small, so it is sorted here.
const ART_COLS = ['artist', 'rev', 'comm', 'n', 'months', 'avgpay', 'avgmonth'];

export default async function Royalties({ searchParams }: { searchParams: Promise<SP> }) {
  const viewer = await requireViewer();
  const money = viewer.sees.money;
  const rel = scoped(viewer);
  const sp = await searchParams;
  const legacy = one(sp.legacy) ? '1' : '';

  const artists = (await query<{ artist: string }>(`select distinct artist from ${rel} where commission_type in ('Royalties', 'Residuals') and artist is not null${onlyCurrent(legacy)} order by 1`)).map(r => r.artist);
  const artist = artists.includes(one(sp.artist)) ? one(sp.artist) : '';        // '' = all artists
  const sort = SRC_COLS[one(sp.sort)] && (money || one(sp.sort) !== 'commission') ? one(sp.sort) : 'revenue';
  const dir = one(sp.dir) === 'asc' || one(sp.dir) === 'desc' ? one(sp.dir) : SRC_COLS[sort].first;
  const asort = ART_COLS.includes(one(sp.asort)) && (money || one(sp.asort) !== 'comm') ? one(sp.asort) : (money ? 'comm' : 'rev');
  const adir = one(sp.adir) === 'asc' || one(sp.adir) === 'desc' ? one(sp.adir) : asort === 'artist' ? 'asc' : 'desc';
  const lsort = one(sp.lsort);
  const sel = one(sp.source);
  const sq = one(sp.sq).trim();      // source-name search
  const basis = one(sp.basis) === 'statement' ? 'statement' : '';
  const years = (await query<{ v: number }>(yearOptions(`(select * from ${rel} where commission_type in ('Royalties', 'Residuals')${onlyCurrent(legacy)}) rr`, basis))).map(r => String(r.v));
  const year = years.includes(one(sp.year)) ? one(sp.year) : '';

  const params: unknown[] = artist ? [artist] : [];
  if (sq) params.push(`%${sq}%`);
  const where = `commission_type in ('Royalties', 'Residuals')${onlyCurrent(legacy)}${artist ? ' and artist = $1' : ''}${sq ? ` and coalesce(source, '(no source)') ilike $${params.length}` : ''}${year ? ` and ${yearExpr(basis)} = ${Number(year)}` : ''}`;
  const sources = await query(`select coalesce(source, '(no source)') src, sum(amount)::float8 rev, sum(commission)::float8 comm, count(*)::int n,
      count(distinct artist)::int artists, min(deposit_date) first_deposit, max(deposit_date) last_deposit,
      count(distinct ${PERIOD})::int months, count(amount)::int n_amt, count(commission)::int n_comm
    from ${rel} where ${where} group by 1 order by ${SRC_COLS[sort].expr(money)} ${dir} nulls last, 1`, params);
  // Averages: commission for finance, revenue for everyone else. A "month" is a deposit month with at least one royalty payment.
  const what = money ? 'commission' : 'revenue';
  const val = (s: any) => (money ? s.comm : s.rev), cnt = (s: any) => (money ? s.n_comm : s.n_amt);
  const [allMonths, byArtist] = await Promise.all([
    query(`select count(distinct ${PERIOD})::int months from ${rel} where ${where}`, params),
    artist ? Promise.resolve([]) : query(`select artist, sum(amount)::float8 rev, sum(commission)::float8 comm, count(*)::int n, count(distinct ${PERIOD})::int months,
        count(amount)::int n_amt, count(commission)::int n_comm from ${rel} where ${where} and artist is not null group by 1 order by ${money ? 'sum(commission)' : 'sum(amount)'} desc nulls last, 1`, params),
  ]);
  const aval = (a: any, k: string) => (k === 'avgpay' ? (money ? a.comm / (a.n_comm || NaN) : a.rev / (a.n_amt || NaN)) : k === 'avgmonth' ? (money ? a.comm : a.rev) / (a.months || NaN) : a[k]);
  byArtist.sort((x: any, y: any) => {
    const a = aval(x, asort), b = aval(y, asort);
    if (a == null || Number.isNaN(a)) return b == null || Number.isNaN(b) ? 0 : 1;      // blanks last
    if (b == null || Number.isNaN(b)) return -1;
    const c = typeof a === 'string' ? a.localeCompare(b) : a - b;
    return adir === 'asc' ? c : -c;
  });
  const tot = sources.reduce((a, s) => ({ rev: a.rev + (s.rev ?? 0), comm: a.comm + (s.comm ?? 0), n: a.n + s.n }), { rev: 0, comm: 0, n: 0 });
  const totVal = sources.reduce((a, s) => a + (val(s) ?? 0), 0), totCnt = sources.reduce((a, s) => a + (cnt(s) ?? 0), 0);
  const max = Math.max(1, ...sources.map(s => Math.abs(s.rev ?? 0)));
  const drill = (extra: Record<string, string> = {}) => dbHref({ type: 'Royalties*', artist, year, basis: basis, legacy, ...extra });

  const link = (extra: Record<string, string>) => `/royalties?${new URLSearchParams({ ...(artist ? { artist } : {}), sort, dir, asort, adir, ...(lsort ? { lsort } : {}), ...(basis ? { basis } : {}), ...(legacy ? { legacy } : {}), ...(year ? { year } : {}), ...(sq ? { sq } : {}), ...(sel ? { source: sel } : {}), ...extra })}`;
  // Click a header to sort by it; click again to reverse.
  const head = (key: string, label: string, cls = '', title?: string) => {
    const on = sort === key;
    return <th className={cls} title={title}><Link className={`sort ${on ? 'on' : ''}`} href={link({ sort: key, dir: on ? (dir === 'asc' ? 'desc' : 'asc') : SRC_COLS[key].first })}>{label}{on ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</Link></th>;
  };
  const ahead = (key: string, label: string, cls = '') => {
    const on = asort === key;
    return <th className={cls}><Link className={`sort ${on ? 'on' : ''}`} href={link({ asort: key, adir: on ? (adir === 'asc' ? 'desc' : 'asc') : key === 'artist' ? 'asc' : 'desc' })}>{label}{on ? (adir === 'asc' ? ' ↑' : ' ↓') : ''}</Link></th>;
  };

  const lines = sel ? await query(`select v.*, l.source_row from (select * from ${rel}) v join revenue_lines l using (line_id)
      where v.commission_type in ('Royalties', 'Residuals')${onlyCurrent(legacy, 'v.')} and coalesce(v.source, '(no source)') = $${params.length + 1}${artist ? ' and v.artist = $1' : ''}${year ? ` and ${yearExpr(basis, 'v.')} = ${Number(year)}` : ''}
      order by ${orderBy(lsort, money, 'v.')} limit 200`, [...params, sel]) : [];

  return (
    <>
      <form className="filters" method="get" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <label>Artist
          <select name="artist" defaultValue={artist}><option value="">All artists</option>{artists.map(a => <option key={a}>{a}</option>)}</select>
        </label>
        <label>Search sources
          <input type="search" name="sq" defaultValue={sq} placeholder="Source name…" />
        </label>
        <label>Year basis
          <select name="basis" defaultValue={basis}><option value="">Cash year (tracker sheet)</option><option value="statement">Statement year (as reported)</option></select>
        </label>
        <label>{basisLabel(basis)}
          <select name="year" defaultValue={year}><option value="">All years</option>{years.map(y => <option key={y}>{y}</option>)}</select>
        </label>
        <input type="hidden" name="sort" value={sort} /><input type="hidden" name="dir" value={dir} /><input type="hidden" name="asort" value={asort} /><input type="hidden" name="adir" value={adir} />
        <div className="actions"><label className="check"><input type="checkbox" name="legacy" value="1" defaultChecked={!!legacy} /> Include legacy managers</label><button type="submit">Show</button></div>
      </form>

      <div className="stats">
        <div className="stat"><b>{sources.length}</b><span>sources</span></div>
        <div className="stat"><b><Drill href={drill()}>{usd(tot.rev)}</Drill></b><span>royalty revenue</span></div>
        {money && <div className="stat"><b><Drill href={drill()}>{usd(tot.comm)}</Drill></b><span>commission</span></div>}
        <div className="stat"><b><Drill href={drill()}>{tot.n.toLocaleString()}</Drill></b><span>payments</span></div>
        <div className="stat"><b>{usd(avg(totVal, totCnt))}</b><span>avg {what} / payment</span></div>
        <div className="stat"><b>{usd(avg(totVal, allMonths[0].months))}</b><span>avg {what} / month ({allMonths[0].months} months)</span></div>
      </div>

      {sources.length === 0 ? <p className="muted">No royalty lines for this selection{sq ? ` matching “${sq}”` : ''}.</p> : (
        <div className="tablewrap"><table>
          <thead><tr>
            {head('name', 'Source')}{head('revenue', 'Revenue', 'num')}{head('revenue', 'Share', 'num', 'Share of royalty revenue (sorts by revenue)')}<th>Revenue vs. top</th>
            {money && head('commission', 'Commission', 'num')}
            {!artist && head('artists', 'Artists', 'num')}
            {head('lines', 'Lines', 'num')}{head('avgpay', 'Avg / payment', 'num', `Average ${what} per payment`)}{head('avgmonth', 'Avg / month', 'num', `Average ${what} per month with a payment`)}{head('first', 'First deposit')}{head('recent', 'Last deposit')}
          </tr></thead>
          <tbody>
            {sources.map(s => (
              <tr key={s.src} style={s.src === sel ? { background: 'color-mix(in srgb, var(--accent) 12%, transparent)' } : undefined}>
                <td><Link href={`/sources/${encodeURIComponent(s.src === '(no source)' ? '(none)' : s.src)}?${new URLSearchParams({ ...(artist ? { artist } : {}), ...(legacy ? { legacy } : {}) })}`} title="Source history">{s.src}</Link></td>
                <td className="num"><b><Drill href={link({ source: s.src })}>{usd(s.rev)}</Drill></b></td>
                <td className="num">{tot.rev > 0 && s.rev > 0 ? `${((s.rev / tot.rev) * 100).toFixed(1)}%` : ''}</td>
                <td style={{ minWidth: 110 }}><i style={{ display: 'block', height: 10, borderRadius: 3, width: `${Math.max(1, (Math.abs(s.rev ?? 0) / max) * 100)}%`, background: (s.rev ?? 0) < 0 ? '#c0392b' : 'var(--accent)' }} /></td>
                {money && <td className="num"><Drill href={link({ source: s.src })}>{usd(s.comm)}</Drill></td>}
                {!artist && <td className="num">{s.artists}</td>}
                <td className="num"><Drill href={link({ source: s.src })}>{s.n}</Drill></td><td className="num">{usd(avg(val(s), cnt(s)))}</td><td className="num">{usd(avg(val(s), s.months))}</td><td>{day(s.first_deposit)}</td><td>{day(s.last_deposit)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 600 }}>
              <td>Total</td><td className="num">{usd(tot.rev)}</td><td /><td />{money && <td className="num">{usd(tot.comm)}</td>}{!artist && <td />}<td className="num">{tot.n}</td><td className="num">{usd(avg(totVal, totCnt))}</td><td className="num">{usd(avg(totVal, allMonths[0].months))}</td><td /><td />
            </tr>
          </tbody>
        </table></div>
      )}

      {!artist && byArtist.length > 0 && (
        <>
          <h2>Royalties by artist</h2>
          <div className="tablewrap"><table>
            <thead><tr>{ahead('artist', 'Artist')}{ahead('rev', 'Revenue', 'num')}{money && ahead('comm', 'Commission', 'num')}{ahead('n', 'Payments', 'num')}{ahead('months', 'Months', 'num')}{ahead('avgpay', 'Avg / payment', 'num')}{ahead('avgmonth', 'Avg / month', 'num')}</tr></thead>
            <tbody>{byArtist.map(a => (
              <tr key={a.artist}>
                <td><Link href={`/royalties?${new URLSearchParams({ artist: a.artist, ...(basis ? { basis } : {}), ...(year ? { year } : {}), ...(sq ? { sq } : {}), ...(legacy ? { legacy } : {}) })}`}>{a.artist}</Link></td>
                <td className="num">{usd(a.rev)}</td>{money && <td className="num">{usd(a.comm)}</td>}<td className="num">{a.n}</td><td className="num">{a.months}</td>
                <td className="num">{usd(avg(val(a), cnt(a)))}</td><td className="num">{usd(avg(val(a), a.months))}</td>
              </tr>))}</tbody>
          </table></div>
        </>
      )}

      {sel && (
        <>
          <h2>{sel}{artist ? `: ${artist}` : ''} <Link href={link({ source: '' })} style={{ fontWeight: 400, fontSize: 13 }}>close</Link></h2>
          <LinesTable rows={lines} money={money} sorting={{ current: lsort, href: s => link({ lsort: s }) }} />
        </>
      )}
    </>
  );
}
