import Link from 'next/link';
import { query } from '@/lib/db';
import { usd } from '@/lib/format';
import { TYPE_GROUP, groupType, onlyCurrent, yearExpr } from '@/lib/filters';
import { scoped } from '@/lib/scope';
import { requireViewer } from '@/lib/session';
import { LinesTable } from '@/lib/LinesTable';
import { Breakdown, MeasureToggle, measureFrom } from '@/lib/Bars';
import { Drill, dbHref } from '@/lib/Drill';
import { avg, PERIOD } from '@/lib/stats';
import { showsSql } from '@/lib/touring';
import { projectedFor } from '@/lib/projections';
import { ProjectedShows } from '@/lib/ProjectedShows';

export const dynamic = 'force-dynamic';

export default async function Artist({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<{ basis?: string; measure?: string; legacy?: string }> }) {
  const viewer = await requireViewer();
  const rel = scoped(viewer);
  const name = decodeURIComponent((await params).name);
  const sp = await searchParams, statement = sp.basis === 'statement';
  // Current managers only by default; an artist whose lines are all with former managers falls back to showing them.
  const hasCurrent = (await query(`select 1 from ${rel} where artist=$1 and is_current limit 1`, [name])).length > 0;
  const legacy = sp.legacy || !hasCurrent ? '1' : '';
  const cur = onlyCurrent(legacy);
  const m = viewer.sees.money, measure = measureFrom(sp.measure, m);
  const proj = await projectedFor(viewer, name);
  const short = measure === 'commission' ? 'Commission' : 'Revenue';
  const yr = yearExpr(statement ? 'statement' : '');
  const drill = (extra: Record<string, string> = {}) => dbHref({ artist: name, basis: statement ? 'statement' : '', legacy, ...extra });
  const srcHref = (k: string) => `/sources/${encodeURIComponent(k)}?${new URLSearchParams({ artist: name, ...(legacy ? { legacy } : {}) })}`;
  const ty = groupType;     // Touring incl. VIP, Royalties incl. Residuals, All incl. Other/Brand/Deduction/no type
  const [byYear, byType, bySource, byRoyalty, recent, tot, tstat, rstat] = await Promise.all([
    query(`select coalesce(${yr}::text,'(none)') k, sum(amount)::float8 rev, sum(commission)::float8 comm from ${rel} where artist=$1${cur} group by 1 order by 1`, [name]),
    query(`select ${TYPE_GROUP} k, sum(amount)::float8 rev, sum(commission)::float8 comm from ${rel} where artist=$1${cur} group by 1 order by 2 desc nulls last`, [name]),
    query(`select source k, sum(amount)::float8 rev, sum(commission)::float8 comm from ${rel} where artist=$1${cur} and source is not null and source <> 'All' group by 1 order by 2 desc nulls last limit 40`, [name]),
    query(`select coalesce(source,'(none)') k, sum(amount)::float8 rev, sum(commission)::float8 comm from ${rel} where artist=$1 and commission_type in ('Royalties', 'Residuals')${cur} group by 1 order by 2 desc nulls last limit 40`, [name]),
    query(`select v.*, l.source_row from (select * from ${rel}) v join revenue_lines l using(line_id) where v.artist=$1${onlyCurrent(legacy, 'v.')} order by v.deposit_date desc nulls last limit 50`, [name]),
    query(`select count(*)::int n, coalesce(sum(amount),0)::float8 a, coalesce(sum(commission),0)::float8 c from ${rel} where artist=$1${cur}`, [name]),
    query(`select count(*) filter (where gross > 0)::int shows, coalesce(sum(gross),0)::float8 gross, coalesce(sum(net),0)::float8 net, sum(commission)::float8 comm from (${showsSql(viewer, onlyCurrent(legacy, 'v.'))}) s`, [name]),
    query(`select count(*)::int n, count(distinct ${PERIOD})::int months, sum(amount)::float8 rev, sum(commission)::float8 comm, count(amount)::int n_amt, count(commission)::int n_comm
           from ${rel} where artist=$1 and commission_type in ('Royalties', 'Residuals')${cur}`, [name]),
  ]);
  if (!tot[0].n) return <p>No lines for “{name}”. <Link href="/">Back</Link></p>;
  const q = new URLSearchParams({ artist: name, ...(legacy ? { legacy } : {}) });
  return (
    <>
      <p><Link href="/">← Artist dashboard</Link></p>
      <h1 style={{ margin: '4px 0 14px' }}>{name}</h1>
      {legacy && !sp.legacy && <p className="note">This artist is only with former managers, so legacy lines are shown.</p>}
      {!legacy && <p className="note">Current managers only. <Link href={`?${new URLSearchParams({ ...(statement ? { basis: 'statement' } : {}), legacy: '1' })}`}>Include legacy managers</Link></p>}
      <div className="stats">
        <div className="stat"><b><Drill href={drill()}>{tot[0].n.toLocaleString()}</Drill></b><span>lines</span></div>
        <div className="stat"><b><Drill href={drill()}>{usd(tot[0].a)}</Drill></b><span>revenue</span></div>
        {m && <div className="stat"><b><Drill href={drill()}>{usd(tot[0].c)}</Drill></b><span>commission</span></div>}
        <a className="btn ghost" style={{ alignSelf: 'center' }} href={`/api/export?${q}`}>Export CSV</a>
        <Link className="btn ghost" style={{ alignSelf: 'center' }} href={`/touring?artist=${encodeURIComponent(name)}${legacy ? '&legacy=1' : ''}`}>Touring by show</Link>
      </div>
      {(tstat[0].shows > 0 || rstat[0].n > 0) && (
        <div className="stats">
          {tstat[0].shows > 0 && <>
            <div className="stat"><b><Link href={`/touring?artist=${encodeURIComponent(name)}${legacy ? '&legacy=1' : ''}`}>{tstat[0].shows}</Link></b><span>shows</span></div>
            <div className="stat"><b>{usd(avg(tstat[0].gross, tstat[0].shows))}</b><span>avg revenue / show</span></div>
            {m && <div className="stat"><b>{usd(avg(tstat[0].comm, tstat[0].shows))}</b><span>avg commission / show</span></div>}
          </>}
          {rstat[0].n > 0 && <>
            <div className="stat"><b><Link href={`/royalties?${new URLSearchParams({ artist: name, ...(legacy ? { legacy } : {}) })}`}>{rstat[0].n}</Link></b><span>royalty payments</span></div>
            <div className="stat"><b>{usd(m ? avg(rstat[0].comm, rstat[0].n_comm) : avg(rstat[0].rev, rstat[0].n_amt))}</b><span>avg {m ? 'commission' : 'revenue'} / payment</span></div>
            <div className="stat"><b>{usd(avg(m ? rstat[0].comm : rstat[0].rev, rstat[0].months))}</b><span>avg {m ? 'commission' : 'revenue'} / month ({rstat[0].months} months)</span></div>
          </>}
        </div>
      )}
      <ProjectedShows proj={proj} money={m} artist={name} />
      {m && <MeasureToggle current={measure} href={x => `?${new URLSearchParams({ ...(statement ? { basis: 'statement' } : {}), ...(sp.legacy ? { legacy: '1' } : {}), measure: x })}`} />}
      <div className="grid2">
        <div className="card"><h2 style={{ marginTop: 0 }}>{short} by year{' '}
          <Link href={`?${new URLSearchParams({ ...(statement ? {} : { basis: 'statement' }), ...(sp.legacy ? { legacy: '1' } : {}), ...(measure !== 'both' ? { measure } : {}) })}`} style={{ fontWeight: 400, fontSize: 13 }}>switch to {statement ? 'cash' : 'statement'} year</Link></h2><Breakdown rows={byYear} measure={measure} ordered href={k => drill({ year: k })} /></div>
        <div className="card"><h2 style={{ marginTop: 0 }}>{short} by type</h2><Breakdown rows={byType} measure={measure} href={k => drill({ type: ty(k) })} /></div>
        <div className="card"><h2 style={{ marginTop: 0 }}>Top sources</h2><Breakdown rows={bySource} measure={measure} limit={10} href={srcHref} /></div>
        {byRoyalty.length > 0 && <div className="card"><h2 style={{ marginTop: 0 }}>Royalties by source</h2><Breakdown rows={byRoyalty} measure={measure} limit={10} href={srcHref} /></div>}
      </div>
      <h2>Latest lines <Link href={`/database?${q}`} style={{ fontWeight: 400 }}>(see all, with filters)</Link></h2>
      <LinesTable rows={recent} money={m} />
    </>
  );
}
