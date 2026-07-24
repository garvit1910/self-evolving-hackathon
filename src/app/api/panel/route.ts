import { scorePanel } from '@/lib/panel';
import { getStore } from '@/lib/store';

// Re-scores a brand's creatives with the persona panel. mode reports whether
// the real LLM ('live') or the deterministic mock ('mock') produced the scores.
export async function POST(request: Request) {
  let body: { brandId?: string; creativeIds?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    // validated below
  }
  if (!body.brandId) return Response.json({ error: 'brandId is required' }, { status: 400 });
  const store = getStore();
  const brand = store.getBrand(body.brandId);
  if (!brand) return Response.json({ error: `unknown brand: ${body.brandId}` }, { status: 404 });

  let creatives = store.getCreatives(body.brandId);
  if (Array.isArray(body.creativeIds)) {
    const wanted = new Set(body.creativeIds);
    creatives = creatives.filter((c) => wanted.has(c.id));
  }
  if (creatives.length === 0) {
    return Response.json({ error: 'no creatives to score' }, { status: 400 });
  }
  const facts = store.getFacts(body.brandId);
  const { scores, mode } = await scorePanel({
    creatives,
    personaFacts: facts.filter((f) => f.section === 'persona'),
    brandName: brand.name,
  });
  store.appendPanelScores(body.brandId, scores);
  return Response.json({ scores, mode });
}
