import { getContextStore } from '@/lib/context';
import { getStore } from '@/lib/store';

// Feeds learnings back into the brand context as origin:'performance_loop'
// facts — the v1 → v2 hash flip the /context diff view lights up on.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let learningIds: string[] | undefined;
  try {
    const body = (await request.json()) as { learningIds?: string[] };
    learningIds = Array.isArray(body?.learningIds) ? body.learningIds : undefined;
  } catch {
    // empty body → write back everything
  }
  const all = getStore().getLearnings(id);
  const selected = learningIds ? all.filter((l) => learningIds.includes(l.id)) : all;
  if (selected.length === 0) {
    return Response.json({ error: 'no learnings to write back' }, { status: 400 });
  }
  const result = await getContextStore().writeBackLearnings(id, selected);
  return Response.json(result);
}
