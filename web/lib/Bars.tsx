import Link from 'next/link';
import { usd } from './format';
import { Drill } from './Drill';

export function Bars({ data, href }: { data: { k: string; v: number }[]; href?: (k: string) => string }) {
  const max = Math.max(1, ...data.map(d => Math.abs(d.v)));
  return <>{data.map(d => (
    <div className="bar" key={d.k}><span>{d.k}</span><i style={{ width: `${(Math.abs(d.v) / max) * 100}%` }} /><span className="num" style={{ textAlign: 'right' }}>{href ? <Drill href={href(d.k)}>{usd(d.v)}</Drill> : usd(d.v)}</span></div>
  ))}</>;
}

// Finance view: the artist's revenue (what they make) and our commission (what they make us), side by side.
export function DualBars({ data, href }: { data: { k: string; rev: number; comm: number }[]; href?: (k: string) => string }) {
  const max = Math.max(1, ...data.map(d => Math.max(Math.abs(d.rev), Math.abs(d.comm))));
  const w = (n: number) => `${Math.max(0.5, (Math.abs(n) / max) * 100)}%`;
  return (
    <>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--accent)', opacity: 0.45, marginRight: 4 }} />Revenue (artist's income)
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--accent)', margin: '0 4px 0 14px' }} />Commission (ours)
      </div>
      {data.map(d => (
        <div key={d.k} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 120px', gap: 10, alignItems: 'center', margin: '8px 0' }}>
          <span>{d.k}</span>
          <div>
            <i style={{ display: 'block', height: 9, borderRadius: 3, width: w(d.rev), background: 'var(--accent)', opacity: 0.45, marginBottom: 3 }} />
            <i style={{ display: 'block', height: 9, borderRadius: 3, width: w(d.comm), background: 'var(--accent)' }} />
          </div>
          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', lineHeight: 1.25 }}>
            {href ? <Drill href={href(d.k)}><span className="muted">{usd(d.rev)}</span></Drill> : <span className="muted">{usd(d.rev)}</span>}<br />{href ? <Drill href={href(d.k)}>{usd(d.comm)}</Drill> : usd(d.comm)}
          </span>
        </div>
      ))}
    </>
  );
}

export type Measure = 'revenue' | 'commission' | 'both';
export const measureFrom = (v: string | string[] | undefined, money: boolean): Measure => {
  const s = Array.isArray(v) ? v[0] : v;
  return !money ? 'revenue' : s === 'revenue' || s === 'commission' ? s : 'both';
};
export type Row = { k: string; rev: number; comm: number };

// One chart in whichever measure is selected. `ordered` keeps the given order (years); otherwise biggest first.
export function Breakdown({ rows, measure, ordered = false, limit, href }: { rows: Row[]; measure: Measure; ordered?: boolean; limit?: number; href?: (k: string) => string }) {
  const key = measure === 'commission' ? 'comm' : 'rev';
  const sorted = ordered ? rows : [...rows].sort((a, b) => b[key] - a[key]);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  if (!shown.length) return <p className="muted">Nothing to show.</p>;
  if (measure === 'both') return <DualBars data={shown} href={href} />;
  const total = rows.reduce((s, r) => s + r[key], 0);
  const max = Math.max(1, ...shown.map(r => Math.abs(r[key])));
  return <>{shown.map(r => (
    <div className="bar" key={r.k} style={{ gridTemplateColumns: '110px 1fr 150px' }}>
      <span>{r.k}</span>
      <i style={{ width: `${(Math.abs(r[key]) / max) * 100}%` }} />
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{href ? <Drill href={href(r.k)}>{usd(r[key])}</Drill> : usd(r[key])}{total > 0 && r[key] > 0 && <span className="muted"> · {((r[key] / total) * 100).toFixed(0)}%</span>}</span>
    </div>
  ))}</>;
}

// Revenue | Commission | Both switch (finance only). `href` builds the link for each choice.
export function MeasureToggle({ current, href }: { current: Measure; href: (m: Measure) => string }) {
  const items: [Measure, string][] = [['revenue', 'Revenue'], ['commission', 'Commission'], ['both', 'Both']];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0 12px' }}>
      <span className="muted">Break down:</span>
      <nav className="tabs">{items.map(([m, label]) => <a key={m} href={href(m)} className={current === m ? 'active' : ''}>{label}</a>)}</nav>
    </div>
  );
}

const PALETTE = ['#2f7d6b', '#4f8fd0', '#e0a43a', '#c4624f', '#8a6fc4', '#5fb3a1', '#d98aa8', '#8b9a46', '#9a9a93'];

// Donut chart with a legend (top `limit` slices, the rest folded into "Other"). Pure SVG, no client JS.
export function Donut({ rows, measure, limit = 5, href }: { rows: Row[]; measure: Measure; limit?: number; href?: (k: string) => string }) {
  const key = measure === 'commission' ? 'comm' : 'rev';
  const sorted = rows.filter(r => r[key] > 0).sort((a, b) => b[key] - a[key]);
  const total = sorted.reduce((s, r) => s + r[key], 0);
  if (!total) return <p className="muted">Nothing to show.</p>;
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit).reduce((s, r) => s + r[key], 0);
  const slices = [...top.map(r => ({ k: r.k, v: r[key], link: true })), ...(rest > 0 ? [{ k: `Other (${sorted.length - limit})`, v: rest, link: false }] : [])];
  const compact = (n: number) => `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`;
  const R = 15.915, C = 2 * Math.PI * R;       // circumference 100 → dash lengths are percentages
  let off = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 42 42" role="img" aria-label="Share by artist">
        <circle cx="21" cy="21" r={R} fill="none" stroke="var(--line)" strokeWidth="6" />
        {slices.map((s, i) => {
          const len = (s.v / total) * 100, el = (
            <circle key={s.k} cx="21" cy="21" r={R} fill="none" stroke={s.link ? PALETTE[i % 8] : PALETTE[8]} strokeWidth="6"
              strokeDasharray={`${Math.max(0, len - 0.4)} ${100 - Math.max(0, len - 0.4)}`} strokeDashoffset={25 - off} />
          );
          off += len; return el;
        })}
        <text x="21" y="20.5" textAnchor="middle" fontSize="4.6" fontWeight="600" fill="var(--fg)">{compact(total)}</text>
        <text x="21" y="25.5" textAnchor="middle" fontSize="2.4" fill="var(--muted)">{measure === 'commission' ? 'commission' : 'revenue'}</text>
      </svg>
      <ul>
        {slices.map((s, i) => (
          <li key={s.k}>
            <i style={{ background: s.link ? PALETTE[i % 8] : PALETTE[8] }} />
            <span>{href && s.link ? <Link href={href(s.k)}>{s.k}</Link> : s.k}</span>
            <b className="num">{usd(s.v)}</b><span className="muted">{((s.v / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
