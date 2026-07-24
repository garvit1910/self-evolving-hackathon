import { cookies } from 'next/headers';
import { BRAND_COOKIE, createBrand } from '@/lib/server/brands';

export async function POST(request: Request) {
  const form = await request.formData();
  const url = form.get('url');
  if (typeof url !== 'string' || url.trim() === '') {
    return Response.json({ error: 'url is required' }, { status: 400 });
  }
  const name = form.get('name');
  const image = form.get('productImage');
  let imageFilename: string | undefined;
  let imageBytes: Buffer | undefined;
  if (image instanceof File && image.size > 0) {
    imageFilename = image.name || 'product.png';
    imageBytes = Buffer.from(await image.arrayBuffer());
  }
  const brand = createBrand({
    url: url.trim(),
    name: typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined,
    imageFilename,
    imageBytes,
  });
  (await cookies()).set(BRAND_COOKIE, brand.id, { httpOnly: true, path: '/' });
  return Response.json({ brandId: brand.id, brand }, { status: 201 });
}
