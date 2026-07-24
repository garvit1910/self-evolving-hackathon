import type { ContextSnapshot } from '@/lib/contracts';
import { getContextStore } from '@/lib/context';
import { getStore } from '@/lib/store';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  if (!store.hasBrand(id)) {
    return Response.json({ error: `unknown brand: ${id}` }, { status: 404 });
  }
  const { version, hash } = await getContextStore().getVersion(id);
  const snapshot: ContextSnapshot = { brandId: id, version, hash, facts: store.getFacts(id) };
  return Response.json(snapshot);
}
