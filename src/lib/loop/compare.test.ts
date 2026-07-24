import { describe, expect, it } from 'vitest';
import { defaultMarketConfig } from '../sim';
import { gen1Creatives } from '@/fixtures/creatives';
import { panelScores } from '@/fixtures/panel-scores';
import { runComparison } from './compare';

const DAYS = 20;
const SEED = 42;

describe('runComparison determinism', () => {
  it('same seed → deep-equal output, fixtures never mutated', () => {
    const a = runComparison(defaultMarketConfig, gen1Creatives, panelScores, DAYS, SEED);
    const b = runComparison(defaultMarketConfig, gen1Creatives, panelScores, DAYS, SEED);
    expect(a).toEqual(b);
    for (const c of gen1Creatives) {
      expect(c.arm).toEqual({ alpha: 1, beta: 1, pulls: 0 }); // clones only, per leg
      expect(c.status).toBe('live');
    }
  });
});

describe('Thompson beats uniform on the planted-winner market', () => {
  const result = runComparison(defaultMarketConfig, gen1Creatives, panelScores, DAYS, SEED);

  it('after 20 days Thompson has strictly more cumulative clicks', () => {
    const last = result.byDay[DAYS - 1];
    expect(result.byDay).toHaveLength(DAYS);
    expect(last.thompsonCumClicks).toBeGreaterThan(last.uniformCumClicks);
    expect(last.rewardDelta).toBe(last.thompsonCumClicks - last.uniformCumClicks);
  });

  it('the planted-winner angle gets the largest impression share in the final 5 days', () => {
    const impressionsByAd = new Map<string, number>();
    for (const m of result.thompson) {
      if (m.day > DAYS - 5) {
        impressionsByAd.set(m.adId, (impressionsByAd.get(m.adId) ?? 0) + m.impressions);
      }
    }
    const [topAdId] = [...impressionsByAd.entries()].reduce((a, b) => (b[1] > a[1] ? b : a));
    const topCreative = gen1Creatives.find((c) => c.publishedAdId === topAdId)!;
    expect(topCreative.genome.angle).toBe('nostalgia-reboot');
  });

  it('oracle regret is present, non-negative, and oracle dominates both strategies', () => {
    const last = result.byDay[DAYS - 1];
    expect(last.regret).toBeGreaterThanOrEqual(0);
    expect(last.oracleCumClicks).toBeGreaterThan(last.thompsonCumClicks);
    expect(last.oracleCumClicks).toBeGreaterThan(last.uniformCumClicks);
    for (let i = 1; i < result.byDay.length; i++) {
      expect(result.byDay[i].oracleCumClicks).toBeGreaterThanOrEqual(
        result.byDay[i - 1].oracleCumClicks,
      );
    }
  });
});
