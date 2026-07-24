import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotEvent } from '../contracts';
import { getStore } from '../store';
import { runInterimResearch, type ResearchLLM } from './interim';

const BRAND_ID = 'brand-x';
const HOME_URL = 'https://x.test';

const HOMEPAGE_HTML = `<html><head><title>X Cereal</title>
<style>.x{color:red}</style><script>alert('hi')</script></head>
<body><h1>X Cereal</h1>
<p>Every bowl packs 13g of complete protein and “absolutely zero grams” of sugar.</p>
<a href="/about">About us</a>
<a href="https://elsewhere.example/offsite">Offsite</a>
</body></html>`;

const ABOUT_HTML = `<html><body>
<p>We started X Cereal because adults deserve their childhood favorites, re-engineered
for grown-up macros.</p>
</body></html>`;

function pageFetchStub() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const html = url === HOME_URL ? HOMEPAGE_HTML : url.endsWith('/about') ? ABOUT_HTML : null;
    if (html === null) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => html };
  }) as unknown as typeof fetch;
}

const fakeLLM = (facts: unknown[]): ResearchLLM => ({
  jsonChat: async <T,>() => ({ facts }) as T,
});

beforeEach(() => {
  vi.stubEnv('DATA_DIR', mkdtempSync(path.join(tmpdir(), 'adcero-')));
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('LLM_API_KEY', '');
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in tests'))));
  getStore().putBrand({
    id: BRAND_ID,
    url: HOME_URL,
    name: 'X',
    productImageUrl: '',
    contextVersion: 0,
    contextHash: '',
    sensoSourceIds: [],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('runInterimResearch', () => {
  it('keeps quote-verified facts and DROPS fabricated quotes', async () => {
    const events: Omit<AutopilotEvent, 'ts'>[] = [];
    const result = await runInterimResearch({
      brandId: BRAND_ID,
      url: HOME_URL,
      fetchImpl: pageFetchStub(),
      postEvent: (e) => void events.push(e),
      llm: fakeLLM([
        {
          section: 'value_prop',
          statement: '13g complete protein per bowl',
          sourceUrl: HOME_URL,
          sourceQuote: '13g of complete protein',
          confidence: 0.95,
        },
        {
          section: 'positioning',
          statement: 'Childhood favorites for adult macros',
          sourceUrl: `${HOME_URL}/about`,
          sourceQuote: 'childhood favorites, re-engineered for grown-up macros',
          confidence: 0.9,
        },
        {
          section: 'value_prop',
          statement: 'Endorsed by 9 out of 10 dentists',
          sourceUrl: HOME_URL,
          sourceQuote: 'nine out of ten dentists recommend X Cereal', // fabricated
          confidence: 0.8,
        },
      ]),
    });

    expect(result.mode).toBe('live');
    expect(result.factCount).toBe(2);
    expect(result.droppedQuotes).toBe(1);

    const stored = getStore().getFacts(BRAND_ID);
    expect(stored).toHaveLength(2);
    expect(stored.map((f) => f.id)).toEqual(['fact-01', 'fact-02']);
    expect(stored.every((f) => f.origin === 'research' && f.brandId === BRAND_ID)).toBe(true);
    // context version bumped by the ingest
    expect(getStore().getBrand(BRAND_ID)?.contextVersion).toBe(1);
    // events look like the swarm's: Scout narration + per-fact Analyst lines + done
    expect(events.some((e) => (e.payload as { agent?: string })?.agent === 'Scout')).toBe(true);
    expect(
      events.filter((e) => (e.payload as { factId?: string })?.factId !== undefined),
    ).toHaveLength(2);
    const done = events.find((e) => e.status === 'done');
    expect((done?.payload as { droppedQuotes?: number })?.droppedQuotes).toBe(1);
  });

  it('normalizes curly quotes and whitespace when verifying', async () => {
    const result = await runInterimResearch({
      brandId: BRAND_ID,
      url: HOME_URL,
      fetchImpl: pageFetchStub(),
      postEvent: () => {},
      llm: fakeLLM([
        {
          section: 'value_prop',
          statement: 'Zero sugar claim',
          sourceUrl: HOME_URL,
          // straight quotes + messy whitespace vs the page's curly quotes
          sourceQuote: '"absolutely   zero grams" of sugar',
          confidence: 0.9,
        },
      ]),
    });
    expect(result.factCount).toBe(1);
    expect(result.droppedQuotes).toBe(0);
  });

  it('falls back to relabeled fixture facts when no LLM is available', async () => {
    const events: Omit<AutopilotEvent, 'ts'>[] = [];
    const result = await runInterimResearch({
      brandId: BRAND_ID,
      url: HOME_URL,
      llm: null,
      fetchImpl: pageFetchStub(),
      postEvent: (e) => void events.push(e),
    });

    expect(result.mode).toBe('fallback');
    expect(result.factCount).toBeGreaterThanOrEqual(8);
    const stored = getStore().getFacts(BRAND_ID);
    expect(stored.every((f) => f.brandId === BRAND_ID)).toBe(true);
    expect(
      events.some((e) =>
        String((e.payload as { message?: string })?.message ?? '').includes('fallback'),
      ),
    ).toBe(true);
  });
});
