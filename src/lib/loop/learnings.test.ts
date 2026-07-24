import { describe, expect, it } from 'vitest';
import type { DimensionPosterior, Learning } from '../contracts';
import type { RollupRow } from '../sim';
import { gen1Creatives } from '@/fixtures/creatives';
import { extractLearnings, retirementDecisions } from './learnings';
import type { ArmPosterior } from './posteriors';

// alpha/beta constructed exactly as dimensionPosteriors does: 1+clicks, 1+imp−clicks.
const dim = (
  dimension: DimensionPosterior['dimension'],
  value: string,
  impressions: number,
  clicks: number,
  spend: number,
): DimensionPosterior => ({
  dimension,
  value,
  alpha: 1 + clicks,
  beta: 1 + impressions - clicks,
  spend,
  impressions,
});

const rollupRow = (
  d: DimensionPosterior,
  purchases: number,
  purchaseValue: number,
): RollupRow => ({
  dimension: d.dimension,
  value: d.value,
  impressions: d.impressions,
  clicks: d.alpha - 1,
  purchases,
  spend: d.spend,
  purchaseValue,
  ctr: d.impressions > 0 ? (d.alpha - 1) / d.impressions : 0,
  cvr: 0,
});

const winnerAngle = gen1Creatives[0].genome.angle; // 'nostalgia-reboot', verbatim source

describe('extractLearnings floors', () => {
  it('400 impressions never produces a Learning regardless of CTR', () => {
    const dims = [
      dim('angle', 'hot-but-tiny', 400, 200, 100), // 50% CTR, under impression floor
      dim('angle', 'big-and-cold', 5000, 50, 37.5),
    ];
    expect(extractLearnings(dims, dims.map((d) => rollupRow(d, 0, 0)))).toEqual([]);
  });

  it('spend under $20 never produces a Learning', () => {
    const dims = [
      dim('angle', winnerAngle, 5000, 250, 10), // clear winner but only $10 spend
      dim('angle', 'zero-sugar-flex', 5000, 50, 37.5),
    ];
    expect(extractLearnings(dims, dims.map((d) => rollupRow(d, 0, 0)))).toEqual([]);
  });

  it('overlapping intervals produce no Learning', () => {
    const dims = [
      dim('angle', 'slightly-better', 5000, 250, 37.5),
      dim('angle', 'slightly-worse', 5000, 240, 37.5),
    ];
    expect(extractLearnings(dims, dims.map((d) => rollupRow(d, 0, 0)))).toEqual([]);
  });
});

describe('extractLearnings firing', () => {
  const dims = [
    dim('angle', winnerAngle, 5000, 250, 37.5), // 5% CTR
    dim('angle', 'zero-sugar-flex', 5000, 50, 37.5), // 1% CTR
  ];

  it('clear winner fires with verbatim value and sane stats', () => {
    const learnings = extractLearnings(dims, dims.map((d) => rollupRow(d, 0, 0)), {
      brandId: 'brand-magic-spoon',
    });
    expect(learnings).toHaveLength(1);
    const l = learnings[0];
    expect(l.stats.value).toBe(gen1Creatives[0].genome.angle); // verbatim equality
    expect(l.stats.dimension).toBe('angle');
    expect(l.stats.n).toBe(5000);
    expect(l.stats.lift).toBeCloseTo(5, 1); // 5% vs 1%
    expect(l.stats.ciLow).toBeGreaterThan(0.04);
    expect(l.stats.ciHigh).toBeLessThan(0.06);
    expect(l.brandId).toBe('brand-magic-spoon');
    expect(l.sensoIngested).toBe(false);
    expect(l.statement).toContain(`angle '${winnerAngle}' outperforms`);
    expect(l.statement).not.toContain('ROAS'); // no purchase data
  });

  it('includes ROAS in the statement when purchase data is non-zero', () => {
    const rows = [rollupRow(dims[0], 20, 780), rollupRow(dims[1], 2, 78)];
    const [l] = extractLearnings(dims, rows);
    expect(l.statement).toContain('ROAS 20.80'); // 780 / 37.5
  });
});

describe('retirementDecisions', () => {
  const posteriors = (entries: [string, ArmPosterior][]) => new Map(entries);
  const fakeLearning = { id: 'l1', brandId: 'b', statement: 's', sensoIngested: false, stats: { dimension: 'angle', value: 'v', lift: 2, n: 1000, ciLow: 0.1, ciHigh: 0.2 } } satisfies Learning;

  it('a clearly dominated arm with enough evidence retires', () => {
    const { retire, triggerRegeneration } = retirementDecisions(
      posteriors([
        ['ad-best', { alpha: 30, beta: 970, pulls: 10 }], // ~3% CTR
        ['ad-dud', { alpha: 5, beta: 995, pulls: 10 }], // ~0.5% CTR, n=998
      ]),
      { learnings: [fakeLearning] },
    );
    expect(retire).toEqual(['ad-dud']);
    expect(triggerRegeneration).toBe(true);
  });

  it('near-tied arms do not retire', () => {
    const { retire, triggerRegeneration } = retirementDecisions(
      posteriors([
        ['ad-a', { alpha: 30, beta: 970, pulls: 10 }],
        ['ad-b', { alpha: 28, beta: 972, pulls: 10 }],
      ]),
      { learnings: [fakeLearning] },
    );
    expect(retire).toEqual([]);
    expect(triggerRegeneration).toBe(false);
  });

  it('a dominated arm under the impression floor is spared', () => {
    const { retire } = retirementDecisions(
      posteriors([
        ['ad-best', { alpha: 30, beta: 970, pulls: 10 }],
        ['ad-young', { alpha: 1, beta: 400, pulls: 2 }], // dominated but only 399 impressions
      ]),
    );
    expect(retire).toEqual([]);
  });

  it('no learnings → no regeneration even when an arm retires', () => {
    const { retire, triggerRegeneration } = retirementDecisions(
      posteriors([
        ['ad-best', { alpha: 30, beta: 970, pulls: 10 }],
        ['ad-dud', { alpha: 5, beta: 995, pulls: 10 }],
      ]),
    );
    expect(retire).toEqual(['ad-dud']);
    expect(triggerRegeneration).toBe(false);
  });
});
