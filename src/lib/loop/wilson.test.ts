import { describe, expect, it } from 'vitest';
import type { DailyMetrics } from '../contracts';
import { compareGenerations, wilsonInterval } from './wilson';

const row = (adId: string, day: number, impressions: number, clicks: number): DailyMetrics => ({
  adId,
  day,
  impressions,
  clicks,
  purchases: 0,
  spend: 0,
  purchaseValue: 0,
});

describe('wilsonInterval', () => {
  it('wilsonInterval(50, 100) ≈ [0.404, 0.596]', () => {
    const { low, high } = wilsonInterval(50, 100);
    expect(Math.abs(low - 0.404)).toBeLessThan(0.005);
    expect(Math.abs(high - 0.596)).toBeLessThan(0.005);
  });

  it('degenerate inputs stay in [0, 1]', () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
    const zero = wilsonInterval(0, 100);
    expect(zero.low).toBe(0);
    expect(zero.high).toBeGreaterThan(0);
    const all = wilsonInterval(100, 100);
    expect(all.high).toBeCloseTo(1, 10);
    expect(all.low).toBeLessThan(1);
  });
});

describe('compareGenerations', () => {
  it('below the 500-impression floor → insufficient_sample', () => {
    const gen1 = [row('a', 1, 400, 40)]; // under floor
    const gen2 = [row('b', 1, 2000, 100)];
    expect(compareGenerations(gen1, gen2).verdict).toBe('insufficient_sample');
    expect(compareGenerations(gen2, gen1).verdict).toBe('insufficient_sample');
  });

  it('clearly separated CTRs → gen2_wins, symmetric case → gen1_wins', () => {
    const weak = [row('a', 1, 500, 5), row('a', 2, 500, 5)]; // 1% CTR
    const strong = [row('b', 1, 500, 50), row('b', 2, 500, 50)]; // 10% CTR
    const res = compareGenerations(weak, strong);
    expect(res.verdict).toBe('gen2_wins');
    expect(res.gen1Ctr).toBeCloseTo(0.01, 10);
    expect(res.gen2Ctr).toBeCloseTo(0.1, 10);
    expect(res.ci2.low).toBeGreaterThan(res.ci1.high);
    expect(compareGenerations(strong, weak).verdict).toBe('gen1_wins');
  });

  it('overlapping intervals → not_significant', () => {
    const a = [row('a', 1, 1000, 50)];
    const b = [row('b', 1, 1000, 55)];
    expect(compareGenerations(a, b).verdict).toBe('not_significant');
  });
});
