// Wilson score intervals + generation-vs-generation significance verdicts.
// Pure math, no randomness.

import type { DailyMetrics } from '../contracts';

export type Interval = { low: number; high: number };

export function wilsonInterval(successes: number, n: number, z = 1.96): Interval {
  if (n <= 0) return { low: 0, high: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    low: Math.max(0, (center - half) / denom),
    high: Math.min(1, (center + half) / denom),
  };
}

export type GenerationVerdict = 'gen2_wins' | 'gen1_wins' | 'not_significant' | 'insufficient_sample';

export type GenerationComparison = {
  verdict: GenerationVerdict;
  gen1Ctr: number;
  gen2Ctr: number;
  ci1: Interval;
  ci2: Interval;
};

const MIN_IMPRESSIONS_PER_SIDE = 500;

export function compareGenerations(gen1: DailyMetrics[], gen2: DailyMetrics[]): GenerationComparison {
  const sum = (rows: DailyMetrics[]) =>
    rows.reduce(
      (acc, m) => ({ impressions: acc.impressions + m.impressions, clicks: acc.clicks + m.clicks }),
      { impressions: 0, clicks: 0 },
    );
  const s1 = sum(gen1);
  const s2 = sum(gen2);
  const gen1Ctr = s1.impressions > 0 ? s1.clicks / s1.impressions : 0;
  const gen2Ctr = s2.impressions > 0 ? s2.clicks / s2.impressions : 0;
  const ci1 = wilsonInterval(s1.clicks, s1.impressions);
  const ci2 = wilsonInterval(s2.clicks, s2.impressions);

  let verdict: GenerationVerdict;
  if (s1.impressions < MIN_IMPRESSIONS_PER_SIDE || s2.impressions < MIN_IMPRESSIONS_PER_SIDE) {
    verdict = 'insufficient_sample';
  } else if (ci2.low > ci1.high) {
    verdict = 'gen2_wins';
  } else if (ci1.low > ci2.high) {
    verdict = 'gen1_wins';
  } else {
    verdict = 'not_significant';
  }
  return { verdict, gen1Ctr, gen2Ctr, ci1, ci2 };
}
