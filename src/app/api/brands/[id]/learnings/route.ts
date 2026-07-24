import type { Learning } from '@/lib/contracts';
import { getStore } from '@/lib/store';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'body must be JSON (Learning[])' }, { status: 400 });
  }
  if (!Array.isArray(body)) {
    return Response.json({ error: 'expected Learning[]' }, { status: 400 });
  }
  const learnings = body.filter(
    (l): l is Learning =>
      typeof (l as Learning)?.id === 'string' && typeof (l as Learning)?.statement === 'string',
  );
  getStore().upsertLearnings(
    id,
    learnings.map((l) => ({ ...l, brandId: id })),
  );
  return Response.json({ ok: true, count: learnings.length });
}
