'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [{ href: '/', label: 'Artist dashboard' }, { href: '/touring', label: 'Touring' }, { href: '/royalties', label: 'Royalties' }, { href: '/database', label: 'Database' }];

export function Tabs() {
  const path = usePathname();
  // Artist detail pages belong to the dashboard tab.
  const active = (href: string) => (href === '/' ? path === '/' || path.startsWith('/artists') : path.startsWith(href));
  return (
    <nav className="tabs" aria-label="Sections">
      {TABS.map(t => <Link key={t.href} href={t.href} className={active(t.href) ? 'active' : ''} aria-current={active(t.href) ? 'page' : undefined}>{t.label}</Link>)}
    </nav>
  );
}
