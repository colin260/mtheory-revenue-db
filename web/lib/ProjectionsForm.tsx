'use client';
import { useState } from 'react';
import type { ProjResult } from './importProjections';
import { usd, day } from './format';

type Res = Partial<ProjResult> & { ok: boolean; errors?: string[] };

// Upload upcoming shows (Gigwell export or similar) into projected_shows. Preview first, then Import.
export function ProjectionsForm({ artists }: { artists: string[] }) {
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(form: HTMLFormElement, dryRun: boolean) {
    const fd = new FormData(form);
    fd.set('dryRun', dryRun ? '1' : '0');
    fd.set('replace', (form.elements.namedItem('replaceBox') as HTMLInputElement).checked ? '1' : '0');
    setBusy(true); setRes(null);
    try { setRes(await (await fetch('/api/projections', { method: 'POST', body: fd })).json()); }
    catch { setRes({ ok: false, errors: ['Upload failed. Check your connection and try again.'] }); }
    setBusy(false);
  }

  const sk = res?.skipped, bits = sk ? [sk.duplicates && `${sk.duplicates} repeated rows`, sk.unknownArtist && `${sk.unknownArtist} with an unknown artist`].filter(Boolean) : [];
  return (
    <form onSubmit={e => { e.preventDefault(); send(e.currentTarget, true); }}>
      <div className="filters">
        <label style={{ gridColumn: '1/-1' }}>Shows file (.xlsx or .csv)
          <input type="file" name="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required onChange={() => setRes(null)} />
        </label>
        <label>Artist (only if the file has no Artist column)
          <input name="artist" list="proj-artists" placeholder="optional" autoComplete="off" onChange={() => setRes(null)} />
          <datalist id="proj-artists">{artists.map(a => <option key={a} value={a} />)}</datalist>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', alignSelf: 'end' }}>
          <input type="checkbox" name="replaceBox" style={{ width: 'auto' }} onChange={() => setRes(null)} />
          Replace: remove this artist&apos;s saved shows that aren&apos;t in the file (e.g. ones since paid)
        </label>
        <div className="actions" style={{ gridColumn: '1/-1' }}>
          <button type="submit" disabled={busy}>Preview (saves nothing)</button>
          <button type="button" disabled={busy || !res?.ok || !res.dryRun || !res.shows?.length} onClick={e => send(e.currentTarget.form!, false)} title="Preview first, then import">Import</button>
        </div>
      </div>
      {res && (
        <div className={`notice ${res.ok ? 'ok' : 'err'}`}>
          {res.ok ? (
            <>
              <b>{res.dryRun ? 'Preview: nothing saved yet.' : 'Imported.'}</b>{' '}
              {res.read} shows read: {res.inserted} new, {res.updated} updated{res.removed ? `, ${res.removed} removed` : ''}{bits.length ? <>. Skipped: {bits.join(', ')}</> : null}.
              {res.byArtist?.map(a => <div key={a.artist} style={{ marginTop: 6 }}><b>{a.artist}</b>: {a.shows} shows, {usd(a.fees)} in guarantees (expired holds not counted). {!res.dryRun && <a href={`/touring?artist=${encodeURIComponent(a.artist)}`}>See it on the Touring tab</a>}</div>)}
              {res.warnings?.map((w, i) => <div key={i} style={{ marginTop: 6 }}>⚠ {w}</div>)}
              {res.dryRun && !!res.shows?.length && <div style={{ marginTop: 6 }}>Check the list below, then click Import to save.</div>}
            </>
          ) : (
            <><b>Not imported.</b><ul>{res.errors?.map((x, i) => <li key={i}>{x}</li>)}</ul></>
          )}
        </div>
      )}
      {res?.ok && !!res.shows?.length && (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Artist</th><th>Show date</th><th>Venue / city</th><th>Contact</th><th>Status</th><th className="num">Guarantee</th><th /></tr></thead>
            <tbody>
              {res.shows.map(s => (
                <tr key={s.artist + s.show_date + s.venue} style={s.status === 'Expired' ? { opacity: 0.5 } : undefined}>
                  <td>{s.artist}</td><td>{day(s.show_date)}</td>
                  <td className="memo">{s.venue}<span className="muted">{s.city || s.state ? ` · ${[s.city, s.state].filter(Boolean).join(', ')}` : ''}</span></td>
                  <td>{s.contact}</td><td>{s.status}</td>
                  <td className="num">{s.fee ? usd(s.fee) : <span className="muted">—</span>}</td>
                  <td className="muted">{s.isNew ? 'new' : 'update'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </form>
  );
}
