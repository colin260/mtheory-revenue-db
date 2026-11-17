import { getViewer } from '@/lib/session';
import { typeahead } from '@/lib/suggest';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const v = await getViewer();
  if (!v) return Response.json({ names: [] }, { status: 401 });
  return Response.json({ names: await typeahead(v, new URL(req.url).searchParams.get('q') || '') });
}
