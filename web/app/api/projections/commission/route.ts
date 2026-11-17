import { query } from '@/lib/db';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Finance-only: set (or clear, with null) the projected commission for one show.
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  if (v.role !== 'finance') return Response.json({ ok: false, error: 'Only the finance team can change commissions.' }, { status: 403 });
  const b = await req.json().catch(() => null) as { artist?: string; showDate?: string; venue?: string; commission?: number | null } | null;
  if (!b?.artist || !b.venue || !/^\d{4}-\d{2}-\d{2}$/.test(b.showDate ?? '')) return Response.json({ ok: false, error: 'Missing show.' }, { status: 400 });
  const c = b.commission;
  if (c != null && (typeof c !== 'number' || !Number.isFinite(c))) return Response.json({ ok: false, error: 'Numbers only.' }, { status: 400 });
  const rows = await query('update projected_shows set commission_override = $4 where artist = $1 and show_date = $2 and venue = $3 returning 1', [b.artist, b.showDate, b.venue, c ?? null]);
  if (!rows.length) return Response.json({ ok: false, error: 'Show not found (it may have been replaced by an upload). Reload the page.' }, { status: 404 });
  return Response.json({ ok: true });
}
