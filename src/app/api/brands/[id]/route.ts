import { getStore } from '@/lib/store';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = getStore().getBrand(id);
  if (!brand) return Response.json({ error: `unknown brand: ${id}` }, { status: 404 });
  return Response.json({ brand });
}
