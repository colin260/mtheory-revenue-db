'use client';
import { useState } from 'react';

type Result = { ok: boolean; dryRun?: boolean; rows?: number; inserted?: number; updated?: number; newManagers?: string[]; errors?: string[];
  source?: string; startRow?: number; parsed?: number; manager?: string; trackerYear?: number; warnings?: string[];
  skipped?: { payments: number; totals: number; notes: number; blank: number; duplicates: number } };

export function UploadForm({ managers }: { managers: string[] }) {
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [excel, setExcel] = useState(false);

  async function send(e: React.FormEvent<HTMLFormElement>, dryRun: boolean) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget.form ?? e.currentTarget);
    fd.set('dryRun', dryRun ? '1' : '0');
    setBusy(true); setRes(null);
    try { setRes(await (await fetch('/api/upload', { method: 'POST', body: fd })).json()); }
    catch { setRes({ ok: false, errors: ['Upload failed. Check your connection and try again.'] }); }
    setBusy(false);
  }

  const sk = res?.skipped, skippedBits = sk ? [sk.duplicates && `${sk.duplicates} already in the database`, sk.payments && `${sk.payments} payment rows`, sk.totals && `${sk.totals} total rows`, sk.notes && 'the notes block', sk.blank && `${sk.blank} blank rows`].filter(Boolean) : [];
  return (
    <form onSubmit={e => send(e, true)}>
      <div className="filters" style={{ gridTemplateColumns: '1fr' }}>
        <label>Excel rec (.xlsx) or CSV
          <input type="file" name="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required
            onChange={e => { setExcel(/\.xlsx$/i.test(e.target.files?.[0]?.name ?? '')); setRes(null); }} />
        </label>
        {excel && (
          <div className="filters" style={{ margin: 0, padding: 0, border: 0, background: 'none' }}>
            <label>Manager tab these lines go to
              <input name="manager" list="managers" required placeholder="e.g. Underoath" autoComplete="off" />
              <datalist id="managers">{managers.map(m => <option key={m} value={m} />)}</datalist>
            </label>
            <label>Tracker year<input name="trackerYear" inputMode="numeric" pattern="\d{4}" defaultValue="2026" required /></label>
            <label>Artist (only if the file has no Artist column)<input name="artist" placeholder="optional" /></label>
          </div>
        )}
        <div className="actions">
          <button type="submit" disabled={busy}>Preview (saves nothing)</button>
          <button type="button" disabled={busy || !res?.ok || !res.dryRun || !(res.rows ?? 0)} onClick={e => send(e as any, false)} title="Preview first, then import">Import</button>
        </div>
      </div>
      {res && (
        <div className={`notice ${res.ok ? 'ok' : 'err'}`}>
          {res.ok ? (
            <>
              <b>{res.dryRun ? 'Preview: nothing saved yet.' : 'Imported.'}</b>{' '}
              {res.source === 'excel'
                ? <>{res.parsed} lines read from the file: {res.inserted} new, {res.updated} updated{skippedBits.length ? <>. Skipped: {skippedBits.join(', ')}</> : null}.</>
                : <>{res.rows} rows: {res.inserted} new, {res.updated} updated existing lines.</>}
              {res.newManagers?.length ? <> New managers: {res.newManagers.join(', ')}.</> : null}
              {res.source === 'excel' && (res.rows ?? 0) > 0 && <div style={{ marginTop: 6 }}>To keep the tracker in step, paste these lines into the <b>{res.manager}</b> tab starting at <b>row {res.startRow}</b>.</div>}
              {res.source === 'excel' && !(res.rows ?? 0) && <div style={{ marginTop: 6 }}>Nothing new to add: every line in this file is already in the database.</div>}
              {res.warnings?.map((w, i) => <div key={i} style={{ marginTop: 6 }}>⚠ {w}</div>)}
              {res.dryRun && (res.rows ?? 0) > 0 && ' Click Import to save.'}
            </>
          ) : (
            <><b>Not imported.</b><ul>{res.errors?.map((x, i) => <li key={i}>{x}</li>)}</ul></>
          )}
        </div>
      )}
    </form>
  );
}
