import { getStore } from '@/lib/store';

// Track A calls this after the real Senso write succeeds; the local writeback
// path leaves sensoIngested=false ("pending write-back" badge) until then.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let brandId: string | undefined;
  try {
    brandId = ((await request.json()) as { brandId?: string })?.brandId;
  } catch {
    // brandId optional — falls back to scanning all brands
  }
  const found = getStore().setLearningIngested(id, brandId);
  if (!found) return Response.json({ error: `unknown learning: ${id}` }, { status: 404 });
  return Response.json({ ok: true });
}
