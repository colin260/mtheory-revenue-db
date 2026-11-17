import { importLines } from '@/lib/importLines';
import { readRecXlsx } from '@/lib/importXlsx';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ ok: false, errors: ['Not signed in.'] }, { status: 401 });
  if (viewer.role !== 'finance') return Response.json({ ok: false, errors: ['Only the finance team can add data.'] }, { status: 403 });
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return Response.json({ ok: false, errors: ['Choose a CSV or Excel file.'] }, { status: 400 });
  if (file.size > 4 * 1024 * 1024) return Response.json({ ok: false, errors: ['File is over 4 MB.'] }, { status: 413 });
  const dryRun = form.get('dryRun') === '1';

  if (/\.xlsx$/i.test(file.name)) {
    const manager = String(form.get('manager') || '').trim(), year = Number(form.get('trackerYear'));
    if (!manager) return Response.json({ ok: false, errors: ['Choose which manager tab these lines belong to.'] }, { status: 400 });
    if (!/^\d{4}$/.test(String(form.get('trackerYear')))) return Response.json({ ok: false, errors: ['Enter the tracker year (for example 2026).'] }, { status: 400 });
    try {
      const x = await readRecXlsx(Buffer.from(await file.arrayBuffer()), { manager, trackerYear: year, artist: String(form.get('artist') || '').trim() || undefined });
      const meta = { source: 'excel', startRow: x.startRow, parsed: x.parsed, skipped: x.skipped, warnings: x.warnings, manager, trackerYear: year };
      if (!x.newRows) return Response.json({ ok: true, dryRun, rows: 0, inserted: 0, updated: 0, newManagers: [], errors: [], ...meta });
      return Response.json({ ...(await importLines(x.csv, dryRun)), ...meta });
    } catch (e) {
      return Response.json({ ok: false, errors: [(e as Error).message] }, { status: 400 });
    }
  }
  if (!/\.csv$/i.test(file.name)) return Response.json({ ok: false, errors: ['Use a .xlsx or .csv file.'] }, { status: 400 });
  return Response.json(await importLines(await file.text(), dryRun));
}
