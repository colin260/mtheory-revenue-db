import { query } from './db';

export type Role = 'finance' | 'senior' | 'staff';
export type AppUser = { email: string; name: string | null; role: Role };

let ensured: Promise<void> | undefined;
// Local embedded database: create the access tables on first use. On Supabase/Postgres run auth.sql once
// (node load.mjs does it too).
async function ensure() {
  if (process.env.DATABASE_URL) return;
  ensured ??= (async () => {
    const fs = await import('node:fs'), path = await import('node:path');
    for (const stmt of fs.readFileSync(path.resolve(process.cwd(), '../auth.sql'), 'utf8').split(/;\s*\n/).map(s => s.trim()).filter(Boolean))
      await query(stmt);
    // First run only: seed one finance user so someone can sign in and add the rest.
    const boot = (process.env.BOOTSTRAP_FINANCE_EMAIL || '').trim().toLowerCase();
    if (boot && !(await query('select 1 from app_users limit 1')).length)
      await query(`insert into app_users(email, name, role) values ($1, 'Finance (bootstrap)', 'finance')`, [boot]);
  })();
  return ensured;
}

export async function findUser(email: string): Promise<AppUser | null> {
  await ensure();
  const e = email.trim().toLowerCase();
  if (!e) return null;
  return (await query<AppUser>('select email, name, role from app_users where email = $1', [e]))[0] ?? null;
}

export async function artistsFor(email: string): Promise<string[]> {
  return (await query<{ artist_name: string }>('select artist_name from user_artists where email = $1 order by 1', [email])).map(r => r.artist_name);
}

export async function listUsers() {
  await ensure();
  return query<AppUser & { artists: string[] }>(
    `select u.email, u.name, u.role, coalesce(array_agg(a.artist_name order by a.artist_name) filter (where a.artist_name is not null), '{}') artists
     from app_users u left join user_artists a using (email) group by u.email, u.name, u.role order by u.role, u.email`);
}
