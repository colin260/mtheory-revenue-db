import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { artistsFor, findUser, type AppUser } from './users';

export type Viewer = AppUser & { sees: { money: boolean }; artists: string[] | null };

// Resolves the signed-in person against the access table on every request, so changes
// (including removing someone) take effect immediately. null = not signed in or not on the list.
export async function getViewer(): Promise<Viewer | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  const u = await findUser(email);
  if (!u) return null;
  return { ...u, sees: { money: u.role === 'finance' }, artists: u.role === 'staff' ? await artistsFor(u.email) : null };
}

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect('/login');
  return v;
}

export async function requireFinance(): Promise<Viewer> {
  const v = await requireViewer();
  if (v.role !== 'finance') redirect('/');
  return v;
}
