import { importProjections } from '@/lib/importProjections';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const viewer = await getViewer();
  const fail = (msg: string, status: number) => Response.json({ ok: false, errors: [msg] }, { status });
  if (!viewer) return fail('Not signed in.', 401);
  if (viewer.role !== 'finance') return fail('Only the finance team can add data.', 403);
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return fail('Choose an Excel or CSV file.', 400);
  if (file.size > 4 * 1024 * 1024) return fail('File is over 4 MB.', 413);
  if (!/\.(xlsx|csv)$/i.test(file.name)) return fail('Use a .xlsx or .csv file (in Gigwell, export the shows to Excel or CSV).', 400);
  try {
    return Response.json(await importProjections(file.name, Buffer.from(await file.arrayBuffer()), {
      artist: String(form.get('artist') || '').trim() || undefined, replace: form.get('replace') === '1', dryRun: form.get('dryRun') === '1' }));
  } catch (e) {
    return fail(`Couldn't read the file: ${(e as Error).message}`, 400);
  }
}
