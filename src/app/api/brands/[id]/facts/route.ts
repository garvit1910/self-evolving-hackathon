import { ingestFactsService } from '@/lib/server/facts';
import { getStore } from '@/lib/store';

// The research swarm (interim or the Band agents) posts Fact[]
// here. Malformed items are dropped and counted; valid ones persist, feed the
// vector index, and bump the context version + hash when the set changes.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getStore().hasBrand(id)) {
    return Response.json({ error: `unknown brand: ${id}` }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'body must be JSON (Fact[] or {facts: Fact[]})' }, { status: 400 });
  }
  const result = await ingestFactsService(id, body);
  return Response.json(result);
}
