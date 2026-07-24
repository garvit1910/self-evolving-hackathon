/**
 * Full LIVE loop integrity check (Phase 4).
 *   npx tsx --env-file=.env.local scripts/liveloop-check.ts [brandId] [appBase]
 *
 * Drives the REAL HTTP routes on the running dev server plus the real livesim
 * machine (same code the browser runs): gen-1 via /generate (real images with
 * the uploaded product photo) → Thompson livesim → learning fires → /writeback
 * (Senso + hash flip) → sensoIngested via /learnings/:id/ingested → gen-2 via
 * /generate with the sampled priors (angle VERBATIM) → both gens ≥500
 * impressions → compareGenerations verdict.
 */
import type { Brief, ContextSnapshot, Creative, PanelScore } from '../src/lib/contracts';
import {
  DEMO_LEARNING_OPTS,
  DEMO_RETIREMENT_OPTS,
  createLiveSim,
  type LiveSimEvent,
} from '../src/lib/livesim';
import { marketConfigFor } from '../src/lib/market-config';

const [brandId = 'brand-magicspoon-com', appBaseArg] = process.argv.slice(2);
const BASE = (appBaseArg ?? 'http://localhost:3002').replace(/\/$/, '');

type GenerateResponse = {
  creatives: Creative[];
  briefs: Brief[];
  panelScores: PanelScore[];
  mode: { copy: string; image: string };
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

function fail(msg: string): never {
  console.error(`❌ LIVE LOOP FAILED: ${msg}`);
  process.exit(1);
}

async function main() {
  const t0 = Date.now();
  const ctxBefore = await get<ContextSnapshot>(`/api/brands/${brandId}/context`);
  console.log(`context before: v${ctxBefore.version} hash=${ctxBefore.hash} facts=${ctxBefore.facts.length}`);
  if (ctxBefore.facts.length === 0) fail('brand has no facts — run the swarm first');

  // --- gen-1 through the real engine ---------------------------------------
  let t = Date.now();
  const gen1 = await post<GenerateResponse>(`/api/brands/${brandId}/generate`, { generation: 1 });
  console.log(
    `gen-1: ${gen1.creatives.length} creatives, copy=${gen1.mode.copy}, image=${gen1.mode.image} (${Date.now() - t}ms)`,
  );
  if (gen1.creatives.length < 4) fail('gen-1 returned <4 creatives');
  if (gen1.mode.image === 'svg') console.warn('  ⚠ gen-1 images fell back to SVG — check image keys');
  for (const c of gen1.creatives) {
    if (!c.genome.angle || !c.genome.persona || !c.genome.hook || !c.genome.style) {
      fail(`creative ${c.id} has an empty genome axis`);
    }
  }

  // --- live market (Thompson, seed 42, demo pacing) -------------------------
  const sim = createLiveSim({
    config: marketConfigFor(brandId, gen1.creatives),
    creatives: gen1.creatives,
    panelScores: gen1.panelScores,
    seed: 42,
    allocator: 'thompson',
    learningOpts: DEMO_LEARNING_OPTS,
    retirementOpts: DEMO_RETIREMENT_OPTS,
  });

  let learningDay = 0;
  let triggerDay = 0;
  let gen2: GenerateResponse | null = null;
  let verdict: Extract<LiveSimEvent, { type: 'verdict' }> | null = null;
  let hashBefore = '';
  let hashAfter = '';
  let versionAfter = 0;

  for (let d = 1; d <= 40 && !verdict; d++) {
    const { dayMetrics, events } = sim.stepDay();
    await post(`/api/brands/${brandId}/metrics`, dayMetrics).catch(() => {});
    for (const e of events) {
      if (e.type === 'learning') {
        if (!learningDay) learningDay = e.day;
        await post(`/api/brands/${brandId}/learnings`, [e.learning]).catch(() => {});
        console.log(`day ${e.day}: learning — ${e.learning.statement.slice(0, 90)}`);
      }
      if (e.type === 'trigger_regeneration' && !triggerDay) {
        triggerDay = e.day;
        const before = await get<ContextSnapshot>(`/api/brands/${brandId}/context`);
        hashBefore = before.hash;
        t = Date.now();
        const wb = await post<{ version: number; hash: string; factIds: string[]; learningIds?: string[] }>(
          `/api/brands/${brandId}/writeback`,
          {},
        );
        for (const lid of wb.learningIds ?? []) {
          await post(`/api/learnings/${lid}/ingested`, { brandId }).catch(() => {});
        }
        hashAfter = wb.hash;
        versionAfter = wb.version;
        console.log(
          `day ${e.day}: writeback v${wb.version} hash ${hashBefore} → ${hashAfter} (+sensoIngested×${(wb.learningIds ?? []).length}) (${Date.now() - t}ms)`,
        );
        if (hashAfter === hashBefore) fail('writeback did not flip the context hash');

        t = Date.now();
        gen2 = await post<GenerateResponse>(`/api/brands/${brandId}/generate`, {
          generation: 2,
          priors: e.priors,
        });
        console.log(
          `day ${e.day}: gen-2 ${gen2.creatives.length} creatives, image=${gen2.mode.image}, prior angle "${e.priors.angle}" (${Date.now() - t}ms)`,
        );
        for (const c of gen2.creatives) {
          if (c.genome.angle !== e.priors.angle) {
            fail(`gen-2 creative ${c.id} angle "${c.genome.angle}" ≠ prior "${e.priors.angle}" (must be VERBATIM)`);
          }
          if (c.genome.generation !== 2) fail(`gen-2 creative ${c.id} not stamped generation 2`);
        }
        sim.addCreatives(gen2.creatives, gen2.panelScores);
      }
      if (e.type === 'verdict') verdict = e;
    }
  }

  // --- assertions -----------------------------------------------------------
  if (!learningDay) fail('no learning fired within 40 days');
  if (!triggerDay || !gen2) fail('regeneration never triggered');
  if (!verdict) fail('no verdict within 40 days');

  const metrics = sim.getState().metrics;
  const gen1Ids = new Set(gen1.creatives.map((c) => c.publishedAdId));
  const gen2Ids = new Set(gen2.creatives.map((c) => c.publishedAdId));
  const imps = (ids: Set<string>) =>
    metrics.filter((m) => ids.has(m.adId)).reduce((s, m) => s + m.impressions, 0);
  const g1Imps = imps(gen1Ids);
  const g2Imps = imps(gen2Ids);
  if (g1Imps < 500 || g2Imps < 500) fail(`impressions too low: gen1=${g1Imps} gen2=${g2Imps} (need ≥500 each)`);

  const ctxAfter = await get<ContextSnapshot>(`/api/brands/${brandId}/context`);
  const plFacts = ctxAfter.facts.filter((f) => f.origin === 'performance_loop').length;

  console.log('---');
  console.log(
    `✅ LIVE LOOP OK — learning day ${learningDay}, writeback v${versionAfter} (hash flip ✓, ${plFacts} performance_loop facts), ` +
      `gen-2 day ${triggerDay} (angle verbatim ✓), verdict day ${verdict.day}: ${verdict.comparison.verdict} ` +
      `(gen1 CTR ${(verdict.comparison.gen1Ctr * 100).toFixed(2)}% vs gen2 ${(verdict.comparison.gen2Ctr * 100).toFixed(2)}%), ` +
      `imps gen1=${g1Imps} gen2=${g2Imps}, total ${Math.round((Date.now() - t0) / 1000)}s`,
  );
}

main().catch((e) => fail((e as Error).message));
