import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { fnv1a } from './hash';

// Actian seam. MemoryVectorStore is the working local default: OpenAI
// text-embedding-3-small when a key is present, deterministic hash-based
// pseudo-vectors otherwise, so offline retrieval still ranks stably. Vectors
// persist under .data/vectors/<namespace>.json (survives dev restarts, avoids
// re-billing embeddings). Server-only (node:fs).

export type Chunk = { id: string; text: string; meta?: Record<string, unknown> };
export type ScoredChunk = { id: string; text: string; score: number };

export interface VectorStore {
  upsert(chunks: Chunk[]): Promise<void>;
  query(text: string, k: number): Promise<ScoredChunk[]>;
}

type StoredChunk = {
  id: string;
  text: string;
  meta?: Record<string, unknown>;
  vec: number[];
  // Mixed spaces can coexist after a per-item embedding failure; scoring
  // recomputes a pseudo query vector for pseudo-space chunks.
  space: 'openai' | 'pseudo';
};

const DIM = 64;

function pseudoEmbed(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    vec[fnv1a(token) % DIM] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

async function openaiEmbed(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
  const data = (await res.json()) as { data: { index: number; embedding: number[] }[] };
  const out: number[][] = new Array(texts.length);
  for (const row of data.data) out[row.index] = row.embedding;
  return out;
}

export class MemoryVectorStore implements VectorStore {
  private chunks: Map<string, StoredChunk>;

  constructor(private readonly namespace: string) {
    this.chunks = new Map(
      this.readPersisted().map((c) => [c.id, c]),
    );
  }

  private persistFile(): string {
    const root = process.env.DATA_DIR ?? path.join(process.cwd(), '.data');
    return path.join(root, 'vectors', `${this.namespace}.json`);
  }

  private readPersisted(): StoredChunk[] {
    const file = this.persistFile();
    if (!existsSync(file)) return [];
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as StoredChunk[];
    } catch {
      return [];
    }
  }

  private persist(): void {
    const file = this.persistFile();
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.chunks.values()]));
    renameSync(tmp, file);
  }

  async upsert(chunks: Chunk[]): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    const fresh = chunks.filter((c) => this.chunks.get(c.id)?.text !== c.text);
    if (fresh.length === 0) return;
    let vecs: number[][] | null = null;
    let space: StoredChunk['space'] = 'pseudo';
    if (apiKey) {
      try {
        vecs = await openaiEmbed(fresh.map((c) => c.text), apiKey);
        space = 'openai';
      } catch {
        vecs = null; // degrade the whole batch to pseudo-vectors
      }
    }
    fresh.forEach((c, i) => {
      this.chunks.set(c.id, {
        ...c,
        vec: vecs ? vecs[i] : pseudoEmbed(c.text),
        space: vecs ? space : 'pseudo',
      });
    });
    this.persist();
  }

  async query(text: string, k: number): Promise<ScoredChunk[]> {
    const all = [...this.chunks.values()];
    if (all.length === 0) return [];
    const apiKey = process.env.OPENAI_API_KEY;
    let openaiQueryVec: number[] | null = null;
    if (apiKey && all.some((c) => c.space === 'openai')) {
      try {
        [openaiQueryVec] = await openaiEmbed([text], apiKey);
      } catch {
        openaiQueryVec = null;
      }
    }
    const pseudoQueryVec = pseudoEmbed(text);
    const scored = all.map((c) => ({
      id: c.id,
      text: c.text,
      score:
        c.space === 'openai' && openaiQueryVec
          ? cosine(openaiQueryVec, c.vec)
          : cosine(pseudoQueryVec, c.space === 'pseudo' ? c.vec : pseudoEmbed(c.text)),
    }));
    // stable order: score desc, id asc — deterministic offline ranking
    return scored
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, k);
  }
}

// Actian VectorAI DB client — wire shapes per the merged Track A adapter
// (src/lib/adapters/real/actian.ts): POST {ACTIAN_URL}/vectors/upsert
// {items:[{id,text}]} (text-in, Actian embeds) and POST /vectors/search
// {query,k} → {matches:[{id,text,score}]}. The adapter marks these routes as
// unverified against a live CE instance — no local VectorAI DB was reachable
// this session (smoke-actian.ts records the probe), so every failure falls
// back to the MemoryVectorStore mirror and the demo never blocks on Docker.
export class ActianVectorStore implements VectorStore {
  private readonly base: string;

  constructor(
    private readonly mirror: MemoryVectorStore,
    url = process.env.ACTIAN_URL,
  ) {
    if (!url) throw new Error('ACTIAN_URL not set');
    this.base = url.replace(/\/$/, '');
  }

  async upsert(chunks: Chunk[]): Promise<void> {
    await this.mirror.upsert(chunks); // mirror first — fallback stays complete
    try {
      const res = await fetch(`${this.base}/vectors/upsert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: chunks.map((c) => ({ id: c.id, text: c.text })) }),
      });
      if (!res.ok) throw new Error(`Actian upsert ${res.status}`);
    } catch (err) {
      console.warn(`[actian] upsert fell back to memory store: ${(err as Error).message}`);
    }
  }

  async query(text: string, k: number): Promise<ScoredChunk[]> {
    try {
      const res = await fetch(`${this.base}/vectors/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: text, k }),
      });
      if (!res.ok) throw new Error(`Actian search ${res.status}`);
      const j = (await res.json()) as { matches?: { id: string; text: string; score: number }[] };
      if (Array.isArray(j.matches)) return j.matches.slice(0, k);
      throw new Error('Actian search returned no matches array');
    } catch (err) {
      console.warn(`[actian] query fell back to memory store: ${(err as Error).message}`);
      return this.mirror.query(text, k);
    }
  }
}

// One store per namespace (we namespace by brandId), cached across HMR.
// USE_REAL_ACTIAN=1 + ACTIAN_URL routes retrieval through Actian (memory store
// stays the mirror + fallback); kill switch unset/0 → MemoryVectorStore only.
export function getVectorStore(namespace: string): VectorStore {
  const g = globalThis as typeof globalThis & { __swarmadsVectors?: Map<string, VectorStore> };
  g.__swarmadsVectors ??= new Map();
  // key includes the data root so tests that repoint DATA_DIR get fresh stores
  const root = process.env.DATA_DIR ?? path.join(process.cwd(), '.data');
  const actianOn =
    (process.env.USE_REAL_ACTIAN === '1' || process.env.USE_REAL_ACTIAN === 'true') &&
    Boolean(process.env.ACTIAN_URL);
  const key = `${root}:${namespace}:${actianOn ? 'actian' : 'memory'}`;
  let store = g.__swarmadsVectors.get(key);
  if (!store) {
    const memory = new MemoryVectorStore(namespace);
    store = actianOn ? new ActianVectorStore(memory) : memory;
    g.__swarmadsVectors.set(key, store);
  }
  return store;
}
