// Beta posteriors over CTR — per creative arm and per genome dimension value.
// Pure math, no randomness.

import type { Creative, DailyMetrics, DimensionPosterior } from '../contracts';
import type { RollupRow } from '../sim';

export type ArmPosterior = { alpha: number; beta: number; pulls: number };

/**
 * Beta posterior per creative, keyed by publishedAdId (the sim's metrics key):
 * alpha = 1 + Σclicks, beta = 1 + Σimpressions − Σclicks, pulls = days seen.
 * Creatives with no metrics keep the uniform prior {1, 1, 0}.
 */
export function creativePosteriors(
  metrics: DailyMetrics[],
  creatives: Creative[],
): Map<string, ArmPosterior> {
  const out = new Map<string, ArmPosterior>();
  for (const c of creatives) out.set(c.publishedAdId, { alpha: 1, beta: 1, pulls: 0 });
  for (const m of metrics) {
    const arm = out.get(m.adId);
    if (!arm) continue;
    arm.alpha += m.clicks;
    arm.beta += m.impressions - m.clicks;
    arm.pulls += 1;
  }
  return out;
}

/** Same Beta construction per dimension value, from the sim's rollup rows. */
export function dimensionPosteriors(rows: RollupRow[]): DimensionPosterior[] {
  return rows.map((r) => ({
    dimension: r.dimension,
    value: r.value,
    alpha: 1 + r.clicks,
    beta: 1 + r.impressions - r.clicks,
    spend: r.spend,
    impressions: r.impressions,
  }));
}

// Lanczos approximation (g = 7, n = 9) — enough precision for chart normalization.
const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * n interior points of the Beta(alpha, beta) pdf, y max-normalized to peak 1 so
 * the UI can overlay several posterior curves on one axis.
 */
export function betaPdfPoints(alpha: number, beta: number, n = 50): { x: number; y: number }[] {
  const logNorm = logGamma(alpha + beta) - logGamma(alpha) - logGamma(beta);
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n; // strictly inside (0,1): pdf endpoints can be singular
    const y = Math.exp(logNorm + (alpha - 1) * Math.log(x) + (beta - 1) * Math.log(1 - x));
    points.push({ x, y });
  }
  let peak = 0;
  for (const p of points) if (p.y > peak) peak = p.y;
  if (peak > 0) for (const p of points) p.y /= peak;
  return points;
}
