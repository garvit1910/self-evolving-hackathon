// LLM seam: OpenAI-compatible chat-completions via raw fetch. Every text call
// (copywriter, persona panel, research analyst) routes through getLLMConfig().
// PIONEER IS THE LIVE GATEWAY: USE_REAL_PIONEER=1 + PIONEER_BASE_URL/API_KEY/
// MODEL routes everything through Pioneer; the kill switch (unset/0) drops to
// LLM_* / OPENAI_API_KEY, and with no keys at all the task modules use their
// deterministic mocks. Nothing here is provider-specific.

export type LLMConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** set by getLLMConfig(); ad-hoc configs (tests) may omit it */
  provider?: 'pioneer' | 'openai-compatible';
};

function flagOn(name: string): boolean {
  return process.env[name] === '1' || process.env[name] === 'true';
}

export function getLLMConfig(): LLMConfig | null {
  if (flagOn('USE_REAL_PIONEER') && process.env.PIONEER_BASE_URL && process.env.PIONEER_API_KEY) {
    return {
      baseUrl: process.env.PIONEER_BASE_URL.replace(/\/$/, ''),
      apiKey: process.env.PIONEER_API_KEY,
      model: process.env.PIONEER_MODEL || 'fastino-default',
      provider: 'pioneer',
    };
  }
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    apiKey,
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    provider: 'openai-compatible',
  };
}

export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMError';
  }
}

export class HTTPLLMClient {
  constructor(private readonly config: LLMConfig) {}

  /** Strict-JSON chat completion: one attempt + exactly one retry, then throws.
   *  The retry drops `response_format` (gateways that don't implement OpenAI
   *  json mode 400 on it — e.g. some Pioneer models) and leans on the prompt. */
  async jsonChat<T>(opts: { system: string; user: string; maxTokens?: number }): Promise<T> {
    try {
      return await this.attempt<T>(opts, { jsonMode: true });
    } catch {
      return this.attempt<T>(opts, {
        jsonMode: false,
        extraInstruction: 'Return ONLY valid JSON. No prose, no markdown fences.',
      });
    }
  }

  private async attempt<T>(
    { system, user, maxTokens = 600 }: { system: string; user: string; maxTokens?: number },
    { jsonMode, extraInstruction }: { jsonMode: boolean; extraInstruction?: string },
  ): Promise<T> {
    // Pioneer routes to reasoning models whose max_tokens covers reasoning +
    // visible output; small caps truncate mid-JSON (finish_reason 'length').
    if (this.config.provider === 'pioneer') maxTokens = Math.max(maxTokens, 2048);
    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: extraInstruction ? `${system}\n${extraInstruction}` : system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new LLMError(`LLM HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new LLMError('LLM response had no content');
    const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      throw new LLMError('LLM returned invalid JSON');
    }
  }
}

/** Tiny semaphore: wraps async fns so at most `concurrency` run at once. */
export function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
