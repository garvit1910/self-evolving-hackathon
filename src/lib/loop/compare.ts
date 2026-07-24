// Uniform vs Thompson comparison on identical market seeds — the data source
// for the demo's "bandit beats uniform" chart, plus fatigue-aware oracle regret.

import type { Creative, DailyMetrics, PanelScore } from '../contracts';
import {
  type MarketConfig,
  type SimState,
  mulberry32,
  runDay,
  runSim,
  trueRates,
} from '../sim';
import { creativePosteriors } from './posteriors';
import { makeThompsonAllocator } from './thompson';

/** One mixing round to derive a decorrelated-but-reproducible allocator seed. */
function splitmix32(seed: number): number {
  let z = (seed + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}

export type ComparisonDay = {
  day: number;
  uniformCumClicks: number;
  thompsonCumClicks: number;
  rewardDelta: number;
  /** Expected clicks had every impression gone to the true-CTR-best arm. */
  oracleCumClicks: number;
  regret: number;
};

export type ComparisonResult = {
  uniform: DailyMetrics[];
  thompson: DailyMetrics[];
  byDay: ComparisonDay[];
};

/**
 * Runs the market twice on the SAME seed: once via runSim (uniform allocator),
 * once day-by-day via runDay with a Thompson allocator whose RNG derives from
 * the same seed through splitmix32. Between Thompson days, creative arms are
 * refreshed from that run's accumulated metrics so the bandit adapts.
 * Input creatives are cloned per leg — caller/fixture objects never mutate.
 */
export function runComparison(
  simConfig: MarketConfig,
  creatives: Creative[],
  panelScores: PanelScore[],
  days: number,
  seed: number,
): ComparisonResult {
  const uniformCreatives = structuredClone(creatives);
  const { metrics: uniform } = runSim(simConfig, uniformCreatives, panelScores, days, seed);

  const thompsonCreatives = structuredClone(creatives);
  const allocator = makeThompsonAllocator(mulberry32(splitmix32(seed)));
  const state: SimState = {
    day: 0,
    rand: mulberry32(seed),
    dailyBudget: simConfig.dailyImpressions,
    cumImpressions: {},
  };
  const thompson: DailyMetrics[] = [];
  for (let d = 0; d < days; d++) {
    thompson.push(...runDay(state, simConfig, thompsonCreatives, panelScores, allocator));
    const posteriors = creativePosteriors(thompson, thompsonCreatives);
    for (const c of thompsonCreatives) {
      const p = posteriors.get(c.publishedAdId);
      if (p) c.arm = p;
    }
  }

  // Oracle: deterministic expected-value baseline. Each day the full budget
  // goes to the arm with the highest true CTR given the oracle path's own
  // cumulative impressions (so fatigue applies to the oracle too).
  const live = creatives.filter((c) => c.status === 'live');
  const oracleCum: number[] = [];
  const oracleImpressions: Record<string, number> = {};
  let oracleClicks = 0;
  for (let d = 0; d < days; d++) {
    let bestCtr = 0;
    let bestAdId = '';
    for (const c of live) {
      const { ctr } = trueRates(c, simConfig, panelScores, oracleImpressions[c.publishedAdId] ?? 0);
      if (ctr > bestCtr) {
        bestCtr = ctr;
        bestAdId = c.publishedAdId;
      }
    }
    if (bestAdId) {
      oracleClicks += simConfig.dailyImpressions * bestCtr;
      oracleImpressions[bestAdId] =
        (oracleImpressions[bestAdId] ?? 0) + simConfig.dailyImpressions;
    }
    oracleCum.push(oracleClicks);
  }

  const clicksOn = (rows: DailyMetrics[], day: number) =>
    rows.reduce((sum, m) => (m.day === day ? sum + m.clicks : sum), 0);
  const byDay: ComparisonDay[] = [];
  let uniformCumClicks = 0;
  let thompsonCumClicks = 0;
  for (let day = 1; day <= days; day++) {
    uniformCumClicks += clicksOn(uniform, day);
    thompsonCumClicks += clicksOn(thompson, day);
    byDay.push({
      day,
      uniformCumClicks,
      thompsonCumClicks,
      rewardDelta: thompsonCumClicks - uniformCumClicks,
      oracleCumClicks: oracleCum[day - 1],
      regret: oracleCum[day - 1] - thompsonCumClicks,
    });
  }
  return { uniform, thompson, byDay };
}
