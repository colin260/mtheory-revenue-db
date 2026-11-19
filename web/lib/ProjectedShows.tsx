import { usd, day } from './format';
import Link from 'next/link';
import type { ProjectedSet } from './projections';
import { CommissionEdit } from './CommissionEdit';

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
// Where this artist's shows came from, from each row's source (never assumed): "Gigwell" or "Upload: <file name>".
const from = (src: string | null) => !src ? 'an upload' : /^gigwell$/i.test(src) ? 'the booking system (Gigwell)' : /^upload:/i.test(src) ? `the uploaded file ${src.replace(/^upload:\s*/i, '')}` : src;
const list = (a: string[]) => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;

// Future shows for one artist (projected_shows): month by month with subtotals. Commission is finance-only.
// yearHref builds the link for another projection year; years with shows are offered when there is more than one.
export function ProjectedShows({ proj, money, artist, yearHref }: { proj: ProjectedSet; money: boolean; artist: string; yearHref?: (y: number) => string }) {
  if (!proj.shows.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const live = proj.shows.filter(s => s.status !== 'Expired'), expired = proj.shows.filter(s => s.status === 'Expired');
  const pTot = live.reduce((a, s) => ({ fee: a.fee + (s.fee ?? 0), comm: a.comm + (s.commission ?? 0) }), { fee: 0, comm: 0 });
  return (
        <>
          <h2 style={{ marginTop: 28 }}>Projected shows (not yet paid){proj.year ? <> · {proj.year}</> : null}</h2>
          {yearHref && (proj.years?.length ?? 0) > 1 && <p className="note">Year: {proj.years!.map((y, i) => <span key={y}>{i ? ' · ' : ''}{y === proj.year ? <b>{y}</b> : <Link href={yearHref(y)}>{y}</Link>}</span>)}</p>}
          <p className="note">
            From {list([...new Set(proj.shows.map(s => from(s.source)))])}, not yet deposited{money && proj.rate != null ? <> · commission at {pct(proj.rate)}, {proj.setRate ? <>the rate set for {artist} (no touring lines yet)</> : <>the same rate as {artist}’s touring lines</>}</> : null}.
            {' '}Shows with no fee yet and expired holds are listed but not counted.
          </p>
          <div className="stats">
            <div className="stat"><b>{live.length}</b><span>projected shows</span></div>
            <div className="stat"><b>{usd(pTot.fee)}</b><span>projected guarantees</span></div>
            {money && <div className="stat"><b>{usd(pTot.comm)}</b><span>projected commission</span></div>}
            <div className="stat"><b>{live.filter(s => s.status === 'Confirmed').length}</b><span>confirmed</span></div>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Show / city</th><th>Show date</th><th>Contact</th><th>Status</th><th className="num">Guarantee</th>{money && <th className="num">Rate</th>}{money && <th className="num">Projected commission</th>}</tr>
              </thead>
              <tbody>
                {(() => {
                  const out: React.ReactNode[] = []; let m = '';
                  const flush = () => { if (!m) return; const g = live.filter(s => s.show_date.slice(0, 7) === m); out.push(
                    <tr key={`t${m}`} style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}><td colSpan={4}><b>{new Date(m + '-15').toLocaleString('en-US', { month: 'long', year: 'numeric' })}</b> <span className="muted">· {g.length} shows</span></td>
                      <td className="num"><b>{usd(g.reduce((a, s) => a + (s.fee ?? 0), 0))}</b></td>{money && <td />}{money && <td className="num"><b>{usd(g.reduce((a, s) => a + (s.commission ?? 0), 0))}</b></td>}</tr>); };
                  for (const s of proj.shows) {
                    const mm = s.show_date.slice(0, 7);
                    if (mm !== m) { flush(); m = mm; }
                    const dead = s.status === 'Expired';
                    out.push(
                      <tr key={s.show_date + s.venue} style={dead ? { opacity: 0.5 } : undefined}>
                        <td className="memo">{s.venue}<span className="muted"> · {[s.city, s.state].filter(Boolean).join(', ')}</span></td>
                        <td>{day(s.show_date)}</td><td>{s.contact}</td>
                        <td>{s.status === 'Confirmed' ? <b>Confirmed</b> : <span className="muted">{s.status}{s.fee ? '' : ' · no fee yet'}</span>}{s.show_date < today && !dead ? <span className="muted"> · played, awaiting payment</span> : null}</td>
                        <td className="num">{s.fee ? usd(s.fee) : <span className="muted">—</span>}</td>
                        {money && <td className="num">{dead ? '' : s.custom ? <span className="muted" title="Commission typed in for this show">custom</span> : proj.rate != null && s.fee ? pct(proj.rate) : ''}</td>}
                        {money && <td className="num">{dead ? '' : <CommissionEdit artist={artist} showDate={s.show_date} venue={s.venue} value={s.commission} custom={s.custom} />}</td>}
                      </tr>);
                  }
                  flush(); return out;
                })()}
              </tbody>
            </table>
          </div>
          {expired.length > 0 && <p className="note">{expired.length} expired holds are greyed out.</p>}
          {money && <p className="note">Click a projected commission to type a different amount for that show (finance only). Clear the box and save to go back to the usual rate.</p>}
        </>
  );
}
