/**
 * Creative engine orchestrator — Brief → N genome-stamped, copy-written,
 * image-rendered, compliance-screened Creatives, coordinating in a Band room
 * (brand-creative:{brandId}) that the UI mirrors.
 *
 * Ordering is deliberate: copy is screened BEFORE images, so no Gemini quota is
 * spent on a creative that is about to be dropped.
 *
 * Governance gates publish. If drops leave too few survivors the run is denied
 * rather than shipping a threadbare set — a second OBSERVABLE block, mirroring
 * the research swarm's low-confidence veto. (Guild was cut in 22e7f66; this is
 * the client-side governance mock, which is now its permanent form.)
 */

import type { Brand, Brief, Creative, Genome, Persona, Prior } from '@/lib/contracts';
import type { Adapters } from '../adapters';
import type { CreativeStore } from '../store/creativeStore';
import { expandGenomes } from '../brief/expandGenomes';
import { distillBannedTerms } from '../creative/bannedTerms';
import { screenCreatives, type Violation } from '../creative/complianceGate';
import { writeCopy, repairCopy } from './copywriter';
import { renderImages } from './imagesmith';

/** Below this many survivors the set is too thin to be worth publishing. */
const MIN_SURVIVORS = 4;

/** Renders images for the surviving genomes; index-aligned with `genomes`.
 *  `mode` feeds GenerateResult.mode.image ('mock' for placeholders). */
export type RenderImagesFn = (
  genomes: Genome[],
  ids: string[],
) => Promise<{ url: string; mode: 'gemini' | 'openai' | 'svg' | 'mock' }[]>;

/** Caller-tunable seams so the app route and the standalone scripts share this
 *  orchestrator (UNIFIED at merge — see docs/WIRING.md). Defaults preserve the
 *  script behavior: imagesmith renderer, `sim-` ad ids, persist via store. */
export type EngineOptions = {
  render?: RenderImagesFn;
  publishedAdIdFor?: (creativeId: string) => string;
  persist?: boolean;
};

export type CreativeRunResult = {
  runId: string;
  room: string;
  brief: Brief;
  /**
   * Populated regardless of `governance.ok` — this array is NOT gated on the
   * governance decision below (only the persistence call `store.saveRun` is).
   * Consumers MUST check `governance.ok` before publishing/displaying these
   * creatives as live; a denied run still returns its (unpersisted)
   * creatives here so the caller can inspect why. `Creative.status` is
   * frozen to `'live' | 'retired'` (src/lib/contracts/index.ts) — do not
   * invent a third status to encode "denied"; the governance field is the
   * signal.
   */
  creatives: Creative[];
  dropped: Violation[];
  governance: { ok: boolean; reason?: string };
  /** Distinct image modes seen this run ('mock' when placeholders/mocks). */
  imageModes: ('gemini' | 'openai' | 'svg' | 'mock')[];
};

function roomFor(brandId: string): string {
  return `brand-creative:${brandId}`;
}

export async function runCreativeEngine(
  runId: string,
  brand: Brand,
  brief: Brief,
  personas: Persona[],
  adapters: Pick<Adapters, 'llm' | 'feed' | 'governance' | 'imageGen'>,
  store: CreativeStore,
  n = 8,
  priors: Prior[] = [],
  options: EngineOptions = {},
): Promise<CreativeRunResult> {
  const { llm, feed, governance, imageGen } = adapters;
  const room = roomFor(brand.id);
  const publishedAdIdFor = options.publishedAdIdFor ?? ((id: string) => `sim-${id}`);
  const persist = options.persist ?? true;

  await feed.join(room);
  await feed.post(room, {
    agent: 'creative',
    kind: 'thought',
    payload: { status: 'starting', briefId: brief.id, generation: brief.generation, n },
  });

  const bannedTerms = await distillBannedTerms(brief.compliance ?? [], brief.contextHash, llm);
  const genomes = expandGenomes(brief, personas, n, priors);

  await feed.post(room, {
    agent: 'creative',
    kind: 'tool_result',
    payload: { genomes: genomes.length, bannedTerms: bannedTerms.length },
  });

  // --- copy, screened before any image is generated ---------------------
  const copies = await writeCopy(brief, genomes, personas, bannedTerms, llm, feed, room);

  let violations = screenCreatives(copies, bannedTerms);
  if (violations.length > 0) {
    const repaired = await repairCopy(
      brief, genomes, personas, violations, bannedTerms, llm, feed, room,
    );
    for (const [index, copy] of repaired) copies[index] = copy;
    violations = screenCreatives(copies, bannedTerms);
  }

  const dropped = violations;
  const droppedIndices = new Set(dropped.map((v) => v.index));
  for (const v of dropped) {
    await feed.post(room, {
      agent: 'governance',
      kind: 'error',
      payload: { action: 'creative_drop', index: v.index, terms: v.terms, reason: 'prohibited claim survived repair' },
    });
  }

  const survivorGenomes: Genome[] = [];
  const survivorCopies: string[] = [];
  genomes.forEach((g, i) => {
    if (droppedIndices.has(i)) return;
    survivorGenomes.push(g);
    survivorCopies.push(copies[i]);
  });

  const ids = survivorGenomes.map((_, i) => `${runId}-c${i + 1}`);

  // --- images, only for survivors --------------------------------------
  const rendered = options.render
    ? await options.render(survivorGenomes, ids)
    : (
        await renderImages(brand, survivorGenomes, personas, ids, runId, imageGen, store, feed, room)
      ).map((url) => ({ url, mode: 'mock' as const }));

  const creatives: Creative[] = survivorGenomes.map((genome, i) => ({
    id: ids[i],
    briefId: brief.id,
    brandId: brand.id,
    imageUrl: rendered[i].url,
    copy: survivorCopies[i],
    genome,
    status: 'live',
    publishedAdId: publishedAdIdFor(ids[i]),
    arm: { alpha: 1, beta: 1, pulls: 0 },
  }));

  // --- governance gate -------------------------------------------------------
  let gov = await governance.approve('creative_publish', {
    generated: creatives.length,
    dropped: dropped.length,
    violations: dropped.reduce((s, v) => s + v.terms.length, 0),
  });
  if (gov.ok && creatives.length < MIN_SURVIVORS) {
    gov = { ok: false, reason: `only ${creatives.length} creatives survived screening (min ${MIN_SURVIVORS})` };
  }

  await feed.post(room, {
    agent: 'governance',
    kind: gov.ok ? 'tool_result' : 'error',
    payload: { action: 'creative_publish', ...gov },
  });

  if (gov.ok && persist) await store.saveRun(runId, creatives);

  await feed.post(room, {
    agent: 'creative',
    kind: 'thought',
    payload: { status: 'done', creatives: creatives.length, dropped: dropped.length, governanceOk: gov.ok },
  });

  return {
    runId,
    room,
    brief,
    creatives,
    dropped,
    governance: gov,
    imageModes: [...new Set(rendered.map((r) => r.mode))],
  };
}
