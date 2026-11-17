import { query } from '@/lib/db';
import { filtersFrom, orderBy, where } from '@/lib/filters';
import { exportCols, scoped } from '@/lib/scope';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';
const cell = (v: unknown) => {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response('Not signed in', { status: 401 });
  const cols = exportCols(viewer);
  const f = filtersFrom(Object.fromEntries(new URL(req.url).searchParams));
  const w = where(f);
  const rows = await query(`select ${cols.join(',')} from ${scoped(viewer)} ${w.sql} order by ${orderBy(new URL(req.url).searchParams.get('sort') ?? '', viewer.sees.money)}`, w.params);
  const label: Record<string, string> = { manager: 'company', mgr_names: 'manager' };   // 'manager' = the management company (tab); mgr_names = the people
  const body = [cols.map(c => label[c] ?? c).join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="mtheory-revenue.csv"' } });
}
