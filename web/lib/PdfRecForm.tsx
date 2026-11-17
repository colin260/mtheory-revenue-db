'use client';
import { useState } from 'react';

type Line = { date: string | null; commission_type: string; source: string | null; description: string | null; region: string | null; amount: number | null; rate: number | null; commission: number | null; is_zero_row: boolean; support: string | null };
type Result = { ok: boolean; error?: string; demo?: boolean; model?: string; ms?: number; usage?: { input: number; output: number }; filename?: string;
  statement?: { statement_type: string; client_name: string; invoice_number: string | null; statement_year: number | null; statement_month: string | null; lines: Line[]; payments: { check_number: string | null; date: string | null; amount: number | null; balance_after: number | null }[]; notes: string[] };
  checks?: { level: 'ok' | 'warn' | 'fail'; message: string }[]; totals?: { amount: number; commission: number; paid: number } };

const usd = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const ICON = { ok: '✓', warn: '!', fail: '✕' } as const;
const COLOR = { ok: 'var(--accent)', warn: '#b7791f', fail: '#c0392b' } as const;
const PRICE = { input: 4 / 1e6, output: 20 / 1e6 }; // Claude Opus 5.5 list price per token

export function PdfRecForm({ configured, demo }: { configured: boolean; demo: boolean }) {
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function extract(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setRes(null);
    try { setRes(await (await fetch('/api/pdf-rec/extract', { method: 'POST', body: new FormData(e.currentTarget) })).json()); }
    catch { setRes({ ok: false, error: 'The upload failed or timed out. Try again, or split the PDF.' }); }
    setBusy(false);
  }
  async function download() {
    if (!res?.statement) return;
    const r = await fetch('/api/pdf-rec/xlsx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(res.statement) });
    if (!r.ok) return setRes({ ...res, error: 'Could not build the Excel file.' });
    const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || 'Commissions.xlsx';
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: name });
    a.click(); URL.revokeObjectURL(a.href);
  }

  const s = res?.statement, worst = res?.checks?.some(c => c.level === 'fail') ? 'fail' : res?.checks?.some(c => c.level === 'warn') ? 'warn' : 'ok';
  return (
    <>
      {!configured && <div className="notice err">PDF reading isn’t set up yet. Add an <code>ANTHROPIC_API_KEY</code> to this app’s settings to turn it on.</div>}
      {demo && <div className="notice">Demo mode: no API key, so uploads return made-up sample data. Not real.</div>}
      <form onSubmit={extract}>
        <div className="filters" style={{ gridTemplateColumns: '1fr' }}>
          <label>Commission statement or invoice (PDF, up to 4 MB)<input type="file" name="file" accept="application/pdf,.pdf" required disabled={!configured} /></label>
          <div className="actions"><button type="submit" disabled={busy || !configured}>{busy ? 'Reading the PDF…' : 'Read PDF'}</button></div>
        </div>
      </form>
      {busy && <p className="muted">This can take up to a minute for longer statements.</p>}
      {res && !res.ok && <div className="notice err"><b>Couldn’t read that PDF.</b> {res.error}</div>}
      {s && res?.ok && (
        <>
          <div className={`notice ${worst === 'fail' ? 'err' : 'ok'}`}>
            <b>{s.client_name}</b> · {s.statement_type.replaceAll('_', ' ')} · {[s.statement_month, s.statement_year].filter(Boolean).join(' ')}{s.invoice_number ? ` · invoice ${s.invoice_number}` : ''}
            <div className="muted" style={{ marginTop: 4 }}>{s.lines.length} lines{s.payments.length ? `, ${s.payments.length} payments` : ''} · extracted amount {usd(res.totals?.amount)} · commission {usd(res.totals?.commission)}
              {res.usage && !res.demo ? ` · ${res.usage.input.toLocaleString()} in / ${res.usage.output.toLocaleString()} out tokens (about $${(res.usage.input * PRICE.input + res.usage.output * PRICE.output).toFixed(2)})` : ''}</div>
          </div>
          <div className="card" style={{ marginBottom: 14 }}>
            <b>Checks</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, listStyle: 'none' }}>
              {res.checks?.map((c, i) => <li key={i} style={{ color: COLOR[c.level] }}><b>{ICON[c.level]}</b> <span style={{ color: 'var(--fg)' }}>{c.message}</span></li>)}
            </ul>
          </div>
          <div className="tablewrap"><table>
            <thead><tr><th>Date</th><th>Type</th><th>Source</th><th>Description</th><th className="num">Amount</th><th className="num">Rate</th><th className="num">Commission</th><th>Support</th></tr></thead>
            <tbody>{s.lines.map((l, i) => (
              <tr key={i} style={l.is_zero_row ? { color: 'var(--muted)', fontStyle: 'italic' } : undefined}>
                <td>{l.date}</td><td>{l.commission_type}</td><td>{l.source}</td><td className="memo">{l.description}</td>
                <td className="num">{usd(l.amount)}</td><td className="num">{l.rate != null ? `${(l.rate * 100).toFixed(3)}%` : ''}</td><td className="num">{usd(l.commission)}</td><td>{l.support}</td>
              </tr>))}
              {s.payments.map((p, i) => <tr key={'p' + i} style={{ background: 'color-mix(in srgb, #2e7d32 14%, transparent)', fontWeight: 600 }}>
                <td>{p.date}</td><td colSpan={3}>PAYMENT RECEIVED{p.check_number ? ` (check ${p.check_number})` : ''}</td><td className="num">{usd(p.amount)}</td><td /><td className="num">{p.balance_after != null ? `balance ${usd(p.balance_after)}` : ''}</td><td /></tr>)}
            </tbody></table></div>
          {s.notes.length > 0 && <div className="card" style={{ marginTop: 14 }}><b>Statement notes</b><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{s.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}
          <div className="actions" style={{ marginTop: 14 }}>
            <button type="button" onClick={download}>Download Excel rec</button>
            <span className="muted">Paste it into the tracker; the database picks it up when the tracker is loaded. Review the checks first.</span>
          </div>
        </>
      )}
    </>
  );
}
