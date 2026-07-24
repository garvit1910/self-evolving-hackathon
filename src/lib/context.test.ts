import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fact, Learning } from './contracts';
import { LocalContextStore } from './context';
import { getStore } from './store';
import { MemoryVectorStore } from './vector';

const fact = (id: string, statement: string, origin: Fact['origin'] = 'research'): Fact => ({
  id,
  brandId: 'brand-x',
  section: 'positioning',
  statement,
  confidence: 0.9,
  origin,
});

beforeEach(() => {
  vi.stubEnv('DATA_DIR', mkdtempSync(path.join(tmpdir(), 'adcero-')));
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('LLM_API_KEY', '');
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in tests'))));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('MemoryVectorStore (offline pseudo-vectors)', () => {
  it('ranks deterministically and by token overlap', async () => {
    const store = new MemoryVectorStore('test-ns');
    await store.upsert([
      { id: 'a', text: 'protein cereal with zero sugar' },
      { id: 'b', text: 'shipping and returns policy details' },
      { id: 'c', text: 'nostalgic saturday morning cereal flavors' },
    ]);
    const r1 = await store.query('cereal sugar protein', 2);
    const r2 = await store.query('cereal sugar protein', 2);
    expect(r1).toEqual(r2);
    expect(r1).toHaveLength(2);
    expect(r1[0].id).toBe('a');
  });
});

describe('LocalContextStore', () => {
  const brand = () => ({
    id: 'brand-x',
    url: 'https://x.test',
    name: 'X',
    productImageUrl: '',
    contextVersion: 0,
    contextHash: '',
    sensoSourceIds: [],
  });

  it('ingestFacts bumps version only when the fact set changes', async () => {
    getStore().putBrand(brand());
    const ctx = new LocalContextStore();

    const v1 = await ctx.ingestFacts('brand-x', [fact('f1', 'one')]);
    expect(v1.version).toBe(1);
    expect(v1.hash).toMatch(/^[0-9a-f]{16}$/);

    const same = await ctx.ingestFacts('brand-x', [fact('f1', 'one')]);
    expect(same).toEqual(v1);

    const v2 = await ctx.ingestFacts('brand-x', [fact('f2', 'two')]);
    expect(v2.version).toBe(2);
    expect(v2.hash).not.toBe(v1.hash);
  });

  it('writeBackLearnings adds performance_loop facts and flips the hash again', async () => {
    getStore().putBrand(brand());
    const ctx = new LocalContextStore();
    const before = await ctx.ingestFacts('brand-x', [fact('f1', 'one')]);

    const learning: Learning = {
      id: 'learn-x',
      brandId: 'brand-x',
      statement: "angle 'nostalgia-reboot' outperforms sibling angles",
      stats: {
        dimension: 'angle',
        value: 'nostalgia-reboot',
        lift: 2.1,
        n: 5000,
        ciLow: 0.04,
        ciHigh: 0.06,
      },
      sensoIngested: false,
    };
    const after = await ctx.writeBackLearnings('brand-x', [learning]);

    expect(after.version).toBe(before.version + 1);
    expect(after.hash).not.toBe(before.hash);
    expect(after.factIds).toEqual(['fact-pl-angle-nostalgia-reboot']);

    const stored = getStore().getFacts('brand-x');
    const pl = stored.find((f) => f.id === 'fact-pl-angle-nostalgia-reboot');
    expect(pl?.origin).toBe('performance_loop');
    expect(pl?.section).toBe('market_prior');
  });
});
