/**
 * Imagesmith — turns each genome into a Gemini image, persisted via CreativeStore.
 *
 * Two properties matter here. First, BOUNDED CONCURRENCY: Gemini is the slowest
 * and most quota-limited call in the system, so requests go out 3 at a time
 * rather than all 8 at once. Second, PER-ITEM ISOLATION: one failed image must
 * not kill the other seven — a failure falls back to a placeholder and is
 * reported to the feed, so the demo degrades instead of dying.
 */

import type { Brand, Genome, Persona } from '@/lib/contracts';
import type { Feed, ImageGen } from '../adapters/interfaces';
import type { CreativeStore } from '../store/creativeStore';

const CONCURRENCY = 3;

export const PLACEHOLDER_IMAGES = [
  '/fixtures/ad-1.svg',
  '/fixtures/ad-2.svg',
  '/fixtures/ad-3.svg',
  '/fixtures/ad-4.svg',
];

export function buildImagePrompt(brand: Brand, genome: Genome, personas: Persona[]): string {
  const persona = personas.find((p) => p.name === genome.persona);
  const audience = persona ? `${persona.name} — ${persona.summary}` : genome.persona;
  return `${genome.style} advertising image for ${brand.name}. ${genome.hook}. Angle: ${genome.angle}. Audience: ${audience}.`;
}

/** Run `worker` over every index of `items`, at most `limit` in flight. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function renderImages(
  brand: Brand,
  genomes: Genome[],
  personas: Persona[],
  ids: string[],
  runId: string,
  imageGen: ImageGen,
  store: CreativeStore,
  feed: Feed,
  room: string,
): Promise<string[]> {
  let failures = 0;

  const urls = await mapWithLimit(genomes, CONCURRENCY, async (genome, i) => {
    const placeholder = PLACEHOLDER_IMAGES[i % PLACEHOLDER_IMAGES.length];
    try {
      const prompt = buildImagePrompt(brand, genome, personas);
      const { imageUrl } = await imageGen.generate(prompt, brand.productImageUrl);

      // Real Gemini returns a data URL; mocks return a path already on disk.
      const dataMatch = /^data:image\/\w+;base64,(.+)$/.exec(imageUrl);
      if (!dataMatch) return imageUrl;

      try {
        return await store.saveImage(runId, ids[i], Buffer.from(dataMatch[1], 'base64'));
      } catch {
        return imageUrl; // write failed — serve inline rather than losing the image
      }
    } catch (err) {
      failures++;
      await feed.post(room, {
        agent: 'imagesmith',
        kind: 'error',
        payload: { id: ids[i], reason: (err as Error).message, usedPlaceholder: true },
      });
      return placeholder;
    }
  });

  await feed.post(room, {
    agent: 'imagesmith',
    kind: 'tool_result',
    payload: { rendered: genomes.length - failures, failed: failures, concurrency: CONCURRENCY },
  });

  return urls;
}
