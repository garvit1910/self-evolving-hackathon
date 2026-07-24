import type { Brand } from '../contracts';
import { slugify } from '../hash';
import { getStore } from '../store';

export const BRAND_COOKIE = 'adcero_brand';
export const FIXTURE_BRAND_ID = 'brand-magic-spoon';

export function brandIdForUrl(url: string): string {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = url;
  }
  return `brand-${slugify(hostname.replace(/^www\./, ''))}`;
}

function defaultBrandName(url: string): string {
  try {
    const label = new URL(url).hostname.replace(/^www\./, '').split('.')[0];
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return url;
  }
}

/** Idempotent per URL: re-creating an existing brand keeps its facts + context. */
export function createBrand(opts: {
  url: string;
  name?: string;
  imageFilename?: string;
  imageBytes?: Buffer;
}): Brand {
  const store = getStore();
  const id = brandIdForUrl(opts.url);
  const existing = store.getBrand(id);
  let productImageUrl = existing?.productImageUrl ?? '';
  if (opts.imageFilename && opts.imageBytes) {
    productImageUrl = store.saveUpload(id, opts.imageFilename, opts.imageBytes);
  }
  const brand: Brand = {
    id,
    url: opts.url,
    name: opts.name || existing?.name || defaultBrandName(opts.url),
    productImageUrl,
    contextVersion: existing?.contextVersion ?? 0,
    contextHash: existing?.contextHash ?? '',
    sensoSourceIds: existing?.sensoSourceIds ?? [],
  };
  store.putBrand(brand);
  return brand;
}
