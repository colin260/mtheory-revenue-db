# Launching the Mtheory Revenue app

Stack: Supabase (Postgres) + Vercel (the Next.js app in `web/`) + Google sign-in (company Workspace only).

## 1. Database (Supabase)
1. Create a Supabase project (pick a US region; save the database password).
2. Project > Connect > copy the **Session pooler** connection string (`postgresql://postgres.<ref>:<password>@...:5432/postgres`).
3. From this folder: `DATABASE_URL='<that string>' node load.mjs` (loads the data and runs `auth.sql`; checks all 77 tabs tie).
4. In the Supabase SQL editor run `supabase_lockdown.sql` (blocks the public API from reading anything). **Do not skip this.**
5. Add the first finance user (SQL editor): `insert into app_users(email, name, role) values ('you@yourdomain.com', 'Your Name', 'finance');`
   Everyone else is added on the app's Users page.

## 2. Google sign-in
1. Google Cloud console > APIs & Services > Credentials > Create OAuth client ID (Web application).
2. Authorized redirect URI: `https://<your-app-domain>/api/auth/callback/google`.
3. Keep the consent screen **Internal** (restricts to your Workspace). Note the client ID and secret.

## 3. Hosting (Vercel)
1. Import the repo, set **Root Directory** to `web`.
2. Environment variables (see `web/.env.local.example`): `DATABASE_URL`, `AUTH_SECRET` (`openssl rand -base64 32`),
   `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAIL_DOMAIN` (e.g. `mtheoryllc.com`, no @).
   Do NOT set `BOOTSTRAP_FINANCE_EMAIL`. The developer sign-in is automatically off in production.
3. Deploy, then add your custom domain if wanted (and update the Google redirect URI to match).

## 4. Smoke test before telling staff
- Signed out: every page redirects to /login. A non-company Google account is rejected. A company account that isn't on the list sees "hasn't been given access".
- As finance: everything, plus Add data and Users. As a senior user: no rate/commission/support anywhere (table, export, charts). As staff: only their artists.
- Supabase SQL editor: the check query at the bottom of `supabase_lockdown.sql` returns no rows.

## Refreshing data
Edit the tracker sheets as usual. Until the automatic refresh job exists, finance uses **Add data** with a CSV in the template format
(previews first; existing lines update, new ones add).
