// Pioneer seam: OpenAI-compatible chat-completions via raw fetch. Track A
// repoints LLM_BASE_URL / LLM_API_KEY / LLM_MODEL at the Pioneer gateway —
// nothing here is provider-specific. Task modules (copy, panel, research) own
// their deterministic mocks and fall back per-item when a call fails.

export type LLMConfig = { baseUrl: string; apiKey: string; model: string };

export function getLLMConfig(): LLMConfig | null {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    apiKey,
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
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

  /** Strict-JSON chat completion: one attempt + exactly one retry, then throws. */
  async jsonChat<T>(opts: { system: string; user: string; maxTokens?: number }): Promise<T> {
    try {
      return await this.attempt<T>(opts);
    } catch {
      return this.attempt<T>(opts, 'Return ONLY valid JSON. No prose, no markdown fences.');
    }
  }

  private async attempt<T>(
    { system, user, maxTokens = 600 }: { system: string; user: string; maxTokens?: number },
    extraInstruction?: string,
  ): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        response_format: { type: 'json_object' },
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
    try {
      return JSON.parse(content) as T;
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
