import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPLLMClient, LLMError, pLimit } from './llm';

const chatResponse = (content: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});

const CONFIG = { baseUrl: 'http://llm.test/v1', apiKey: 'test-key', model: 'test-model' };

beforeEach(() => {
  // safety net: anything not explicitly stubbed must not reach the network
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in tests'))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTPLLMClient.jsonChat', () => {
  it('parses strict JSON from the completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse('{"x":1}')));
    const client = new HTTPLLMClient(CONFIG);
    await expect(client.jsonChat<{ x: number }>({ system: 's', user: 'u' })).resolves.toEqual({
      x: 1,
    });
  });

  it('retries exactly once after invalid JSON, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatResponse('not json at all'))
      .mockResolvedValueOnce(chatResponse('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HTTPLLMClient(CONFIG);
    await expect(client.jsonChat({ system: 's', user: 'u' })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws LLMError after the single retry also fails', async () => {
    const fetchMock = vi.fn(async () => chatResponse('still not json'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HTTPLLMClient(CONFIG);
    await expect(client.jsonChat({ system: 's', user: 'u' })).rejects.toBeInstanceOf(LLMError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws LLMError on network failure (callers fall back per-item)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    const client = new HTTPLLMClient(CONFIG);
    await expect(client.jsonChat({ system: 's', user: 'u' })).rejects.toThrow();
  });
});

describe('pLimit', () => {
  it('caps concurrent executions', async () => {
    const limit = pLimit(2);
    let active = 0;
    let peak = 0;
    const task = () =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      });
    await Promise.all([task(), task(), task(), task(), task(), task()]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('propagates results and errors', async () => {
    const limit = pLimit(1);
    await expect(limit(async () => 42)).resolves.toBe(42);
    await expect(limit(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    // the semaphore must release after a rejection
    await expect(limit(async () => 'still works')).resolves.toBe('still works');
  });
});
