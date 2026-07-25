/**
 * Pioneer / Fastino — real LLM adapter. OpenAI-compatible, so raw fetch, no SDK.
 * Set PIONEER_BASE_URL, PIONEER_API_KEY, PIONEER_MODEL.
 *
 * CREDIBILITY NOTE: use `extract` (structured/JSON output) for the Analyst path,
 * not generic chat — that's what flips this from "base_url swap" to "deep".
 */

import type { LLM } from '../interfaces';

type ChatMessage = { role: 'system' | 'user'; content: string };

// Gateway rosters churn (pioneer/auto vanished mid-hackathon): when the
// configured model 404s, discover /models once and stick with the pick.
const MODEL_PREFERENCES = ['claude-haiku-4-5', 'gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini'];
let modelOverride: string | null = null;

async function discoverModel(base: string, key: string): Promise<string | null> {
  if (modelOverride) return modelOverride;
  try {
    const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: { id: string }[] };
    const ids = new Set((j.data ?? []).map((m) => m.id));
    modelOverride = MODEL_PREFERENCES.find((m) => ids.has(m)) ?? j.data?.[0]?.id ?? null;
    if (modelOverride) console.warn(`[pioneer] configured model unavailable — using "${modelOverride}"`);
    return modelOverride;
  } catch {
    return null;
  }
}

async function chat(messages: ChatMessage[]): Promise<string> {
  const base = process.env.PIONEER_BASE_URL?.replace(/\/$/, '');
  const key = process.env.PIONEER_API_KEY;
  if (!base || !key) throw new Error('PIONEER_BASE_URL / PIONEER_API_KEY not set');
  const model = modelOverride ?? process.env.PIONEER_MODEL ?? 'fastino-default';

  const attempt = (m: string) =>
    fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model: m, messages, temperature: 0 }),
    });

  let res = await attempt(model);
  if (res.status === 404) {
    const fallback = await discoverModel(base, key);
    if (fallback) res = await attempt(fallback);
  }
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
