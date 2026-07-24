import { runInterimResearch } from '@/lib/research/interim';
import { getStore } from '@/lib/store';

// TODO(track-a): the Guild/Band swarm replaces this — it POSTs /facts and
// /events directly instead of us running the interim researcher server-side.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const brand = store.getBrand(id);
  if (!brand) return Response.json({ error: `unknown brand: ${id}` }, { status: 404 });

  const result = await runInterimResearch({
    brandId: id,
    url: brand.url,
    postEvent: (event) => {
      store.appendEvents(id, [{ ...event, ts: Date.now() }]);
    },
  });
  return Response.json(result);
}
