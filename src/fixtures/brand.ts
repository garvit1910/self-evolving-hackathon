import type { Brand } from '@/lib/contracts';

export const magicSpoonBrand: Brand = {
  id: 'brand-magic-spoon',
  url: 'https://magicspoon.com',
  name: 'Magic Spoon',
  productImageUrl: '/creatives/product-magic-spoon.svg',
  contextVersion: 1,
  contextHash: 'a3f91c7e2b445d10',
  sensoSourceIds: ['senso-src-web-01', 'senso-src-catalog-02'],
};

// Hash the context flips to once performance_loop facts are written back (v2).
export const contextHashV2 = 'b7c42d918e6f3a05';
