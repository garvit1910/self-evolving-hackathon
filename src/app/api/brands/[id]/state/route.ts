import { getStore } from '@/lib/store';

// Backs RemoteDataSource: one round-trip for everything the UI pages need.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  if (!store.hasBrand(id)) {
    return Response.json({ error: `unknown brand: ${id}` }, { status: 404 });
  }
  return Response.json({
    creatives: store.getCreatives(id),
    metrics: store.getMetrics(id),
    learnings: store.getLearnings(id),
    panelScores: store.getPanelScores(id),
  });
}
