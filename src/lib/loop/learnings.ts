// Turns dimension posteriors into writeback-ready Learnings, and decides which
// creative arms to retire. Pure math, no randomness.

import type { DimensionPosterior, Learning } from '../contracts';
import type { RollupRow } from '../sim';
import type { ArmPosterior } from './posteriors';
import { wilsonInterval } from './wilson';

export type LearningOpts = {
  /** Learning.brandId is required by the contract; caller supplies it. */
  brandId?: string;
  minSpend?: number;
  minImpressions?: number;
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * A dimension value earns a Learning when it clears the spend/impression floors
 * AND its Wilson CTR interval sits entirely above the pooled interval of the
 * rest of its dimension. `metricsByDimension` is sim.ts's rollup output — it
 * supplies the purchase data for the ROAS clause.
 */
export function extractLearnings(
  dims: DimensionPosterior[],
  metricsByDimension: RollupRow[],
  opts: LearningOpts = {},
): Learning[] {
  const minSpend = opts.minSpend ?? 20;
  const minImpressions = opts.minImpressions ?? 500;
  const brandId = opts.brandId ?? '';
  const learnings: Learning[] = [];

  for (const d of dims) {
    if (d.spend < minSpend || d.impressions < minImpressions) continue;
    const siblings = dims.filter((s) => s.dimension === d.dimension && s.value !== d.value);
    if (siblings.length === 0) continue;
    const clicks = d.alpha - 1;
    const restClicks = siblings.reduce((sum, s) => sum + (s.alpha - 1), 0);
    const restImpressions = siblings.reduce((sum, s) => sum + s.impressions, 0);
    if (restImpressions === 0) continue;

    const ci = wilsonInterval(clicks, d.impressions);
    const restCi = wilsonInterval(restClicks, restImpressions);
    if (ci.low <= restCi.high) continue;

    const ctr = clicks / d.impressions;
    // Continuity correction keeps lift finite if the rest scored zero clicks.
    const restCtr = Math.max(restClicks, 0.5) / restImpressions;
    const lift = ctr / restCtr;

    let statement =
      `${d.dimension} '${d.value}' outperforms: ${lift.toFixed(2)}× CTR ` +
      `(n=${d.impressions} impressions, 95% CI [${ci.low.toFixed(4)},${ci.high.toFixed(4)}])`;
    const row = metricsByDimension.find(
      (r) => r.dimension === d.dimension && r.value === d.value,
    );
    if (row && row.purchases > 0 && row.spend > 0) {
      statement += `; ROAS ${(row.purchaseValue / row.spend).toFixed(2)}`;
    }

    learnings.push({
      id: `learning-${d.dimension}-${slugify(d.value)}`,
      brandId,
      statement,
      stats: {
        dimension: d.dimension,
        value: d.value, // verbatim attribution key
        lift,
        n: d.impressions,
        ciLow: ci.low,
        ciHigh: ci.high,
      },
      sensoIngested: false, // Track A flips this after writeback
    });
  }
  return learnings;
}

export type RetirementOpts = {
  /** Existing learnings — regeneration only triggers once something was learned. */
  learnings?: Learning[];
  minImpressions?: number;
};

/**
 * Retires arms whose posterior mean + 2σ falls below the best arm's mean − 2σ
 * (clearly dominated) once they have ≥ minImpressions of evidence.
 */
export function retirementDecisions(
  posteriors: Map<string, ArmPosterior>,
  opts: RetirementOpts = {},
): { retire: string[]; triggerRegeneration: boolean } {
  const minImpressions = opts.minImpressions ?? 500;
  const learnings = opts.learnings ?? [];
  const arms = [...posteriors.entries()].map(([adId, a]) => {
    const total = a.alpha + a.beta;
    return {
      adId,
      mean: a.alpha / total,
      sd: Math.sqrt((a.alpha * a.beta) / (total * total * (total + 1))),
      impressions: total - 2, // alpha + beta = 2 + impressions by construction
    };
  });
  if (arms.length === 0) return { retire: [], triggerRegeneration: false };

  const best = arms.reduce((top, a) => (a.mean > top.mean ? a : top));
  const retire = arms
    .filter(
      (a) =>
        a.adId !== best.adId &&
        a.impressions >= minImpressions &&
        a.mean + 2 * a.sd < best.mean - 2 * best.sd,
    )
    .map((a) => a.adId);

  return { retire, triggerRegeneration: learnings.length > 0 && retire.length > 0 };
}
