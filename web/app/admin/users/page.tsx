import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { query, transaction } from '@/lib/db';
import { requireFinance } from '@/lib/session';
import { scoped } from '@/lib/scope';
import { listUsers } from '@/lib/users';

export const dynamic = 'force-dynamic';
const ROLES = [['finance', 'Finance / CEO: everything, can add data and manage users'], ['senior', 'Senior team: all lines, no rate, commission or support'], ['staff', 'Staff: only their own artists, no rate, commission or support']] as const;

async function save(fd: FormData) {
  'use server';
  const me = await requireFinance();
  const email = String(fd.get('email') || '').trim().toLowerCase();
  const name = String(fd.get('name') || '').trim() || null;
  const role = String(fd.get('role'));
  const artists = fd.getAll('artists').map(String);
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || '').toLowerCase();
  const back = (m: string) => redirect(`/admin/users?msg=${encodeURIComponent(m)}`);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) back('Enter a valid email address.');
  if (domain && !email.endsWith(`@${domain}`)) back(`Email must be a @${domain} address.`);
  if (!ROLES.some(r => r[0] === role)) back('Choose a role.');
  if (role === 'staff' && !artists.length) back('Staff need at least one artist, otherwise they see nothing.');
  await transaction(async run => {
    await run(`insert into app_users(email, name, role) values ($1,$2,$3) on conflict (email) do update set name = excluded.name, role = excluded.role`, [email, name, role]);
    await run('delete from user_artists where email = $1', [email]);
    if (role === 'staff') for (const a of artists) await run('insert into user_artists(email, artist_name) values ($1,$2)', [email, a]);
    if (!(await run(`select 1 from app_users where role = 'finance' limit 1`)).rows.length) throw new Error('There must always be at least one finance user.');
  }).catch(e => back(e.message));
  revalidatePath('/admin/users');
  back(me.email === email ? 'Saved (this is your own account).' : `Saved ${email}.`);
}

async function remove(fd: FormData) {
  'use server';
  const me = await requireFinance();
  const email = String(fd.get('email'));
  if (email === me.email) redirect('/admin/users?msg=' + encodeURIComponent('You can’t remove yourself.'));
  await query('delete from app_users where email = $1', [email]);
  revalidatePath('/admin/users');
  redirect('/admin/users?msg=' + encodeURIComponent(`Removed ${email}.`));
}

async function saveManagers(fd: FormData) {
  'use server';
  await requireFinance();
  const rows: [string, string][] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith('mgr:')) continue;
    for (const n of String(v).split(/[,;\n]/).map(x => x.trim().replace(/\s+/g, ' ')).filter(Boolean)) rows.push([k.slice(4), n]);
  }
  await transaction(async run => {
    for (const a of new Set(rows.map(r => r[0]).concat([...fd.keys()].filter(k => k.startsWith('mgr:')).map(k => k.slice(4))))) await run('delete from artist_managers where artist_name = $1', [a]);
    for (const [a, n] of rows) await run('insert into artist_managers values ($1,$2) on conflict do nothing', [a, n]);
  });
  revalidatePath('/', 'layout');
  redirect('/admin/users?msg=' + encodeURIComponent('Saved artist managers.'));
}

async function setCurrent(fd: FormData) {
  'use server';
  await requireFinance();
  const name = String(fd.get('name')), current = fd.get('current') === '1';
  await query('update managers set is_current = $2 where name = $1', [name, current]);
  revalidatePath('/', 'layout');
  redirect('/admin/users?msg=' + encodeURIComponent(`${name} is now marked ${current ? 'current' : 'former'}.`));
}

export default async function Users({ searchParams }: { searchParams: Promise<{ edit?: string; msg?: string }> }) {
  const viewer = await requireFinance();
  const { edit, msg } = await searchParams;
  const [users, artists, managers] = await Promise.all([
    listUsers(), query<{ name: string }>('select name from artists order by name'),
    query<{ name: string; is_current: boolean; lines: number }>(`select m.name, m.is_current, count(l.line_id)::int lines from managers m left join revenue_lines l using (manager_id) group by 1,2 order by m.is_current desc, m.name`),
  ]);
  const cur = users.find(u => u.email === edit);
  const am = await query<{ artist: string; names: string | null }>(
    `select a.artist, (select string_agg(manager_name, ', ' order by manager_name) from artist_managers m where m.artist_name = a.artist) names
     from (select distinct artist from ${scoped(viewer)} where is_current and artist is not null) a order by 1`);

  return (
    <>
      <h1 style={{ margin: '4px 0 6px' }}>Users and access</h1>
      <p className="muted" style={{ maxWidth: 760 }}>
        People must sign in with their company Google account <i>and</i> be on this list. Changes apply on their next click; removing someone cuts access immediately.
      </p>
      {msg && <div className="notice ok">{msg}</div>}

      <form action={save} className="filters" key={cur?.email ?? 'new'}>
        <label>Email<input name="email" type="email" required defaultValue={cur?.email} readOnly={!!cur} /></label>
        <label>Name<input name="name" defaultValue={cur?.name ?? ''} /></label>
        <label>Role
          <select name="role" defaultValue={cur?.role ?? 'staff'}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label style={{ gridColumn: '1 / -1' }}>Artists they work with (staff only; hold Cmd/Ctrl to pick several)
          <select name="artists" multiple size={8} defaultValue={cur?.artists ?? []}>{artists.map(a => <option key={a.name}>{a.name}</option>)}</select>
        </label>
        <div className="actions"><button type="submit">{cur ? 'Update user' : 'Add user'}</button>{cur && <a className="btn ghost" href="/admin/users">Cancel</a>}</div>
      </form>

      <div className="tablewrap">
        <table>
          <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Artists</th><th /></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.email}>
                <td>{u.email}</td><td>{u.name}</td><td>{u.role}</td>
                <td className="memo">{u.role === 'staff' ? (u.artists.join(', ') || <span className="muted">none</span>) : <span className="muted">all</span>}</td>
                <td>
                  <a href={`/admin/users?edit=${encodeURIComponent(u.email)}`}>Edit</a>{' '}
                  <form action={remove} style={{ display: 'inline' }}><input type="hidden" name="email" value={u.email} /><button className="btn ghost" type="submit">Remove</button></form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 32 }}>Who manages each artist</h2>
      <p className="muted" style={{ maxWidth: 760 }}>
        The people (not the company) who manage each artist. Separate several names with commas. This lives in the database only, not in the Google Sheets. Active artists only for now.
      </p>
      <form action={saveManagers}>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Artist</th><th>Manager(s)</th></tr></thead>
            <tbody>
              {am.map(r => (
                <tr key={r.artist}><td>{r.artist}</td><td><input name={`mgr:${r.artist}`} defaultValue={r.names ?? ''} placeholder="e.g. Jane Smith, John Doe" style={{ width: '100%', minWidth: 320 }} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p><button type="submit">Save managers</button></p>
      </form>

      <h2 style={{ marginTop: 32 }}>Companies: current or former</h2>
      <p className="muted" style={{ maxWidth: 760 }}>
        Former managers keep all their history; they're just left out when “Current managers only” is ticked.
      </p>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Company</th><th className="num">Lines</th><th>Status</th><th /></tr></thead>
          <tbody>
            {managers.map(m => (
              <tr key={m.name}>
                <td>{m.name}</td><td className="num">{m.lines.toLocaleString()}</td><td>{m.is_current ? 'Current' : 'Former'}</td>
                <td>
                  <form action={setCurrent}>
                    <input type="hidden" name="name" value={m.name} /><input type="hidden" name="current" value={m.is_current ? '0' : '1'} />
                    <button className="btn ghost" type="submit">Mark {m.is_current ? 'former' : 'current'}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
