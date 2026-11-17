import { query } from '@/lib/db';

// Called once a day by Vercel Cron (vercel.json) so the Supabase free plan
// doesn't pause the database for inactivity. Returns no data.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await query('select 1');
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
