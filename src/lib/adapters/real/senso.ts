/**
 * Senso — real context-layer adapter. REST: https://apiv2.senso.ai/api/v1
 * ingest sources → compiled KB → search + writeback. Set SENSO_API_KEY.
 *
 * Verified live against the real API (docs.senso.ai): base URL is apiv2.senso.ai,
 * NOT sdk.senso.ai (the docs.senso.ai subdomain name is misleading — that's just
 * where the docs are hosted). Ingest is POST /org/kb/raw, search is POST
 * /org/search returning { results: [{ chunk_text, title, ... }] }.
 */

import type { Fact } from '@/lib/contracts';
import type { ContextStore } from '../interfaces';

const BASE = (process.env.SENSO_BASE_URL ?? 'https://apiv2.senso.ai/api/v1').replace(/\/$/, '');

function headers() {
  const key = process.env.SENSO_API_KEY;
  if (!key) throw new Error('SENSO_API_KEY not set');
  return { 'content-type': 'application/json', 'X-API-Key': key };
}

export function createSensoContextStore(): ContextStore {
  return {
    async ingest(sources) {
      const ids: string[] = [];
      for (const s of sources) {
        const res = await fetch(`${BASE}/org/kb/raw`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ title: s.title, text: s.text }),
        });
        if (!res.ok) throw new Error(`Senso ingest ${res.status}: ${await res.text()}`);
        const j = (await res.json()) as { id: string };
        ids.push(j.id);
      }
      // contextHash derived from the set of ingested source ids (stable per compile).
      return { sourceIds: ids, contextHash: `senso_${ids.join('-').slice(0, 24)}` };
    },
    async search(query, k): Promise<Fact[]> {
      const res = await fetch(`${BASE}/org/search`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ query, max_results: k }),
      });
      if (!res.ok) throw new Error(`Senso search ${res.status}: ${await res.text()}`);
      const j = (await res.json()) as { results: { chunk_text: string; title?: string }[] };
      // TODO map Senso result → Fact.section via a lightweight classifier or heuristic.
      return j.results.slice(0, k).map((r, i) => ({
        id: `senso-f${i}`,
        brandId: 'unknown',
        section: 'positioning' as const,
        statement: r.chunk_text,
        sourceUrl: r.title,
        confidence: 0.7,
        origin: 'research' as const,
      }));
    },
    async writeback(learningMarkdown) {
      const res = await fetch(`${BASE}/org/kb/raw`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ title: 'performance-learnings', text: learningMarkdown }),
      });
      if (!res.ok) throw new Error(`Senso writeback ${res.status}: ${await res.text()}`);
      const j = (await res.json()) as { id: string };
      return { sourceId: j.id, contextHash: `senso_wb_${j.id.slice(0, 20)}` };
    },
  };
}
