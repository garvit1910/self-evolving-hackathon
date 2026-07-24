import type { Priors } from '@/lib/creative/compose';
import { generateCreatives } from '@/lib/server/generate';
import { getStore } from '@/lib/store';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getStore().hasBrand(id)) {
    return Response.json({ error: `unknown brand: ${id}` }, { status: 404 });
  }
  let body: {
    generation?: number;
    priors?: Priors;
    count?: number;
    runId?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    // defaults below
  }
  const generation = body.generation === 2 ? 2 : 1;
  const result = await generateCreatives({
    brandId: id,
    generation,
    priors: body.priors,
    count: body.count,
    runId: body.runId,
  });
  return Response.json(result);
}
