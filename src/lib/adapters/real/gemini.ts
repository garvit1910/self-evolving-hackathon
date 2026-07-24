/**
 * Gemini — real image-gen adapter. Product image passed as reference.
 * Set GEMINI_API_KEY (+ GEMINI_IMAGE_MODEL).
 *
 * Product image is fetched and passed as an inlineData reference part. Confirm
 * the image model id and response shape (inline base64 vs. file URI) when the
 * key lands. Slowest, most quota-limited call — pre-bake for the golden run;
 * only gen-2 regenerates live.
 */

import type { ImageGen } from '../interfaces';

const MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function createGeminiImageGen(): ImageGen {
  return {
    async generate(prompt, refImageUrl) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error('GEMINI_API_KEY not set');

      // Product image as reference: fetch → base64 → inlineData part. Without
      // this the generated ad shows a generic product, not the brand's.
      const parts: unknown[] = [{ text: prompt }];
      if (refImageUrl && /^https?:/.test(refImageUrl)) {
        const imgRes = await fetch(refImageUrl);
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          parts.unshift({
            inlineData: {
              mimeType: imgRes.headers.get('content-type') ?? 'image/png',
              data: buf.toString('base64'),
            },
          });
        } else {
          console.warn(
            `[gemini] reference image fetch failed (${imgRes.status} ${refImageUrl}) — generating without product conditioning`,
          );
        }
      }

      const res = await fetch(`${BASE}/models/${MODEL}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] }),
      });
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
      const j = (await res.json()) as {
        candidates: { content: { parts: { inlineData?: { data: string } }[] } }[];
      };
      const b64 = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
      if (!b64) throw new Error('Gemini returned no image');
      return { imageUrl: `data:image/png;base64,${b64}` };
    },
  };
}
