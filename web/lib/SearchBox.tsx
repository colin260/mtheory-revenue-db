'use client';
import { useEffect, useRef, useState } from 'react';

// Search input with type-ahead from /api/suggest (names that contain or resemble what's typed).
export function SearchBox({ defaultValue }: { defaultValue: string }) {
  const [opts, setOpts] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onInput = (v: string) => {
    clearTimeout(timer.current);
    if (v.trim().length < 2) return setOpts([]);
    timer.current = setTimeout(async () => {
      try { setOpts((await (await fetch(`/api/suggest?q=${encodeURIComponent(v)}`)).json()).names); } catch { setOpts([]); }
    }, 150);
  };
  return (
    <>
      <input name="q" defaultValue={defaultValue} list="q-suggest" autoComplete="off"
        onChange={e => onInput(e.target.value)} placeholder="e.g. Orchard, Q3 merch, Trace Adkins…" />
      <datalist id="q-suggest">{opts.map(o => <option key={o} value={o} />)}</datalist>
    </>
  );
}
