import { describe, expect, it } from 'vitest';
import type { Creative, DailyMetrics } from '../contracts';
import type { RollupRow } from '../sim';
import { betaPdfPoints, creativePosteriors, dimensionPosteriors } from './posteriors';

const makeCreative = (n: number): Creative => ({
  id: `cr-t-${n}`,
  briefId: `brief-t-${n}`,
  brandId: 'brand-test',
  imageUrl: '',
  copy: '',
  genome: { angle: `angle-${n}`, persona: `p-${n}`, hook: `h-${n}`, style: `s-${n}`, generation: 1 },
  status: 'live',
  publishedAdId: `ad-t-${n}`,
  arm: { alpha: 1, beta: 1, pulls: 0 },
});

const row = (adId: string, day: number, impressions: number, clicks: number): DailyMetrics => ({
  adId,
  day,
  impressions,
  clicks,
  purchases: 0,
  spend: 0,
  purchaseValue: 0,
});

describe('creativePosteriors', () => {
  it('alpha = 1+Σclicks, beta = 1+Σimpressions−Σclicks, pulls = days seen', () => {
    const creatives = [makeCreative(1), makeCreative(2)];
    const metrics = [
      row('ad-t-1', 1, 1000, 30),
      row('ad-t-1', 2, 1000, 20),
      row('ad-t-1', 3, 500, 10),
      row('ad-t-2', 1, 1000, 5),
    ];
    const posts = creativePosteriors(metrics, creatives);
    expect(posts.get('ad-t-1')).toEqual({ alpha: 61, beta: 2441, pulls: 3 });
    expect(posts.get('ad-t-2')).toEqual({ alpha: 6, beta: 996, pulls: 1 });
  });

  it('creatives with no metrics keep the uniform prior', () => {
    const posts = creativePosteriors([], [makeCreative(9)]);
    expect(posts.get('ad-t-9')).toEqual({ alpha: 1, beta: 1, pulls: 0 });
  });
});

describe('dimensionPosteriors', () => {
  it('maps rollup rows to Beta posteriors carrying spend + impressions', () => {
    const rows: RollupRow[] = [
      {
        dimension: 'angle',
        value: 'nostalgia-reboot',
        impressions: 4000,
        clicks: 120,
        purchases: 6,
        spend: 30,
        purchaseValue: 234,
        ctr: 0.03,
        cvr: 0.05,
      },
    ];
    expect(dimensionPosteriors(rows)).toEqual([
      {
        dimension: 'angle',
        value: 'nostalgia-reboot',
        alpha: 121,
        beta: 3881,
        spend: 30,
        impressions: 4000,
      },
    ]);
  });
});

describe('betaPdfPoints', () => {
  it('returns n points inside (0,1), max-normalized to peak 1', () => {
    const points = betaPdfPoints(20, 80);
    expect(points).toHaveLength(50);
    for (const p of points) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...points.map((p) => p.y))).toBe(1);
    // Beta(20, 80) peaks near its mode ≈ 0.194
    const peak = points.reduce((a, b) => (b.y > a.y ? b : a));
    expect(Math.abs(peak.x - 0.194)).toBeLessThan(0.03);
  });

  it('respects a custom point count', () => {
    expect(betaPdfPoints(2, 2, 10)).toHaveLength(10);
  });
});
