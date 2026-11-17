'use client';
import { useEffect, useState } from 'react';

type Mode = 'system' | 'light' | 'dark';
const NEXT: Record<Mode, Mode> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<Mode, string> = { system: 'Theme: auto', light: 'Theme: light', dark: 'Theme: dark' };

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('system');
  useEffect(() => {
    try { const m = localStorage.getItem('theme'); if (m === 'light' || m === 'dark') setMode(m); } catch {}
  }, []);
  const click = () => {
    const m = NEXT[mode];
    setMode(m);
    try { m === 'system' ? localStorage.removeItem('theme') : localStorage.setItem('theme', m); } catch {}
    m === 'system' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', m);
  };
  return <button type="button" className="btn ghost" onClick={click} aria-label="Switch colour theme">{LABEL[mode]}</button>;
}
