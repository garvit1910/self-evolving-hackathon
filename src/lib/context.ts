import type { Fact, Learning } from './contracts';
import { canonicalFactsJson, slugify } from './hash';
import { sha256Hex16 } from './server/hash.server';
import { getStore } from './store';
import { getVectorStore } from './vector';

// Senso seam. LocalContextStore is the working default: facts live in
// LocalStore, retrieval goes through the VectorStore, hash = sha256 of the
// canonically-sorted facts JSON, version bumps whenever the facts change.
// The fixture demo brand NEVER routes through here — its version/hash are
// hand-written fixture constants.

export interface ContextStore {
  ingestFacts(brandId: string, facts: Fact[]): Promise<{ version: number; hash: string }>;
  search(brandId: string, query: string, k: number): Promise<Fact[]>;
  writeBackLearnings(
    brandId: string,
    learnings: Learning[],
  ): Promise<{ version: number; hash: string; factIds: string[] }>;
  getVersion(brandId: string): Promise<{ version: number; hash: string }>;
}

export class LocalContextStore implements ContextStore {
  async ingestFacts(brandId: string, facts: Fact[]): Promise<{ version: number; hash: string }> {
    const store = getStore();
    const all = store.appendFacts(brandId, facts);
    const hash = sha256Hex16(canonicalFactsJson(all));
    const brand = store.getBrand(brandId);
    let version = brand?.contextVersion ?? 0;
    if (brand && brand.contextHash !== hash) {
      version = brand.contextVersion + 1;
      store.putBrand({ ...brand, contextVersion: version, contextHash: hash });
    }
    await getVectorStore(brandId).upsert(
      all.map((f) => ({ id: f.id, text: f.statement, meta: { section: f.section } })),
    );
    return { version, hash };
  }

  async search(brandId: string, query: string, k: number): Promise<Fact[]> {
    const hits = await getVectorStore(brandId).query(query, k);
    const byId = new Map(getStore().getFacts(brandId).map((f) => [f.id, f]));
    return hits.map((h) => byId.get(h.id)).filter((f): f is Fact => f !== undefined);
  }

  async writeBackLearnings(
    brandId: string,
    learnings: Learning[],
  ): Promise<{ version: number; hash: string; factIds: string[] }> {
    const facts: Fact[] = learnings.map((l) => ({
      id: `fact-pl-${slugify(`${l.stats.dimension}-${l.stats.value}`)}`,
      brandId,
      section: 'market_prior',
      statement: l.statement,
      confidence: l.stats.ciLow > 0 ? 0.9 : 0.7,
      origin: 'performance_loop',
    }));
    const { version, hash } = await this.ingestFacts(brandId, facts);
    return { version, hash, factIds: facts.map((f) => f.id) };
  }

  async getVersion(brandId: string): Promise<{ version: number; hash: string }> {
    const brand = getStore().getBrand(brandId);
    return { version: brand?.contextVersion ?? 0, hash: brand?.contextHash ?? '' };
  }
}

// Senso context store — REST shapes verified live by the merged adapter
// (src/lib/adapters/real/senso.ts, commit 0b59813): base apiv2.senso.ai/api/v1,
// auth X-API-Key, ingest POST /org/kb/raw {title,text} → {id}, search POST
// /org/search {query,max_results} → {results:[{chunk_text,title}]}.
//
// Design: Senso holds the brand's compiled knowledge (sources); LocalStore
// remains the bookkeeping mirror (facts, contextVersion, 16-hex contextHash)
// that the UI/routes read. Every op completes locally EVEN IF the Senso call
// fails (stage insurance — the failure is logged, never fatal); source ids
// returned by Senso land on brand.sensoSourceIds as the write evidence.
export class SensoContextStore implements ContextStore {
  private readonly local = new LocalContextStore();
  private readonly base = (process.env.SENSO_BASE_URL ?? 'https://apiv2.senso.ai/api/v1').replace(/\/$/, '');

  constructor(private readonly apiKey = process.env.SENSO_API_KEY) {}

  private headers() {
    if (!this.apiKey) throw new Error('SENSO_API_KEY not set');
    return { 'content-type': 'application/json', 'X-API-Key': this.apiKey };
  }

  private async pushSource(title: string, text: string): Promise<string> {
    const res = await fetch(`${this.base}/org/kb/raw`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ title, text }),
    });
    if (!res.ok) throw new Error(`Senso ingest ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { id: string };
    return j.id;
  }

  private recordSourceId(brandId: string, sourceId: string): void {
    const store = getStore();
    const brand = store.getBrand(brandId);
    if (brand && !brand.sensoSourceIds.includes(sourceId)) {
      store.putBrand({ ...brand, sensoSourceIds: [...brand.sensoSourceIds, sourceId] });
    }
  }

  private compileFacts(brandId: string, facts: Fact[]): string {
    const lines = [`# ${brandId} — research facts`];
    for (const f of facts) {
      lines.push(
        `- [${f.section}] ${f.statement}${f.sourceQuote ? ` (source: "${f.sourceQuote}" — ${f.sourceUrl ?? ''})` : ''}`,
      );
    }
    return lines.join('\n');
  }

  async ingestFacts(brandId: string, facts: Fact[]): Promise<{ version: number; hash: string }> {
    const result = await this.local.ingestFacts(brandId, facts);
    try {
      const sourceId = await this.pushSource(
        `${brandId}-facts-v${result.version}`,
        this.compileFacts(brandId, facts),
      );
      this.recordSourceId(brandId, sourceId);
    } catch (err) {
      console.warn(`[senso] ingest fell back to local only: ${(err as Error).message}`);
    }
    return this.local.getVersion(brandId);
  }

  /** Senso /org/search ranks the compiled KB; hits are mapped back onto the
   *  brand's local Fact objects (normalized substring match) so downstream
   *  consumers keep real Fact shapes. Unmatched → local vector ranking. */
  async search(brandId: string, query: string, k: number): Promise<Fact[]> {
    try {
      const res = await fetch(`${this.base}/org/search`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ query, max_results: k }),
      });
      if (!res.ok) throw new Error(`Senso search ${res.status}: ${await res.text()}`);
      const j = (await res.json()) as { results?: { chunk_text?: string }[] };
      const chunks = (j.results ?? []).map((r) => (r.chunk_text ?? '').toLowerCase());
      const facts = getStore().getFacts(brandId);
      const ranked = facts.filter((f) =>
        chunks.some((c) => c.includes(f.statement.toLowerCase().slice(0, 80))),
      );
      if (ranked.length > 0) {
        const rest = await this.local.search(brandId, query, k);
        const seen = new Set(ranked.map((f) => f.id));
        return [...ranked, ...rest.filter((f) => !seen.has(f.id))].slice(0, k);
      }
    } catch (err) {
      console.warn(`[senso] search fell back to local: ${(err as Error).message}`);
    }
    return this.local.search(brandId, query, k);
  }

  async writeBackLearnings(
    brandId: string,
    learnings: Learning[],
  ): Promise<{ version: number; hash: string; factIds: string[] }> {
    const result = await this.local.writeBackLearnings(brandId, learnings);
    try {
      const md = [
        `# ${brandId} — performance learnings`,
        ...learnings.map(
          (l) =>
            `- ${l.statement} (dimension ${l.stats.dimension}="${l.stats.value}", lift ${l.stats.lift}, n=${l.stats.n}, CI [${l.stats.ciLow}, ${l.stats.ciHigh}])`,
        ),
      ].join('\n');
      const sourceId = await this.pushSource(`${brandId}-learnings-v${result.version}`, md);
      this.recordSourceId(brandId, sourceId);
    } catch (err) {
      console.warn(`[senso] writeback fell back to local only: ${(err as Error).message}`);
    }
    const { version, hash } = await this.local.getVersion(brandId);
    return { version, hash, factIds: result.factIds };
  }

  async getVersion(brandId: string): Promise<{ version: number; hash: string }> {
    return this.local.getVersion(brandId);
  }
}

// USE_REAL_SENSO=1 (+ SENSO_API_KEY) routes context through Senso; the kill
// switch (unset/0) is the LocalContextStore — same interface, zero code change.
export function getContextStore(): ContextStore {
  const on = process.env.USE_REAL_SENSO === '1' || process.env.USE_REAL_SENSO === 'true';
  if (on && process.env.SENSO_API_KEY) return new SensoContextStore();
  return new LocalContextStore();
}
