/**
 * Gemini — real image-gen adapter. Product image passed as reference.
 * Set GEMINI_API_KEY (+ GEMINI_IMAGE_MODEL).
 *
 * SKELETON: uses the Generative Language REST API. Confirm the image model id
 * and response shape (inline base64 vs. file URI) when the key lands. Slowest,
 * most quota-limited call — pre-bake for the golden run; only gen-2 regenerates live.
 */

import type { ImageGen } from '../interfaces';

const MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function createGeminiImageGen(): ImageGen {
  return {
    async generate(prompt, refImageUrl) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error('GEMINI_API_KEY not set');

      // TODO: fetch refImageUrl → base64 and include as inlineData for image-conditioning.
      void refImageUrl;

      const res = await fetch(`${BASE}/models/${MODEL}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
      const j = (await res.json()) as {
        candidates: { content: { parts: { inlineData?: { data: string } }[] } }[];
      };
      const b64 = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
      if (!b64) throw new Error('Gemini returned no image');
      // Caller persists to Supabase storage; return a data URL for now.
      return { imageUrl: `data:image/png;base64,${b64}` };
    },
  };
}
