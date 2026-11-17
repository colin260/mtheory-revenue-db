import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { auth, devLoginEnabled, googleConfigured, signIn, signOut } from '@/auth';
import { getViewer } from '@/lib/session';
import { listUsers } from '@/lib/users';

export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (await getViewer()) redirect('/');
  const session = await auth(); // signed in with Google, but not on the access list
  const devUsers = devLoginEnabled ? await listUsers() : [];

  return (
    <div style={{ maxWidth: 440, margin: '48px auto' }}>
      <h1 style={{ marginTop: 0 }}>Sign in</h1>
      {session?.user?.email ? (
        <div className="notice err">
          <b>{session.user.email}</b> is signed in but hasn’t been given access. Ask the finance team to add you.
          <form action={async () => { 'use server'; await signOut({ redirectTo: '/login' }); }} style={{ marginTop: 10 }}>
            <button type="submit" className="btn ghost">Sign out</button>
          </form>
        </div>
      ) : (
        <>
          {error && <div className="notice err">Sign-in failed. Use your company Google account, and make sure you’ve been added.</div>}
          {googleConfigured && (
            <form action={async () => { 'use server'; await signIn('google', { redirectTo: '/' }); }}>
              <button type="submit">Sign in with Google</button>
            </form>
          )}
          {!googleConfigured && !devLoginEnabled && <div className="notice err">Sign-in isn’t configured yet (set AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET and ALLOWED_EMAIL_DOMAIN).</div>}
          {devLoginEnabled && (
            <form className="card" style={{ marginTop: 20 }} action={async (fd: FormData) => {
              'use server';
              try { await signIn('dev', { email: String(fd.get('email') || ''), redirectTo: '/' }); }
              catch (e) { if (e instanceof AuthError) redirect('/login?error=1'); throw e; }
            }}>
              <b>Developer sign-in</b> <span className="muted">(local only, disabled in production)</span>
              <label style={{ marginTop: 10 }}>Sign in as
                <select name="email">{devUsers.map(u => <option key={u.email} value={u.email}>{u.email} ({u.role})</option>)}</select>
              </label>
              <div style={{ marginTop: 10 }}><button type="submit">Sign in</button></div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
