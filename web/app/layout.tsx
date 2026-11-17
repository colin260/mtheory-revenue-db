import './globals.css';
import Link from 'next/link';
import Script from 'next/script';
import { signOut } from '@/auth';
import { ThemeToggle } from '@/lib/ThemeToggle';
import { Tabs } from '@/lib/Tabs';
import { getViewer } from '@/lib/session';

export const metadata = { title: 'Mtheory Revenue' };
export const dynamic = 'force-dynamic';

// Applies a saved light/dark choice before first paint (no flash).
const THEME_INIT = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;
const ROLE: Record<string, string> = { finance: 'Finance', senior: 'Senior team', staff: 'Staff' };

export default async function Layout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">{THEME_INIT}</Script>
        <header className="top">
          <Link href="/" className="brand"><h1>Mtheory Revenue</h1></Link>
          {viewer && <Tabs />}
          <span className="spacer" />
          {viewer?.role === 'finance' && <><Link href="/upload">Add data</Link><Link href="/admin/users">Users</Link></>}
          <ThemeToggle />
          {viewer && (
            <form action={async () => { 'use server'; await signOut({ redirectTo: '/login' }); }}>
              <span className="muted" title={viewer.email}>{viewer.name || viewer.email} · {ROLE[viewer.role]} </span>
              <button type="submit" className="btn ghost">Sign out</button>
            </form>
          )}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
