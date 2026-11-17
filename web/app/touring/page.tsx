import Link from 'next/link';
import { query } from '@/lib/db';
import { scoped } from '@/lib/scope';
import { requireViewer } from '@/lib/session';
import { showsSql, touringLines, yearCond } from '@/lib/touring';
import { basisLabel, onlyCurrent, yearOptions } from '@/lib/filters';
import { usd, day } from '@/lib/format';
import { Bars } from '@/lib/Bars';
import { Drill, dbHref } from '@/lib/Drill';
import { avg } from '@/lib/stats';
import { projectedFor } from '@/lib/projections';
import { ProjectedShows } from '@/lib/ProjectedShows';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const ORDER: Record<string, string> = {
  date: 'show_date asc nulls last, first_deposit asc nulls last, label', name: 'label', gross: 'gross desc', expenses: 'expenses desc',
  net: 'net desc', margin: '(case when gross = 0 then null else net / gross end) desc nulls last', commission: 'commission desc nulls last',
};

export default async function Touring({ searchParams }: { searchParams: Promise<SP> }) {
  const viewer = await requireViewer();
  const money = viewer.sees.money;
  const sp = await searchParams;
  const legacy = one(sp.legacy) ? '1' : '';

  const artists = (await query<{ artist: string; n: number }>(
    `select artist, count(*)::int n from ${scoped(viewer)} where commission_type like 'Touring%' and artist is not null${onlyCurrent(legacy)} group by 1 order by 2 desc, 1`)).map(r => r.artist);
  const artist = artists.includes(one(sp.artist)) ? one(sp.artist) : artists.includes('Underoath') ? 'Underoath' : artists[0];
  if (!artist) return <p className="muted">No touring lines available.</p>;
  const sort = ORDER[one(sp.sort)] ? one(sp.sort) : 'date';
  const sel = one(sp.show);
  const basis = one(sp.basis) === 'statement' ? 'statement' : '';
  const years = (await query<{ v: number }>(yearOptions(`(select * from ${scoped(viewer)} where commission_type like 'Touring%'${onlyCurrent(legacy)}) rt`, basis))).map(r => String(r.v));
  const year = years.includes(one(sp.year)) ? one(sp.year) : '';
  const yc = yearCond(basis, year) + onlyCurrent(legacy, 'v.');

  const shows = await query(`${showsSql(viewer, yc)} order by ${ORDER[sort]}`, [artist]);
  const tot = shows.reduce((a, s) => ({ gross: a.gross + s.gross, expenses: a.expenses + s.expenses, net: a.net + s.net, commission: a.commission + (s.commission ?? 0), n: a.n + s.n }),
    { gross: 0, expenses: 0, net: 0, commission: 0, n: 0 });
  const proj = await projectedFor(viewer, artist);
  const maxNet = Math.max(1, ...shows.map(s => Math.abs(s.net)));
  const hasExpenses = tot.expenses > 0;
  const showLines = shows.some((s: any) => s.n > 1);       // the Lines column only matters when a show has several lines (guarantee + expenses)
  const vipShows = shows.filter(s => s.vip);
  const showRows = shows.filter(s => s.gross > 0);          // a show = a row with revenue / a guarantee (expense-only and adjustment rows are not shows)
  const nShows = showRows.length;
  // Underoath is paid on NET (guarantee less expenses). Finance-only analysis: commission as a % of the guarantee, and what a gross deal at the same rate would have paid.
  const net_deal = money && artist === 'Underoath';
  const grossComm = (s: any) => (s.gross && s.rate != null ? s.gross * s.rate : null);
  const gtot = shows.reduce((a, s) => ({ gross: a.gross + (grossComm(s) != null ? s.gross : 0), would: a.would + (grossComm(s) ?? 0), actual: a.actual + (grossComm(s) != null ? (s.commission ?? 0) : 0) }), { gross: 0, would: 0, actual: 0 });
  const block = shows.some(s => s.k.startsWith('b'));          // Underoath-style guarantee/expense blocks (else expenses are the negative lines)
  const drill = (extra: Record<string, string> = {}) => dbHref({ type: 'Touring*', artist, year, basis, legacy, ...extra });

  const link = (extra: Record<string, string>) => `/touring?${new URLSearchParams({ artist, sort, ...(basis ? { basis } : {}), ...(legacy ? { legacy } : {}), ...(year ? { year } : {}), ...(sel ? { show: sel } : {}), ...extra })}`;
  const head = (key: string, label: string, cls = '') =>
    <th className={cls}><Link className={`sort ${sort === key ? 'on' : ''}`} href={link({ sort: key })}>{label}</Link></th>;

  // Selected show: its lines, grouped by expense category
  const chosen = sel ? shows.find(s => s.k === sel) : undefined;
  const lines = chosen ? await query(`select memo, source, amount::float8 amount, commission::float8 commission, deposit_date, source_row, sheet_url
      from ${touringLines(viewer, yc)} where k = $2 order by source_row`, [artist, sel]) : [];
  const cats = new Map<string, number>();
  for (const l of lines) if (/ - Expense$/.test(l.source ?? '')) { const c = String(l.memo ?? '').split(' – ')[0]; cats.set(c, (cats.get(c) ?? 0) - l.amount); }
  const catData = [...cats].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);

  return (
    <>
      <form className="filters" method="get" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <label>Artist
          <select name="artist" defaultValue={artist}>{artists.map(a => <option key={a}>{a}</option>)}</select>
        </label>
        <label>Year basis
          <select name="basis" defaultValue={basis}><option value="">Cash year (tracker sheet)</option><option value="statement">Statement year (as reported)</option></select>
        </label>
        <label>{basisLabel(basis)}
          <select name="year" defaultValue={year}><option value="">All years</option>{years.map(y => <option key={y}>{y}</option>)}</select>
        </label>
        <input type="hidden" name="sort" value={sort} />
        <div className="actions"><label className="check"><input type="checkbox" name="legacy" value="1" defaultChecked={!!legacy} /> Include legacy managers</label><button type="submit">Show</button></div>
      </form>

      <div className="stats">
        <div className="stat"><b>{nShows}</b><span>shows / tours</span></div>
        <div className="stat"><b><Drill href={hasExpenses ? drill(block ? { source: 'Live Performance - Guarantees' } : { sign: 'pos' }) : drill()}>{usd(tot.gross)}</Drill></b><span>{hasExpenses && block ? 'guarantees' : 'revenue'}</span></div>
        {hasExpenses && <div className="stat"><b><Drill href={drill(block ? { source: 'Live Performance - Expense' } : { sign: 'neg' })}>{usd(tot.expenses)}</Drill></b><span>expenses</span></div>}
        {hasExpenses && <div className="stat"><b><Drill href={drill()}>{usd(tot.net)}</Drill></b><span>net</span></div>}
        {hasExpenses && tot.gross > 0 && <div className="stat"><b>{pct(tot.net / tot.gross)}</b><span>net margin</span></div>}
        {money && <div className="stat"><b><Drill href={drill()}>{usd(tot.commission)}</Drill></b><span>commission</span></div>}
        {nShows > 0 && <>
          <div className="stat"><b>{usd(avg(tot.gross, nShows))}</b><span>avg {hasExpenses && block ? 'guarantee' : 'revenue'} / show</span></div>
          {hasExpenses && <div className="stat"><b>{usd(avg(tot.net, nShows))}</b><span>avg net / show</span></div>}
          {money && <div className="stat"><b>{usd(avg(tot.commission, nShows))}</b><span>avg commission / show</span></div>}
        </>}
        {net_deal && gtot.gross > 0 && <>
          <div className="stat"><b>{pct(gtot.actual / gtot.gross)}</b><span>commission as % of guarantee (net deal)</span></div>
          <div className="stat"><b>{usd(gtot.would)}</b><span>if paid on gross guarantees</span></div>
          <div className="stat"><b>{usd(gtot.would - gtot.actual)}</b><span>given up by the net deal</span></div>
        </>}
      </div>

      <ProjectedShows proj={proj} money={money} artist={artist} />

      {proj.shows.length > 0 && <h2 style={{ marginTop: 28 }}>Past shows</h2>}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              {head('name', 'Show / city')}{head('date', 'Show date')}<th>First deposit</th>
              {head('gross', hasExpenses && block ? 'Guarantee' : 'Revenue', 'num')}
              {hasExpenses && head('expenses', 'Expenses', 'num')}
              {hasExpenses && head('net', 'Net', 'num')}
              {hasExpenses && head('margin', 'Margin', 'num')}
              {hasExpenses && <th>Net vs. best</th>}
              {money && head('commission', 'Commission', 'num')}
              {net_deal && <><th className="num" title="Commission / guarantee">% of guarantee</th><th className="num" title="Guarantee x rate, if not a net deal">If on gross</th><th className="num">Difference</th></>}
              {showLines && <th className="num">Lines</th>}
              <th>Tracker</th>
            </tr>
          </thead>
          <tbody>
            {[...shows.filter(s => !s.vip), ...(vipShows.length ? [{ k: 'vip-head' }] : []), ...vipShows].map((s: any) => s.k === 'vip-head' ? (
              <tr key="vip-head"><td colSpan={11} style={{ fontWeight: 600, paddingTop: 14 }}>VIP ({vipShows.length}) <span className="muted" style={{ fontWeight: 400 }}>Touring - VIP lines, part of the totals above and below</span></td></tr>
            ) : (
              <tr key={s.k} style={s.k === sel ? { background: 'color-mix(in srgb, var(--accent) 12%, transparent)' } : undefined}>
                <td className="memo"><Link href={link({ show: s.k })}>{s.label}</Link></td>
                <td>{day(s.show_date)}</td>
                <td>{day(s.first_deposit)}</td>
                <td className="num">{s.gross || !s.expenses ? <Drill href={link({ show: s.k })}>{usd(s.gross)}</Drill> : ''}</td>
                {hasExpenses && <td className="num">{s.expenses ? <Drill href={link({ show: s.k })}>{usd(s.expenses)}</Drill> : ''}</td>}
                {hasExpenses && <td className="num"><b><Drill href={link({ show: s.k })}>{usd(s.net)}</Drill></b></td>}
                {hasExpenses && <td className="num">{s.gross && s.expenses ? pct(s.net / s.gross) : ''}</td>}
                {hasExpenses && <td style={{ minWidth: 110 }}><i style={{ display: 'block', height: 10, borderRadius: 3, width: `${Math.max(1, (Math.abs(s.net) / maxNet) * 100)}%`, background: s.net < 0 ? '#c0392b' : 'var(--accent)' }} /></td>}
                {money && <td className="num"><Drill href={link({ show: s.k })}>{usd(s.commission)}</Drill></td>}
                {net_deal && <><td className="num">{s.gross ? pct((s.commission ?? 0) / s.gross) : ''}</td><td className="num">{grossComm(s) != null ? usd(grossComm(s)) : ''}</td><td className="num">{grossComm(s) != null ? usd(grossComm(s)! - (s.commission ?? 0)) : ''}</td></>}
                {showLines && <td className="num"><Drill href={link({ show: s.k })}>{s.n}</Drill></td>}
                <td>{s.sheet_url ? <a href={s.sheet_url} target="_blank" rel="noreferrer" title="Open the first line of this show in the Google Sheet">Row {s.sheet_row}</a> : ''}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 600 }}>
              <td>Total</td><td /><td />
              <td className="num">{usd(tot.gross)}</td>
              {hasExpenses && <td className="num">{usd(tot.expenses)}</td>}
              {hasExpenses && <td className="num">{usd(tot.net)}</td>}
              {hasExpenses && <td className="num">{tot.gross ? pct(tot.net / tot.gross) : ''}</td>}
              {hasExpenses && <td />}{money && <td className="num">{usd(tot.commission)}</td>}{net_deal && <><td className="num">{gtot.gross ? pct(gtot.actual / gtot.gross) : ''}</td><td className="num">{usd(gtot.would)}</td><td className="num">{usd(gtot.would - gtot.actual)}</td></>}{showLines && <td className="num">{tot.n}</td>}<td />
            </tr>
          </tbody>
        </table>
      </div>

      {chosen && (
        <>
          <h2>{chosen.label}: where the money went <Link href={link({ show: '' })} style={{ fontWeight: 400, fontSize: 13 }}>close</Link></h2>
          <div className="grid2">
            <div className="card"><h2 style={{ marginTop: 0 }}>Expenses by category</h2><Bars data={catData} /></div>
            <div className="tablewrap">
              <table>
                <thead><tr><th>Line</th><th className="num">Amount</th><th className="num">% of guarantee</th><th>Tracker</th></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td className="memo">{l.memo}</td>
                      <td className="num">{l.amount == null ? '' : usd(l.amount)}</td>
                      <td className="num">{l.amount != null && chosen.gross ? pct(l.amount / chosen.gross) : ''}</td>
                      <td>{l.sheet_url ? <a href={l.sheet_url} target="_blank" rel="noreferrer">Row {l.source_row}</a> : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
