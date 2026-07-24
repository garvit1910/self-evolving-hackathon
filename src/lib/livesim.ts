import type { Creative, DailyMetrics, Learning, PanelScore } from './contracts';
import type { Priors } from './creative/compose';
import {
  compareGenerations,
  creativePosteriors,
  dimensionPosteriors,
  extractLearnings,
  makeThompsonAllocator,
  retirementDecisions,
  samplePriors,
  type GenerationComparison,
  type LearningOpts,
  type RetirementOpts,
  type ThompsonOpts,
} from './loop';
import {
  mulberry32,
  rollup,
  runDay,
  uniformAllocator,
  type Allocator,
  type MarketConfig,
  type SimState,
} from './sim';

// Live market mode: a pure state machine wiring sim.ts to the loop/ math.
// Each day: runDay → refresh Thompson arms from creativePosteriors (the
// runComparison pattern) → rollup → extractLearnings → retirementDecisions →
// (once gen-2 joins) compareGenerations. Deterministic per seed + action
// script. No fs, no React — runs client-side and in node tests alike.

// Demo pacing defaults (seed 42, fixture brand): learning fires day 14,
// regeneration triggers day 14, gen-2 verdict lands day 15, retirements spread
// days 7–23. Tuned via caller-side opts only — the library defaults inside
// loop/ are pinned by its tests and stay untouched.
export const DEMO_LEARNING_OPTS = { minImpressions: 80_000, minSpend: 500 };
export const DEMO_RETIREMENT_OPTS = { minImpressions: 15_000 };

/** Same one-round mixer compare.ts uses (private there; loop/ is frozen). */
function splitmix32(seed: number): number {
  let z = (seed + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}

export type LiveSimEvent =
  | { type: 'day'; day: number }
  | { type: 'learning'; day: number; learning: Learning }
  | { type: 'retire'; day: number; adIds: string[] }
  | { type: 'trigger_regeneration'; day: number; priors: Priors }
  | { type: 'generation_joined'; day: number; creativeIds: string[]; generation: 1 | 2 }
  | { type: 'verdict'; day: number; comparison: GenerationComparison };

export type LiveSimSnapshot = {
  day: number;
  creatives: Creative[];
  panelScores: PanelScore[];
  metrics: DailyMetrics[];
  learnings: Learning[];
  retiredAdIds: string[];
  events: LiveSimEvent[];
  regenerationTriggered: boolean;
  priors: Priors | null;
  comparison: GenerationComparison | null;
  verdictFired: boolean;
};

export type LiveSim = {
  stepDay(): { dayMetrics: DailyMetrics[]; events: LiveSimEvent[] };
  /** Gen-2 arms join mid-flight with fresh uniform priors, always live. */
  addCreatives(creatives: Creative[], panelScores: PanelScore[]): void;
  getState(): LiveSimSnapshot;
};

export type LiveSimOpts = {
  config: MarketConfig;
  creatives: Creative[];
  panelScores: PanelScore[];
  seed: number;
  allocator: 'uniform' | 'thompson';
  thompsonOpts?: ThompsonOpts;
  /** Demo pacing knobs — library defaults are pinned by the loop/ tests. */
  learningOpts?: Pick<LearningOpts, 'minSpend' | 'minImpressions'>;
  retirementOpts?: Pick<RetirementOpts, 'minImpressions'>;
};

export function createLiveSim(opts: LiveSimOpts): LiveSim {
  const creatives = structuredClone(opts.creatives);
  const panelScores = [...opts.panelScores];
  const brandId = creatives[0]?.brandId ?? '';
  const allocatorFn: Allocator =
    opts.allocator === 'thompson'
      ? makeThompsonAllocator(mulberry32(splitmix32(opts.seed)), opts.thompsonOpts)
      : uniformAllocator;
  const priorsRand = mulberry32(splitmix32(opts.seed ^ 0x1234abcd));
  const state: SimState = {
    day: 0,
    rand: mulberry32(opts.seed),
    dailyBudget: opts.config.dailyImpressions,
    cumImpressions: {},
  };

  const metrics: DailyMetrics[] = [];
  const events: LiveSimEvent[] = [];
  const learnings: Learning[] = [];
  const emittedLearningIds = new Set<string>();
  let regenerationTriggered = false;
  let priors: Priors | null = null;
  let comparison: GenerationComparison | null = null;
  let verdictFired = false;

  const stepDay = (): { dayMetrics: DailyMetrics[]; events: LiveSimEvent[] } => {
    const stepEvents: LiveSimEvent[] = [];
    const dayMetrics = runDay(state, opts.config, creatives, panelScores, allocatorFn);
    metrics.push(...dayMetrics);

    if (opts.allocator === 'thompson') {
      const posteriors = creativePosteriors(metrics, creatives);
      for (const c of creatives) {
        const p = posteriors.get(c.publishedAdId);
        if (p) c.arm = p;
      }
    }

    const rows = rollup(metrics, creatives);
    const dims = dimensionPosteriors(rows);
    for (const learning of extractLearnings(dims, rows, { brandId, ...opts.learningOpts })) {
      if (emittedLearningIds.has(learning.id)) continue;
      emittedLearningIds.add(learning.id);
      learnings.push(learning);
      stepEvents.push({ type: 'learning', day: state.day, learning });
    }

    const decision = retirementDecisions(creativePosteriors(metrics, creatives), {
      learnings,
      ...opts.retirementOpts,
    });
    const newlyRetired: string[] = [];
    for (const adId of decision.retire) {
      const creative = creatives.find((c) => c.publishedAdId === adId);
      if (creative && creative.status === 'live') {
        creative.status = 'retired';
        newlyRetired.push(adId);
      }
    }
    if (newlyRetired.length > 0) {
      stepEvents.push({ type: 'retire', day: state.day, adIds: newlyRetired });
    }
    if (decision.triggerRegeneration && !regenerationTriggered) {
      regenerationTriggered = true;
      priors = samplePriors(dims, priorsRand);
      stepEvents.push({ type: 'trigger_regeneration', day: state.day, priors });
    }

    if (!verdictFired && creatives.some((c) => c.genome.generation === 2)) {
      const generationOf = new Map(creatives.map((c) => [c.publishedAdId, c.genome.generation]));
      comparison = compareGenerations(
        metrics.filter((m) => generationOf.get(m.adId) === 1),
        metrics.filter((m) => generationOf.get(m.adId) === 2),
      );
      if (comparison.verdict === 'gen2_wins' || comparison.verdict === 'gen1_wins') {
        verdictFired = true;
        stepEvents.push({ type: 'verdict', day: state.day, comparison });
      }
    }

    stepEvents.push({ type: 'day', day: state.day });
    events.push(...stepEvents);
    return { dayMetrics, events: stepEvents };
  };

  const addCreatives = (newCreatives: Creative[], newScores: PanelScore[]): void => {
    const joined = structuredClone(newCreatives).map((c) => ({
      ...c,
      status: 'live' as const,
      arm: { alpha: 1, beta: 1, pulls: 0 },
    }));
    creatives.push(...joined);
    panelScores.push(...newScores);
    events.push({
      type: 'generation_joined',
      day: state.day,
      creativeIds: joined.map((c) => c.id),
      generation: joined[0]?.genome.generation ?? 2,
    });
  };

  const getState = (): LiveSimSnapshot => ({
    day: state.day,
    creatives: structuredClone(creatives),
    panelScores: [...panelScores],
    metrics: [...metrics],
    learnings: structuredClone(learnings),
    retiredAdIds: creatives.filter((c) => c.status === 'retired').map((c) => c.publishedAdId),
    events: structuredClone(events),
    regenerationTriggered,
    priors,
    comparison,
    verdictFired,
  });

  return { stepDay, addCreatives, getState };
}
