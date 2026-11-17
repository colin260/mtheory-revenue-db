import Link from 'next/link';
import { query } from '@/lib/db';
import { usd, day } from '@/lib/format';
import { onlyCurrent } from '@/lib/filters';
import { avg, PERIOD } from '@/lib/stats';
import { scoped } from '@/lib/scope';
import { requireViewer } from '@/lib/session';
import { LinesTable } from '@/lib/LinesTable';
import { Breakdown, MeasureToggle, measureFrom } from '@/lib/Bars';
import { Drill, dbHref } from '@/lib/Drill';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

// History of one source (payer): totals, averages per payment and per month, by year / artist / type, month by month, and every line.
export default async function Source({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<SP> }) {
  const viewer = await requireViewer();
  const rel = scoped(viewer), money = viewer.sees.money;
  const name = decodeURIComponent((await params).name), sp = await searchParams;
  const artist = one(sp.artist), legacy = one(sp.legacy) ? '1' : '';
  const measure = measureFrom(sp.measure, money);
  const isNone = name === '(none)';
  const p: unknown[] = isNone ? [] : [name];
  if (artist) p.push(artist);
  const base = `from ${rel} where ${isNone ? 'source is null' : 'source = $1'}${artist ? ` and artist = $${p.length}` : ''}${onlyCurrent(legacy)}`;
  const artistOpts = (await query<{ a: string }>(`select distinct artist a from ${rel} where ${isNone ? 'source is null' : 'source = $1'} and artist is not null${onlyCurrent(legacy)} order by 1`, isNone ? [] : [name])).map(x => x.a);
  const [tot, byYear, byArtist, byType, byMonth, recent] = await Promise.all([
    query(`select count(*)::int n, coalesce(sum(amount),0)::float8 amount, coalesce(sum(commission),0)::float8 commission, count(distinct artist)::int artists,
             count(distinct ${PERIOD})::int months, min(deposit_date) first_deposit, max(deposit_date) last_deposit,
             count(*) filter (where amount is not null)::int n_amt, count(*) filter (where commission is not null)::int n_comm ${base}`, p),
    query(`select tracker_year::text k, sum(amount)::float8 rev, sum(commission)::float8 comm ${base} group by 1 order by 1`, p),
    query(`select coalesce(artist,'(none)') k, sum(amount)::float8 rev, sum(commission)::float8 comm ${base} group by 1 order by 2 desc nulls last limit 40`, p),
    query(`select coalesce(commission_type,'(no type)') k, sum(amount)::float8 rev, sum(commission)::float8 comm ${base} group by 1 order by 2 desc nulls last`, p),
    query(`select ${PERIOD} k, count(*)::int n, sum(amount)::float8 rev, sum(commission)::float8 comm ${base} group by 1 order by 1 desc nulls last limit 60`, p),
    query(`select v.*, l.source_row from (select * ${base}) v join revenue_lines l using(line_id) order by v.deposit_date desc nulls last, v.line_id desc limit 200`, p),
  ]);
  const t = tot[0];
  if (!t.n) return <p>No lines for source “{name}”. <Link href="/royalties">Back</Link></p>;
  const keep = { ...(artist ? { artist } : {}), ...(legacy ? { legacy } : {}) };
  const drill = (extra: Record<string, string> = {}) => dbHref({ source: name, ...keep, ...extra });
  const maxM = Math.max(1, ...byMonth.map(m => Math.abs(money ? m.comm ?? 0 : m.rev ?? 0)));
  const per = money ? { total: t.commission, n: t.n_comm, what: 'commission' } : { total: t.amount, n: t.n_amt, what: 'revenue' };

  return (
    <>
      <p><Link href="/royalties">← Royalties</Link> · <Link href="/">Artist dashboard</Link></p>
      <h1 style={{ margin: '4px 0 6px' }}>{name}</h1>
      <p className="note">Source history{artist ? <> · artist: {artist} (<Link href={`/sources/${encodeURIComponent(name)}${legacy ? '?legacy=1' : ''}`}>all artists</Link>)</> : null}
        {legacy ? '' : <> · current managers only (<Link href={`?${new URLSearchParams({ ...keep, legacy: '1' })}`}>include legacy managers</Link>)</>}</p>
      {artistOpts.length > 1 || artist ? (
        <form method="get" className="filters" style={{ gridTemplateColumns: 'minmax(180px, 280px) auto', alignItems: 'end' }}>
          <label>Artist
            <select name="artist" defaultValue={artist}><option value="">All artists</option>{artistOpts.map(a => <option key={a}>{a}</option>)}</select>
          </label>
          {legacy && <input type="hidden" name="legacy" value="1" />}
          {one(sp.measure) && <input type="hidden" name="measure" value={one(sp.measure)} />}
          <div className="actions"><button type="submit">Show</button></div>
        </form>
      ) : null}
      <div className="stats">
        <div className="stat"><b><Drill href={drill()}>{t.n.toLocaleString()}</Drill></b><span>payments</span></div>
        <div className="stat"><b><Drill href={drill()}>{usd(t.amount)}</Drill></b><span>revenue</span></div>
        {money && <div className="stat"><b><Drill href={drill()}>{usd(t.commission)}</Drill></b><span>commission</span></div>}
        <div className="stat"><b>{usd(avg(per.total, per.n))}</b><span>avg {per.what} / payment</span></div>
        <div className="stat"><b>{usd(avg(per.total, t.months))}</b><span>avg {per.what} / month ({t.months} months)</span></div>
        {!artist && <div className="stat"><b>{t.artists}</b><span>artists</span></div>}
        <div className="stat"><b>{day(t.first_deposit)}</b><span>first deposit</span></div>
        <div className="stat"><b>{day(t.last_deposit)}</b><span>last deposit</span></div>
      </div>
      {money && <MeasureToggle current={measure} href={m => `?${new URLSearchParams({ ...keep, measure: m })}`} />}
      <div className="grid2">
        <div className="card"><h2 style={{ marginTop: 0 }}>{measure === 'commission' ? 'Commission' : 'Revenue'} by year</h2><Breakdown rows={byYear} measure={measure} ordered href={k => drill({ year: k })} /></div>
        {!artist && <div className="card"><h2 style={{ marginTop: 0 }}>By artist</h2><Breakdown rows={byArtist} measure={measure} limit={10} href={k => `/sources/${encodeURIComponent(name)}?${new URLSearchParams({ ...keep, artist: k })}`} /></div>}
        <div className="card"><h2 style={{ marginTop: 0 }}>By type</h2><Breakdown rows={byType} measure={measure} href={k => drill({ type: k === '(no type)' ? '(none)' : k })} /></div>
      </div>

      <h2>Month by month</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>Month</th><th className="num">Payments</th><th className="num">Revenue</th>{money && <th className="num">Commission</th>}<th>{money ? 'Commission' : 'Revenue'} vs. best month</th></tr></thead>
        <tbody>{byMonth.map(m => (
          <tr key={m.k ?? 'none'}>
            <td>{m.k ?? '(no date)'}</td><td className="num">{m.n}</td><td className="num">{usd(m.rev)}</td>{money && <td className="num">{usd(m.comm)}</td>}
            <td style={{ minWidth: 140 }}><i style={{ display: 'block', height: 10, borderRadius: 3, width: `${Math.max(1, (Math.abs((money ? m.comm : m.rev) ?? 0) / maxM) * 100)}%`, background: ((money ? m.comm : m.rev) ?? 0) < 0 ? '#c0392b' : 'var(--accent)' }} /></td>
          </tr>))}</tbody>
      </table></div>
      {t.months > 60 && <p className="muted">Showing the latest 60 months.</p>}

      <h2>Lines <Link href={drill()} style={{ fontWeight: 400, fontSize: 13 }}>(see all, with filters)</Link></h2>
      <LinesTable rows={recent} money={money} />
    </>
  );
}
