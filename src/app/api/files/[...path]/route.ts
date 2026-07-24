import { getStore } from '@/lib/store';

// Serves uploaded product photos and generated creative images from .data/.
// The store guards against path traversal and only exposes uploads/ + creatives/.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const file = getStore().readServedFile(segments.join('/'));
  if (!file) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: { 'content-type': file.contentType, 'cache-control': 'no-store' },
  });
}
