import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { findUser } from '@/lib/users';

const domain = (process.env.ALLOWED_EMAIL_DOMAIN || '').toLowerCase();
export const googleConfigured = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
// Dev-only shortcut so the app can be tested without Google. Never available in production.
export const devLoginEnabled = process.env.NODE_ENV !== 'production';

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/login', error: '/login' },
  providers: [
    ...(googleConfigured ? [Google({ authorization: { params: { hd: domain || undefined, prompt: 'select_account' } } })] : []),
    ...(devLoginEnabled
      ? [Credentials({
          id: 'dev',
          credentials: { email: {} },
          async authorize(c) {
            const u = await findUser(String(c?.email || ''));
            return u ? { id: u.email, email: u.email, name: u.name ?? u.email } : null;
          },
        })]
      : []),
  ],
  callbacks: {
    // The hd parameter is only a hint to Google, so the domain is re-checked here.
    // Being on the list (app_users) is checked on every request in getUser().
    async signIn({ account, profile }) {
      if (account?.provider === 'dev') return devLoginEnabled;
      const email = (profile?.email || '').toLowerCase();
      return !!(profile as any)?.email_verified && !!domain && email.endsWith(`@${domain}`);
    },
  },
});
