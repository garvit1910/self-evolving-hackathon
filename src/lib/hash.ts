import type { Fact } from './contracts';

// Deterministic, dependency-free hashing for the offline fallbacks (mock LLM,
// pseudo-embeddings, per-brand winner planting). Not cryptographic — sha256 for
// context hashes lives in server/hash.server.ts to keep node:crypto out of
// client bundles.
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Canonical serialization: facts sorted by id, keys in fixed order, so the same
// fact set hashes identically regardless of insertion order.
export function canonicalFactsJson(facts: Fact[]): string {
  const ordered = [...facts]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((f) => ({
      id: f.id,
      brandId: f.brandId,
      section: f.section,
      statement: f.statement,
      sourceUrl: f.sourceUrl ?? null,
      sourceQuote: f.sourceQuote ?? null,
      confidence: f.confidence,
      origin: f.origin,
    }));
  return JSON.stringify(ordered);
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
