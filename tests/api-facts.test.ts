import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getContext } from '@/app/api/brands/[id]/context/route';
import { POST as postEvents, GET as getEvents } from '@/app/api/brands/[id]/events/route';
import { POST as postFacts } from '@/app/api/brands/[id]/facts/route';
import { getStore } from '@/lib/store';

const BRAND_ID = 'brand-x';
const ctx = { params: Promise.resolve({ id: BRAND_ID }) };

const jsonRequest = (body: unknown) =>
  new Request(`http://test/api/brands/${BRAND_ID}/facts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const factInput = (id: string, statement: string, origin?: string) => ({
  id,
  section: 'positioning',
  statement,
  confidence: 0.9,
  ...(origin ? { origin } : {}),
});

beforeEach(() => {
  vi.stubEnv('DATA_DIR', mkdtempSync(path.join(tmpdir(), 'adcero-')));
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('LLM_API_KEY', '');
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in tests'))));
  getStore().putBrand({
    id: BRAND_ID,
    url: 'https://x.test',
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

describe('POST /api/brands/:id/facts', () => {
  it('ingests facts, bumps version, returns a 16-hex hash', async () => {
    const res = await postFacts(jsonRequest([factInput('f1', 'one'), factInput('f2', 'two')]), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted).toBe(2);
    expect(body.dropped).toBe(0);
    expect(body.version).toBe(1);
    expect(body.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('identical re-post does not bump version; a new fact does; performance_loop flips the hash again', async () => {
    const first = await (await postFacts(jsonRequest([factInput('f1', 'one')]), ctx)).json();
    const repost = await (await postFacts(jsonRequest([factInput('f1', 'one')]), ctx)).json();
    expect(repost.version).toBe(first.version);
    expect(repost.hash).toBe(first.hash);

    const second = await (await postFacts(jsonRequest([factInput('f2', 'two')]), ctx)).json();
    expect(second.version).toBe(first.version + 1);
    expect(second.hash).not.toBe(first.hash);

    const third = await (
      await postFacts(jsonRequest([factInput('f-pl', 'learned', 'performance_loop')]), ctx)
    ).json();
    expect(third.version).toBe(second.version + 1);
    expect(third.hash).not.toBe(second.hash);
    const stored = getStore().getFacts(BRAND_ID);
    expect(stored.find((f) => f.id === 'f-pl')?.origin).toBe('performance_loop');
  });

  it('drops malformed facts, keeps valid ones, forces brandId', async () => {
    const res = await postFacts(
      jsonRequest([
        factInput('good', 'a valid statement'),
        { section: 'positioning', statement: '' }, // empty statement
        { section: 'not-a-section', statement: 'x' }, // bad section
      ]),
      ctx,
    );
    const body = await res.json();
    expect(body.accepted).toBe(1);
    expect(body.dropped).toBe(2);
    expect(getStore().getFacts(BRAND_ID).every((f) => f.brandId === BRAND_ID)).toBe(true);
  });

  it('404s for an unknown brand', async () => {
    const res = await postFacts(jsonRequest([factInput('f1', 'one')]), {
      params: Promise.resolve({ id: 'brand-nope' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/brands/:id/context', () => {
  it('returns the snapshot matching the last ingest', async () => {
    const posted = await (await postFacts(jsonRequest([factInput('f1', 'one')]), ctx)).json();
    const res = await getContext(new Request('http://test'), ctx);
    const snap = await res.json();
    expect(snap.brandId).toBe(BRAND_ID);
    expect(snap.version).toBe(posted.version);
    expect(snap.hash).toBe(posted.hash);
    expect(snap.facts).toHaveLength(1);
  });
});

describe('/api/brands/:id/events', () => {
  it('appends valid events and filters strictly-greater ?since=', async () => {
    const post = await postEvents(
      new Request('http://test', {
        method: 'POST',
        body: JSON.stringify([
          { step: 'research', status: 'running', ts: 100 },
          { step: 'research', status: 'done', ts: 200 },
          { step: 'bogus', status: 'done', ts: 300 }, // dropped
        ]),
      }),
      ctx,
    );
    expect((await post.json()).count).toBe(2);

    const all = await (await getEvents(new Request('http://test/events'), ctx)).json();
    expect(all.events).toHaveLength(2);

    const since = await (
      await getEvents(new Request('http://test/events?since=100'), ctx)
    ).json();
    expect(since.events).toHaveLength(1);
    expect(since.events[0].ts).toBe(200);
  });
});
