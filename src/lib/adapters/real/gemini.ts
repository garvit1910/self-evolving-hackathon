/**
 * Gemini — script-side image-gen adapter. Product image passed as reference.
 * Set GEMINI_API_KEY (+ GEMINI_IMAGE_MODEL).
 *
 * UNIFIED at merge: this shim speaks the request shape ALREADY smoke-verified
 * by Track G's src/lib/imagegen.ts (`x-goog-api-key` header, default model
 * gemini-3.1-flash-image, parts [{text}, {inline_data}], 4:5 aspect) instead
 * of the pre-merge unverified variant (`?key=` auth, gemini-2.5-flash-image).
 * The app path uses src/lib/imagegen.ts directly; this adapter exists for the
 * standalone engine scripts (`USE_REAL_GEMINI=1 npm run test:creative`).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageGen } from '../interfaces';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function referencePart(refImageUrl: string): Promise<Record<string, unknown> | null> {
  try {
    if (/^https?:/.test(refImageUrl)) {
      const res = await fetch(refImageUrl);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      return {
        inline_data: {
          mime_type: res.headers.get('content-type') ?? 'image/png',
          data: Buffer.from(await res.arrayBuffer()).toString('base64'),
        },
      };
    }
    // app-relative path (e.g. /fixtures/product.png) → read from public/
    if (refImageUrl.endsWith('.svg')) return null; // Gemini wants raster references
    const buf = await readFile(join(process.cwd(), 'public', refImageUrl.replace(/^\//, '')));
    return { inline_data: { mime_type: 'image/png', data: buf.toString('base64') } };
  } catch (err) {
    console.warn(
      `[gemini] reference image unavailable (${(err as Error).message} ${refImageUrl}) — generating without product conditioning`,
    );
    return null;
  }
}

export function createGeminiImageGen(): ImageGen {
  return {
    async generate(prompt, refImageUrl) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error('GEMINI_API_KEY not set');
      const model = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image';

      const parts: unknown[] = [{ text: prompt }];
      const ref = refImageUrl ? await referencePart(refImageUrl) : null;
      if (ref) parts.push(ref);

      const res = await fetch(`${BASE}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { imageConfig: { aspectRatio: '4:5' } },
        }),
      });
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
      const j = (await res.json()) as {
        candidates?: {
          content?: { parts?: { inlineData?: { data?: string }; inline_data?: { data?: string } }[] };
        }[];
      };
      const b64 = j.candidates?.[0]?.content?.parts
        ?.map((p) => p.inlineData?.data ?? p.inline_data?.data)
        .find(Boolean);
      if (!b64) throw new Error('Gemini returned no image');
      return { imageUrl: `data:image/png;base64,${b64}` };
    },
  };
}
