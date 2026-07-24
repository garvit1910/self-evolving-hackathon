/**
 * Actian VectorAI DB — real vector store (Community Edition, local via Docker).
 * Hot retrieval path. Set ACTIAN_URL (e.g. http://localhost:8080).
 *
 * SKELETON: Actian CE exposes a local endpoint; confirm the exact upsert/search
 * routes from the CE docs. Embeddings: either send text and let Actian embed, or
 * embed via Pioneer first. This uses the "send text, Actian embeds" path.
 *
 * DEPLOY NOTE: Actian runs on the demo laptop — a Vercel copy CANNOT reach it.
 * The deployed build uses the in-memory mock; the record/replay tape covers demos.
 */

import type { VectorStore } from '../interfaces';

const BASE = (process.env.ACTIAN_URL ?? 'http://localhost:8080').replace(/\/$/, '');

export function createActianVectorStore(): VectorStore {
  return {
    async upsert(items) {
      const res = await fetch(`${BASE}/vectors/upsert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error(`Actian upsert ${res.status}: ${await res.text()}`);
    },
    async topK(query, k) {
      const res = await fetch(`${BASE}/vectors/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, k }),
      });
      if (!res.ok) throw new Error(`Actian search ${res.status}: ${await res.text()}`);
      const j = (await res.json()) as { matches: { id: string; text: string; score: number }[] };
      return j.matches.slice(0, k);
    },
  };
}
