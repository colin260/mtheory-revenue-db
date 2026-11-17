import { Statement } from '@/lib/pdfRec/schema';
import { buildRec } from '@/lib/pdfRec/xlsx';
import { getViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v || v.role !== 'finance') return new Response('Not allowed', { status: v ? 403 : 401 });
  const parsed = Statement.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response('Invalid statement data', { status: 400 });
  const { buffer, filename } = await buildRec(parsed.data);
  return new Response(new Uint8Array(buffer), { headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="${filename.replace(/"/g, '')}"` } });
}
