import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Brief } from './contracts';
import { pLimit } from './llm';
import { getStore } from './store';

// Real ad images via OpenAI gpt-image-1 /images/edits with the brand's uploaded
// product photo as input, so the actual product appears in every ad. Per-candidate
// failures degrade to SvgImageGen — a dead API downgrades the demo, never crashes
// it. Server-only (fs + store).

export const MAX_REAL_IMAGES_PER_RUN = 6;

export type ImageRequest = {
  brief: Brief;
  creativeId: string;
  brandId: string;
  brandName: string;
  /** Absolute path of the uploaded product photo; null → SVG fallback. */
  productImagePath: string | null;
  /** Selects one of 4 composition variations. */
  variant: number;
};

export type ImageResult = { url: string; mode: 'openai' | 'svg' };

export interface ImageGen {
  generate(req: ImageRequest): Promise<ImageResult>;
}

// ---- SVG fallback (offline default) ----

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

function esc(str: string): string {
  return str.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

/** Uppercases and wraps the angle into at most two ~14-char display lines. */
function angleLines(angle: string): string[] {
  const words = angle.toUpperCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= 14) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines.slice(0, 2);
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

// Same 600×750 dark/amber card as the checked-in gen-1 placeholders.
export class SvgImageGen implements ImageGen {
  async generate(req: ImageRequest): Promise<ImageResult> {
    const { brief, creativeId, brandId, brandName } = req;
    const lines = angleLines(brief.angle);
    const angleText = lines
      .map(
        (line, i) =>
          `<text x="48" y="${300 + i * 58}" font-family="${MONO}" font-size="48" font-weight="700" letter-spacing="2" fill="#f2f5f3">${esc(line)}</text>`,
      )
      .join('\n  ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750" viewBox="0 0 600 750">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3d2506"/>
      <stop offset="0.55" stop-color="#0c0e0d"/>
      <stop offset="1" stop-color="#08090a"/>
    </linearGradient>
  </defs>
  <rect width="600" height="750" fill="url(#g)"/>
  <rect x="22" y="22" width="556" height="706" fill="none" stroke="#f5a623" stroke-opacity="0.4" stroke-width="2"/>
  <line x1="48" y1="120" x2="552" y2="120" stroke="#f5a623" stroke-opacity="0.5" stroke-width="1"/>
  <text x="48" y="88" font-family="${MONO}" font-size="22" letter-spacing="6" fill="#f5a623">${esc(brandName.toUpperCase())}</text>
  <text x="48" y="180" font-family="${MONO}" font-size="18" letter-spacing="3" fill="#8a938e">ANGLE</text>
  ${angleText}
  <text x="48" y="446" font-family="${MONO}" font-size="18" letter-spacing="3" fill="#8a938e">STYLE · ${esc(brief.style.toUpperCase())}</text>
  <text x="48" y="620" font-family="${MONO}" font-size="24" fill="#f5a623">${esc(`“${brief.hook}”`)}</text>
  <line x1="48" y1="660" x2="552" y2="660" stroke="#f5a623" stroke-opacity="0.5" stroke-width="1"/>
  <text x="48" y="698" font-family="${MONO}" font-size="16" fill="#6b736e">${esc(creativeId)} · GEN ${brief.generation} · 600×750 PLACEHOLDER</text>
</svg>
`;
    const url = getStore().saveCreativeImage(brandId, `${creativeId}.svg`, Buffer.from(svg));
    return { url, mode: 'svg' };
  }
}

// ---- OpenAI gpt-image-1 (live) ----

const COMPOSITIONS = [
  'Composition: product hero centered on a clean surface, soft natural daylight, generous negative space above for a headline.',
  'Composition: product held in a hand at a slight angle, warm lifestyle kitchen background, shallow depth of field.',
  'Composition: flat-lay from directly above with complementary props arranged around the product.',
  'Composition: dramatic studio lighting on a bold color-blocked background, product placed at rule-of-thirds.',
];

const RASTER_MIMES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function buildImagePrompt(brief: Brief, brandName: string, variant: number): string {
  return [
    `Advertising photograph for ${brandName}.`,
    'Feature the provided product photo as the hero object of the ad — keep the actual product exactly as shown, unmodified and clearly recognizable.',
    `Creative angle: ${brief.angle}. Target persona: ${brief.persona}.`,
    `Core message: ${brief.coreMessage}`,
    `Visual style: ${brief.style}.`,
    COMPOSITIONS[Math.abs(variant) % COMPOSITIONS.length],
    'Leave clean space for ad copy. No text, no words, no logos beyond what appears on the product itself.',
  ].join(' ');
}

export class OpenAIImageGen implements ImageGen {
  private readonly apiKey: string;
  private readonly quality: string;

  constructor(opts?: { apiKey?: string; quality?: string }) {
    this.apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.quality = opts?.quality ?? process.env.IMAGE_QUALITY ?? 'low';
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    if (!this.apiKey) throw new Error('no OPENAI_API_KEY');
    if (!req.productImagePath) throw new Error('no product image uploaded');
    const ext = path.extname(req.productImagePath).toLowerCase();
    const mime = RASTER_MIMES[ext];
    // gpt-image-1 /images/edits rejects SVG input — the fixture product image
    // is an SVG, so the fixture brand always lands on the SVG fallback.
    if (!mime) throw new Error(`product image must be raster (png/jpg/webp), got ${ext}`);

    const bytes = readFileSync(req.productImagePath);
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('image', new Blob([new Uint8Array(bytes)], { type: mime }), `product${ext}`);
    form.append('prompt', buildImagePrompt(req.brief, req.brandName, req.variant));
    form.append('size', '1024x1536'); // closest supported size to the UI's 4:5 cards
    form.append('quality', this.quality);

    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`images/edits HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error('images/edits returned no image data');
    const url = getStore().saveCreativeImage(
      req.brandId,
      `${req.creativeId}.png`,
      Buffer.from(b64, 'base64'),
    );
    return { url, mode: 'openai' };
  }
}

export function getOpenAIImageGen(): ImageGen | null {
  return process.env.OPENAI_API_KEY ? new OpenAIImageGen() : null;
}

/**
 * Generates a batch: at most MAX_REAL_IMAGES_PER_RUN candidates get real
 * generation (concurrency 2, one retry each); the rest — and every failed
 * candidate — get the SVG card.
 */
export async function generateAll(
  requests: ImageRequest[],
  deps: { openai: ImageGen | null; svg: ImageGen },
): Promise<ImageResult[]> {
  const limit = pLimit(2);
  return Promise.all(
    requests.map((req, i) =>
      limit(async () => {
        if (deps.openai && i < MAX_REAL_IMAGES_PER_RUN) {
          try {
            return await deps.openai.generate(req);
          } catch {
            try {
              return await deps.openai.generate(req);
            } catch {
              // fall through to the SVG card for this candidate only
            }
          }
        }
        return deps.svg.generate(req);
      }),
    ),
  );
}
