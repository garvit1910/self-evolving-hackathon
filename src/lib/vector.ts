import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { NotImplementedError } from './errors';
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

// TODO(track-a): Actian vector store client. The stub declares the seam only —
// endpoint shapes are NOT guessed here; implement against real Actian docs.
export class ActianVectorStore implements VectorStore {
  constructor(private readonly url = process.env.ACTIAN_URL) {}

  async upsert(_chunks: Chunk[]): Promise<void> {
    throw new NotImplementedError('TODO(track-a): ActianVectorStore.upsert (env ACTIAN_URL)');
  }

  async query(_text: string, _k: number): Promise<ScoredChunk[]> {
    throw new NotImplementedError('TODO(track-a): ActianVectorStore.query (env ACTIAN_URL)');
  }
}

// One store per namespace (we namespace by brandId), cached across HMR.
// TODO(track-a): return ActianVectorStore once implemented; until then the
// factory always falls back to the local default even when ACTIAN_URL is set.
export function getVectorStore(namespace: string): VectorStore {
  const g = globalThis as typeof globalThis & { __swarmadsVectors?: Map<string, MemoryVectorStore> };
  g.__swarmadsVectors ??= new Map();
  // key includes the data root so tests that repoint DATA_DIR get fresh stores
  const root = process.env.DATA_DIR ?? path.join(process.cwd(), '.data');
  const key = `${root}:${namespace}`;
  let store = g.__swarmadsVectors.get(key);
  if (!store) {
    store = new MemoryVectorStore(namespace);
    g.__swarmadsVectors.set(key, store);
  }
  return store;
}
