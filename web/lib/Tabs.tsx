'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

const TABS = [{ href: '/', label: 'Artist dashboard' }, { href: '/touring', label: 'Touring' }, { href: '/royalties', label: 'Royalties' }, { href: '/database', label: 'Database' }];
const KEY = 'lastArtist';

// The last artist picked (artist page, Touring or Royalties) is remembered in this browser, so the
// Artist dashboard, Touring and Royalties tabs open on that same artist.
export function Tabs() {
  const path = usePathname();
  const sp = useSearchParams();
  const [last, setLast] = useState('');
  useEffect(() => {
    let a: string | null = null;
    if (path.startsWith('/artists/')) a = decodeURIComponent(path.slice('/artists/'.length).split('/')[0]);
    else if (path === '/touring' || path === '/royalties') a = sp.get('artist');   // '' = "All artists" on Royalties: forget
    try {
      if (a === '') localStorage.removeItem(KEY);
      else if (a) localStorage.setItem(KEY, a);
      setLast(localStorage.getItem(KEY) ?? '');
    } catch { setLast(a ?? ''); }
  }, [path, sp]);
  const href = (h: string) => {
    if (!last) return h;
    if (h === '/') return `/artists/${encodeURIComponent(last)}`;
    if (h === '/touring' || h === '/royalties') return `${h}?artist=${encodeURIComponent(last)}`;
    return h;
  };
  // Artist detail pages belong to the dashboard tab.
  const active = (h: string) => (h === '/' ? path === '/' || path.startsWith('/artists') : path.startsWith(h));
  return (
    <nav className="tabs" aria-label="Sections">
      {TABS.map(t => <Link key={t.href} href={href(t.href)} className={active(t.href) ? 'active' : ''} aria-current={active(t.href) ? 'page' : undefined}>{t.label}</Link>)}
    </nav>
  );
}
