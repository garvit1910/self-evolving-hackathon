/**
 * Pioneer / Fastino — real LLM adapter. OpenAI-compatible, so raw fetch, no SDK.
 * Set PIONEER_BASE_URL, PIONEER_API_KEY, PIONEER_MODEL.
 *
 * CREDIBILITY NOTE: use `extract` (structured/JSON output) for the Analyst path,
 * not generic chat — that's what flips this from "base_url swap" to "deep".
 */

import type { LLM } from '../interfaces';

type ChatMessage = { role: 'system' | 'user'; content: string };

async function chat(messages: ChatMessage[]): Promise<string> {
  const base = process.env.PIONEER_BASE_URL;
  const key = process.env.PIONEER_API_KEY;
  const model = process.env.PIONEER_MODEL ?? 'fastino-default';
  if (!base || !key) throw new Error('PIONEER_BASE_URL / PIONEER_API_KEY not set');

  const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, messages, temperature: 0 }),
  });
  if (!res.ok) throw new Error(`Pioneer ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return json.choices[0]?.message?.content ?? '';
}

export function createPioneerLLM(): LLM {
  return {
    async extract<T>(prompt: string, schemaHint: string): Promise<T> {
      const content = await chat([
        {
          role: 'system',
          content:
            'You are a structured extraction engine. Respond ONLY with valid JSON matching the schema. No prose.',
        },
        { role: 'user', content: `${prompt}\n\nSchema:\n${schemaHint}` },
      ]);
      // tolerate ```json fences
      const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      return JSON.parse(cleaned) as T;
    },
    async complete(prompt: string): Promise<string> {
      return chat([{ role: 'user', content: prompt }]);
    },
  };
}
