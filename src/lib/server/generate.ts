import type { Brief, Creative, PanelScore, ProviderMode } from '../contracts';
import { getContextStore } from '../context';
import { composeBriefs, type Priors } from '../creative/compose';
import { SvgImageGen, generateAll, getLiveImageGen, type ImageRequest } from '../imagegen';
import { HTTPLLMClient, getLLMConfig, pLimit } from '../llm';
import { scorePanel } from '../panel';
import { getStore } from '../store';

// The /generate pipeline: facts → deterministic briefs → copy (LLM, per-item
// mock fallback) → images (real gen, per-candidate SVG fallback) → persisted
// creatives with stamped genomes + fresh arms → panel scores.

const MIN_COUNT = 4;
const MAX_COUNT = 6;

/** Deterministic copy fallback — same brief, same copy. */
export function mockCopy(brief: Brief): string {
  return `${brief.hook} ${brief.coreMessage} ${brief.cta}.`;
}

export type GenerateResult = {
  creatives: Creative[];
  briefs: Brief[];
  panelScores: PanelScore[];
  mode: { copy: ProviderMode; image: 'gemini' | 'openai' | 'svg' | 'mixed' };
};

export async function generateCreatives(opts: {
  brandId: string;
  generation: 1 | 2;
  priors?: Priors;
  count?: number;
  runId?: string;
}): Promise<GenerateResult> {
  const store = getStore();
  const brand = store.getBrand(opts.brandId);
  if (!brand) throw new Error(`unknown brand: ${opts.brandId}`);

  const count = Math.max(MIN_COUNT, Math.min(MAX_COUNT, opts.count ?? (opts.generation === 2 ? 4 : 6)));
  const facts = store.getFacts(opts.brandId);
  const contextStore = getContextStore();
  const { version, hash } = await contextStore.getVersion(opts.brandId);

  // runId derived from store state, not clocks — offline generation is replayable
  const priorRuns = store.getBriefs(opts.brandId).filter((b) => b.generation === opts.generation);
  const runId = opts.runId ?? `g${opts.generation}r${priorRuns.length + 1}`;

  const queryText =
    facts.find((f) => f.section === 'value_prop')?.statement ?? `${brand.name} advertising angles`;
  const rankedFacts = await contextStore.search(opts.brandId, queryText, 6);

  const briefs = composeBriefs({
    brand,
    facts,
    rankedFacts,
    priors: opts.priors,
    count,
    generation: opts.generation,
    runId,
    contextVersion: version,
    contextHash: hash,
  });

  // -- copy --
  const llmConfig = getLLMConfig();
  const client = llmConfig ? new HTTPLLMClient(llmConfig) : null;
  const limit = pLimit(4);
  let anyLiveCopy = false;
  const copies = await Promise.all(
    briefs.map((brief) =>
      limit(async () => {
        if (!client) return mockCopy(brief);
        try {
          const r = await client.jsonChat<{ copy: string }>({
            system: `You write tight DTC ad copy for ${brand.name}. One or two sentences, ≤40 words, end with the CTA. Respond as JSON: {"copy": "<the ad copy>"}.`,
            user: `Angle: ${brief.angle}. Persona: ${brief.persona}. Hook: "${brief.hook}". Core message: ${brief.coreMessage}. CTA: ${brief.cta}.`,
            maxTokens: 160,
          });
          if (typeof r.copy !== 'string' || r.copy.trim() === '') throw new Error('bad copy shape');
          anyLiveCopy = true;
          return r.copy.trim();
        } catch {
          return mockCopy(brief);
        }
      }),
    ),
  );

  // -- images --
  const productImagePath = store.productImagePathFor(opts.brandId);
  const requests: ImageRequest[] = briefs.map((brief, i) => ({
    brief,
    creativeId: `${runId}-c${i + 1}`,
    brandId: opts.brandId,
    brandName: brand.name,
    productImagePath,
    variant: i,
  }));
  const images = await generateAll(requests, {
    live: getLiveImageGen(),
    svg: new SvgImageGen(),
  });

  // -- creatives --
  const creatives: Creative[] = briefs.map((brief, i) => ({
    id: `${runId}-c${i + 1}`,
    briefId: brief.id,
    brandId: opts.brandId,
    imageUrl: images[i].url,
    copy: copies[i],
    genome: {
      angle: brief.angle,
      persona: brief.persona,
      hook: brief.hook,
      style: brief.style,
      generation: brief.generation,
    },
    status: 'live',
    publishedAdId: `ad-${runId}-c${i + 1}`,
    arm: { alpha: 1, beta: 1, pulls: 0 },
  }));

  store.appendBriefs(opts.brandId, briefs);
  store.appendCreatives(opts.brandId, creatives);

  // -- panel --
  const { scores } = await scorePanel({
    creatives,
    personaFacts: facts.filter((f) => f.section === 'persona'),
    brandName: brand.name,
  });
  store.appendPanelScores(opts.brandId, scores);

  const imageModes = new Set(images.map((r) => r.mode));
  return {
    creatives,
    briefs,
    panelScores: scores,
    mode: {
      copy: anyLiveCopy ? 'live' : 'mock',
      image: imageModes.size > 1 ? 'mixed' : (images[0]?.mode ?? 'svg'),
    },
  };
}
