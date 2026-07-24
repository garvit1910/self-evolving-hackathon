import { cookies } from 'next/headers';
import { BRAND_COOKIE } from '@/lib/server/brands';

// Switches the app-level brand: a created brandId, or null to return to the
// offline fixture demo.
export async function POST(request: Request) {
  let brandId: string | null = null;
  try {
    brandId = ((await request.json()) as { brandId?: string | null }).brandId ?? null;
  } catch {
    // treat an empty body as "clear"
  }
  const jar = await cookies();
  if (brandId) {
    jar.set(BRAND_COOKIE, brandId, { httpOnly: true, path: '/' });
  } else {
    jar.delete(BRAND_COOKIE);
  }
  return Response.json({ ok: true, brandId });
}
