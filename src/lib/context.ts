import type { Fact, Learning } from './contracts';
import { NotImplementedError } from './errors';
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

// TODO(track-a): Senso context store client. The stub declares the seam only —
// endpoint shapes are NOT guessed here; implement against real Senso docs.
export class SensoContextStore implements ContextStore {
  constructor(private readonly apiKey = process.env.SENSO_API_KEY) {}

  async ingestFacts(): Promise<{ version: number; hash: string }> {
    throw new NotImplementedError('TODO(track-a): SensoContextStore.ingestFacts (env SENSO_API_KEY)');
  }

  async search(): Promise<Fact[]> {
    throw new NotImplementedError('TODO(track-a): SensoContextStore.search (env SENSO_API_KEY)');
  }

  async writeBackLearnings(): Promise<{ version: number; hash: string; factIds: string[] }> {
    throw new NotImplementedError(
      'TODO(track-a): SensoContextStore.writeBackLearnings (env SENSO_API_KEY)',
    );
  }

  async getVersion(): Promise<{ version: number; hash: string }> {
    throw new NotImplementedError('TODO(track-a): SensoContextStore.getVersion (env SENSO_API_KEY)');
  }
}

// TODO(track-a): return SensoContextStore once implemented; until then the
// factory always falls back to the local default even when SENSO_API_KEY is set.
export function getContextStore(): ContextStore {
  return new LocalContextStore();
}
