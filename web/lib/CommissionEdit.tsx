'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usd } from './format';

// Finance-only: type the projected commission for one show. Blank = back to fee x the artist's usual rate.
export function CommissionEdit({ artist, showDate, venue, value, custom }: { artist: string; showDate: string; venue: string; value: number | null; custom: boolean }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const router = useRouter();
  if (!open) return (
    <button type="button" className="linklike" onClick={() => setOpen(true)} title="Change the commission for this show"
      style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer', textDecoration: 'underline dotted', font: 'inherit', fontWeight: custom ? 700 : undefined }}>
      {value != null ? usd(value) : 'set'}
    </button>);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = String(new FormData(e.currentTarget).get('c') ?? '').replace(/[$,\s]/g, '');
    if (raw && Number.isNaN(Number(raw))) { setErr('Numbers only'); return; }
    setBusy(true); setErr('');
    const r = await fetch('/api/projections/commission', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ artist, showDate, venue, commission: raw === '' ? null : Number(raw) }) }).then(r => r.json()).catch(() => ({ ok: false, error: 'Save failed' }));
    setBusy(false);
    if (!r.ok) { setErr(r.error || 'Save failed'); return; }
    setOpen(false); router.refresh();
  }
  return (
    <form onSubmit={save} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
      <input name="c" defaultValue={custom && value != null ? String(value) : ''} placeholder="usual rate" inputMode="decimal" autoFocus style={{ width: 100, textAlign: 'right' }} />
      <button type="submit" disabled={busy}>Save</button>
      <button type="button" disabled={busy} onClick={() => { setOpen(false); setErr(''); }}>Cancel</button>
      {err && <span style={{ color: '#c0392b' }}>{err}</span>}
    </form>
  );
}
