import { extractStatement } from '@/lib/pdfRec/extract';
import { runChecks } from '@/lib/pdfRec/checks';
import { getViewer } from '@/lib/session';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const MAX = 4 * 1024 * 1024; // Vercel's request body limit is 4.5 MB

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  if (v.role !== 'finance') return Response.json({ ok: false, error: 'Only the finance team can add data.' }, { status: 403 });
  const file = (await req.formData()).get('file');
  if (!(file instanceof File) || !file.size) return Response.json({ ok: false, error: 'Choose a PDF file.' }, { status: 400 });
  if (file.size > MAX) return Response.json({ ok: false, error: 'That PDF is over 4 MB. Split it into smaller files and upload them one at a time.' }, { status: 413 });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString() !== '%PDF-') return Response.json({ ok: false, error: 'That file isn\'t a PDF.' }, { status: 400 });
  try {
    const x = await extractStatement(bytes, new URL(req.url).searchParams.get('demo'));
    const { checks, totals } = runChecks(x.statement);
    return Response.json({ ok: true, ...x, checks, totals, filename: file.name });
  } catch (e) {
    const msg = e instanceof Anthropic.AuthenticationError ? 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.'
      : e instanceof Anthropic.RateLimitError ? 'Anthropic is rate limiting requests. Wait a minute and try again.'
      : e instanceof Anthropic.APIError ? `The reading service returned an error (${e.status}).`
      : (e as Error).message;
    return Response.json({ ok: false, error: msg }, { status: 502 });
  }
}
