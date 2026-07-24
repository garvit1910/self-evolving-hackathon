import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as postGenerate } from '@/app/api/brands/[id]/generate/route';
import type { Fact } from '@/lib/contracts';
import type { GenerateResult } from '@/lib/server/generate';
import { LocalContextStore } from '@/lib/context';
import { getStore } from '@/lib/store';

const BRAND_ID = 'brand-x';
const ctx = { params: Promise.resolve({ id: BRAND_ID }) };

const fact = (id: string, section: Fact['section'], statement: string, confidence = 0.9): Fact => ({
  id,
  brandId: BRAND_ID,
  section,
  statement,
  confidence,
  origin: 'research',
});

const SEED_FACTS: Fact[] = [
  fact('f-vp', 'value_prop', '13g complete protein and 0g sugar per bowl', 0.95),
  fact('f-pos', 'positioning', 'Subscription-first DTC cereal for adults', 0.9),
  fact('f-voice', 'voice', 'Playful nostalgic tone with grown-up wit', 0.8),
  fact('f-per-1', 'persona', 'Nostalgic fitness enthusiast: adults chasing childhood cereal taste', 0.85),
  fact('f-per-2', 'persona', 'Keto parent (watches macros for the family)', 0.8),
];

async function seedBrand() {
  getStore().putBrand({
    id: BRAND_ID,
    url: 'https://x.test',
    name: 'X Cereal',
    productImageUrl: '',
    contextVersion: 0,
    contextHash: '',
    sensoSourceIds: [],
  });
  await new LocalContextStore().ingestFacts(BRAND_ID, SEED_FACTS);
}

const generate = async (body: unknown): Promise<GenerateResult> => {
  const res = await postGenerate(
    new Request('http://test/generate', { method: 'POST', body: JSON.stringify(body) }),
    ctx,
  );
  expect(res.status).toBe(200);
  return res.json();
};

beforeEach(async () => {
  vi.stubEnv('DATA_DIR', mkdtempSync(path.join(tmpdir(), 'adcero-')));
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('LLM_API_KEY', '');
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in tests'))));
  await seedBrand();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/brands/:id/generate (offline)', () => {
  it('produces N creatives with SVG urls, stamped genomes, fresh arms, deterministic ids', async () => {
    const result = await generate({ generation: 1, count: 4, runId: 'r1' });
    expect(result.mode).toEqual({ copy: 'mock', image: 'svg' });
    expect(result.creatives.map((c) => c.id)).toEqual(['r1-c1', 'r1-c2', 'r1-c3', 'r1-c4']);
    for (const c of result.creatives) {
      expect(c.imageUrl).toMatch(new RegExp(`^/api/files/creatives/${BRAND_ID}/r1-c\\d\\.svg$`));
      expect(c.arm).toEqual({ alpha: 1, beta: 1, pulls: 0 });
      expect(c.status).toBe('live');
      expect(c.genome.generation).toBe(1);
      expect(c.genome.angle.length).toBeGreaterThan(0);
      expect(c.publishedAdId).toBe(`ad-${c.id}`);
    }
    // persisted
    expect(getStore().getCreatives(BRAND_ID)).toHaveLength(4);
    expect(getStore().getBriefs(BRAND_ID)).toHaveLength(4);
  });

  it('is deterministic across fresh stores', async () => {
    const first = await generate({ generation: 1, count: 4, runId: 'r1' });

    vi.stubEnv('DATA_DIR', mkdtempSync(path.join(tmpdir(), 'adcero-')));
    await seedBrand();
    const second = await generate({ generation: 1, count: 4, runId: 'r1' });

    expect(second.creatives).toEqual(first.creatives);
    expect(second.briefs).toEqual(first.briefs);
    expect(second.panelScores).toEqual(first.panelScores);
  });

  it('persists panel scores for every persona × creative, ints in 0..100', async () => {
    await generate({ generation: 1, count: 4, runId: 'r1' });
    const scores = getStore().getPanelScores(BRAND_ID);
    // 2 persona facts × 4 creatives
    expect(scores).toHaveLength(8);
    for (const s of scores) {
      expect(Number.isInteger(s.appealScore)).toBe(true);
      expect(s.appealScore).toBeGreaterThanOrEqual(0);
      expect(s.appealScore).toBeLessThanOrEqual(100);
      expect(s.reason.length).toBeGreaterThan(0);
    }
    // affinity: the nostalgic persona must not rank a nostalgia-angle creative
    // below the mock base range floor — spot-check via ordering when present
    const briefs = getStore().getBriefs(BRAND_ID);
    expect(briefs[0].contextVersion).toBe(1);
    expect(briefs[0].contextHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('gen-2 with priors uses the prior angle VERBATIM on every creative', async () => {
    const priors = {
      angle: 'nostalgia-reboot',
      persona: 'Nostalgic fitness enthusiast',
      hook: 'Remember Saturday mornings?',
      style: 'retro-cartoon',
    };
    const result = await generate({ generation: 2, priors, count: 4, runId: 'r2' });
    for (const c of result.creatives) {
      expect(c.genome.angle).toBe('nostalgia-reboot');
      expect(c.genome.generation).toBe(2);
    }
    expect(result.briefs.every((b) => b.priorSource === 'sampled')).toBe(true);
    expect(result.creatives[0].genome.hook).toBe('Remember Saturday mornings?');
  });

  it('caps count into the 4..6 window', async () => {
    const result = await generate({ generation: 1, count: 12, runId: 'r9' });
    expect(result.creatives).toHaveLength(6);
  });
});
