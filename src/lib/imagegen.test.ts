import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Brief } from './contracts';
import {
  GeminiImageGen,
  MAX_REAL_IMAGES_PER_RUN,
  OpenAIImageGen,
  SvgImageGen,
  generateAll,
  type ImageRequest,
} from './imagegen';

let dataDir: string;

const brief = (n: number): Brief => ({
  id: `r1-b${n}`,
  brandId: 'brand-x',
  generation: 1,
  angle: 'nostalgia-reboot',
  persona: 'nostalgic fitness enthusiast',
  hook: 'Remember Saturday mornings?',
  style: 'retro-cartoon',
  coreMessage: '13g protein, 0g sugar per bowl',
  cta: 'Shop now',
  sourceFactIds: ['fact-01'],
  contextVersion: 1,
  contextHash: 'abcd1234abcd1234',
  priorSource: 'default_rotation',
});

const request = (n: number, productImagePath: string | null): ImageRequest => ({
  brief: brief(n),
  creativeId: `r1-c${n}`,
  brandId: 'brand-x',
  brandName: 'Magic Spoon',
  productImagePath,
  variant: n,
});

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'adcero-'));
  vi.stubEnv('DATA_DIR', dataDir);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in tests'))));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('SvgImageGen', () => {
  it('is deterministic and embeds the genome strings', async () => {
    const gen = new SvgImageGen();
    const a = await gen.generate(request(1, null));
    const first = readFileSync(path.join(dataDir, 'creatives', 'brand-x', 'r1-c1.svg'), 'utf8');
    const b = await gen.generate(request(1, null));
    const second = readFileSync(path.join(dataDir, 'creatives', 'brand-x', 'r1-c1.svg'), 'utf8');

    expect(a).toEqual({ url: '/api/files/creatives/brand-x/r1-c1.svg', mode: 'svg' });
    expect(b).toEqual(a);
    expect(first).toBe(second);
    // wraps like the original card: NOSTALGIA / REBOOT on separate lines
    expect(first).toContain('>NOSTALGIA</text>');
    expect(first).toContain('>REBOOT</text>');
    expect(first).toContain('RETRO-CARTOON');
    expect(first).toContain('Remember Saturday mornings?');
    expect(first).toContain('MAGIC SPOON');
    expect(first).toContain('GEN 1');
  });

  it('escapes XML-unsafe characters', async () => {
    const gen = new SvgImageGen();
    const req = request(2, null);
    req.brief.hook = 'Protein & <fiber> "wins"';
    await gen.generate(req);
    const svg = readFileSync(path.join(dataDir, 'creatives', 'brand-x', 'r1-c2.svg'), 'utf8');
    expect(svg).toContain('&amp;');
    expect(svg).not.toContain('<fiber>');
  });
});

describe('generateAll fallback + cap', () => {
  const productPng = () => {
    const file = path.join(dataDir, 'product.png');
    writeFileSync(file, Buffer.from('fake-png'));
    return file;
  };

  it('rejecting fetch → every candidate degrades to SVG, nothing throws', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('api down')));
    vi.stubGlobal('fetch', fetchMock);
    const results = await generateAll(
      [request(1, productPng()), request(2, productPng())],
      { live: new OpenAIImageGen({ apiKey: 'k' }), svg: new SvgImageGen() },
    );
    expect(results.every((r) => r.mode === 'svg')).toBe(true);
    expect(results.every((r) => r.url.endsWith('.svg'))).toBe(true);
    // per candidate: (primary + mini-downgrade) × (attempt + one retry) = 4 calls
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(existsSync(path.join(dataDir, 'creatives', 'brand-x', 'r1-c1.svg'))).toBe(true);
  });

  it('caps real generation at 6 per run; extras go straight to SVG', async () => {
    const b64 = Buffer.from('fake-generated-png').toString('base64');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ b64_json: b64 }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const img = productPng();
    const results = await generateAll(
      Array.from({ length: 8 }, (_, i) => request(i + 1, img)),
      { live: new OpenAIImageGen({ apiKey: 'k' }), svg: new SvgImageGen() },
    );
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REAL_IMAGES_PER_RUN);
    expect(results.filter((r) => r.mode === 'openai')).toHaveLength(6);
    expect(results.filter((r) => r.mode === 'svg')).toHaveLength(2);
    expect(results[0].url).toBe('/api/files/creatives/brand-x/r1-c1.png');
  });

  it('SVG product image is rejected before any network call', async () => {
    const svgProduct = path.join(dataDir, 'product.svg');
    writeFileSync(svgProduct, '<svg/>');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const [result] = await generateAll([request(1, svgProduct)], {
      live: new OpenAIImageGen({ apiKey: 'k' }),
      svg: new SvgImageGen(),
    });
    expect(result.mode).toBe('svg');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GeminiImageGen', () => {
  it('parses inline image data and writes the png', async () => {
    const b64 = Buffer.from('fake-gemini-png').toString('base64');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                { text: 'here is your ad' },
                { inlineData: { mimeType: 'image/png', data: b64 } },
              ],
            },
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const file = path.join(dataDir, 'product.png');
    writeFileSync(file, Buffer.from('fake-png'));
    const gen = new GeminiImageGen({ apiKey: 'k', model: 'gemini-3.1-flash-image' });
    const result = await gen.generate(request(1, file));
    expect(result).toEqual({ url: '/api/files/creatives/brand-x/r1-c1.png', mode: 'gemini' });
    expect(existsSync(path.join(dataDir, 'creatives', 'brand-x', 'r1-c1.png'))).toBe(true);
    const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(call[0]).toContain('gemini-3.1-flash-image:generateContent');
    expect(call[1].body).toContain('inline_data');
  });

  it('rejecting fetch degrades to SVG through generateAll', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('api down'))));
    const file = path.join(dataDir, 'product.png');
    writeFileSync(file, Buffer.from('fake-png'));
    const [result] = await generateAll([request(1, file)], {
      live: new GeminiImageGen({ apiKey: 'k' }),
      svg: new SvgImageGen(),
    });
    expect(result.mode).toBe('svg');
  });

  it('provider chain: quota-blocked Gemini falls through to OpenAI', async () => {
    const b64 = Buffer.from('fake-openai-png').toString('base64');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('generativelanguage.googleapis.com')) {
        return { ok: false, status: 429, text: async () => 'free tier quota' };
      }
      return { ok: true, json: async () => ({ data: [{ b64_json: b64 }] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const file = path.join(dataDir, 'product.png');
    writeFileSync(file, Buffer.from('fake-png'));
    const { ChainImageGen } = await import('./imagegen');
    const chain = new ChainImageGen([
      new GeminiImageGen({ apiKey: 'g' }),
      new OpenAIImageGen({ apiKey: 'o' }),
    ]);
    const result = await chain.generate(request(1, file));
    expect(result.mode).toBe('openai');
    expect(result.url).toBe('/api/files/creatives/brand-x/r1-c1.png');
  });
});
