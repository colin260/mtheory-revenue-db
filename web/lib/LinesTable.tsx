import Link from 'next/link';
import { usd, day } from './format';

type Sorting = { current: string; href: (sort: string) => string };
export function LinesTable({ rows, money, sorting, company = false }: { rows: any[]; money: boolean; sorting?: Sorting; company?: boolean }) {
  // Clickable header when sorting is on: first click ascending, second click descending.
  const th = (col: string, label: string, cls = '') => {
    if (!sorting) return <th className={cls}>{label}</th>;
    const on = sorting.current.replace(/^-/, '') === col, desc = sorting.current.startsWith('-');
    return <th className={cls}><Link className={`sort ${on ? 'on' : ''}`} href={sorting.href(on && !desc ? `-${col}` : col)}>{label}{on ? (desc ? ' ↓' : ' ↑') : ''}</Link></th>;
  };
  if (!rows.length) return <p className="muted">No lines match.</p>;
  const shows = rows.some(r => r.show_date);
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            {th('deposit_date', 'Deposit')}{shows && th('show_date', 'Show date')}{th('artist', 'Artist')}{company && th('manager', 'Company')}<th>Manager</th>{th('commission_type', 'Type')}{th('source', 'Source')}<th>Statement</th>
            {th('memo', 'Memo')}{th('amount', 'Amount', 'num')}{money && <>{th('rate', 'Rate', 'num')}{th('commission', 'Commission', 'num')}<th>Support</th></>}<th>Tracker</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.line_id}>
              <td>{day(r.deposit_date)}</td>
              {shows && <td>{day(r.show_date)}</td>}
              <td>{r.artist ? <Link href={`/artists/${encodeURIComponent(r.artist)}`}>{r.artist}</Link> : <span className="muted">—</span>}</td>
              {company && <td>{r.manager}</td>}
              <td>{r.mgr_names ?? <span className="muted">—</span>}</td>
              <td>{r.commission_type ?? <span className="muted">—</span>}</td>
              <td>{r.source ? <Link href={`/sources/${encodeURIComponent(r.source)}`}>{r.source}</Link> : null}</td>
              <td>{[r.statement_month, r.statement_year].filter(Boolean).join(' ')}</td>
              <td className="memo">{r.memo}</td>
              <td className="num">{usd(r.amount)}</td>
              {money && <>
              <td className="num">{r.rate != null ? `${(Number(r.rate) * 100).toFixed(1)}%` : ''}</td>
              <td className="num">{usd(r.commission)}</td>
              <td>{r.support_file ? (/^https?:/.test(r.support_file) ? <a href={r.support_file} target="_blank" rel="noreferrer">Open</a> : r.support_file) : ''}</td>
              </>}
              <td>{r.sheet_url ? <a href={r.sheet_url} target="_blank" rel="noreferrer">Row {r.source_row ?? ''}</a> : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
