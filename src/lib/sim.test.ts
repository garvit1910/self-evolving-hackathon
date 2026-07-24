import { describe, expect, it } from 'vitest';
import { binomial, defaultMarketConfig, mulberry32, rollup, runSim } from './sim';
import { gen1Creatives } from '@/fixtures/creatives';
import { panelScores } from '@/fixtures/panel-scores';

const DAYS = 20;

describe('determinism', () => {
  it('same seed → deep-equal metrics', () => {
    const a = runSim(defaultMarketConfig, gen1Creatives, panelScores, DAYS, 42);
    const b = runSim(defaultMarketConfig, gen1Creatives, panelScores, DAYS, 42);
    expect(a.metrics).toEqual(b.metrics);
    expect(a.state.cumImpressions).toEqual(b.state.cumImpressions);
  });

  it('different seed → different metrics', () => {
    const a = runSim(defaultMarketConfig, gen1Creatives, panelScores, DAYS, 42);
    const b = runSim(defaultMarketConfig, gen1Creatives, panelScores, DAYS, 43);
    expect(a.metrics).not.toEqual(b.metrics);
  });
});

describe('binomial sampler', () => {
  it('exact regime (n·p ≤ 30): mean of 1,000 draws ≈ n·p', () => {
    const rand = mulberry32(7);
    const n = 50;
    const p = 0.3; // n·p = 15 → Bernoulli loop
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += binomial(rand, n, p);
    const mean = sum / 1000;
    expect(Math.abs(mean - n * p)).toBeLessThan(0.5);
  });

  it('approx regime (n·p > 30): mean of 1,000 draws ≈ n·p', () => {
    const rand = mulberry32(11);
    const n = 10_000;
    const p = 0.01; // n·p = 100 → normal approximation
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += binomial(rand, n, p);
    const mean = sum / 1000;
    expect(Math.abs(mean - n * p)).toBeLessThan(2);
  });

  it('edge cases', () => {
    const rand = mulberry32(1);
    expect(binomial(rand, 0, 0.5)).toBe(0);
    expect(binomial(rand, 100, 0)).toBe(0);
    expect(binomial(rand, 100, 1)).toBe(100);
  });
});

describe('winner recovery', () => {
  it(`planted angle has the highest aggregate CTR after ${DAYS} days uniform`, () => {
    const { metrics } = runSim(defaultMarketConfig, gen1Creatives, panelScores, DAYS, 42);
    const angleRows = rollup(metrics, gen1Creatives).filter((r) => r.dimension === 'angle');
    expect(angleRows.length).toBeGreaterThan(1);
    const winner = angleRows.reduce((best, row) => (row.ctr > best.ctr ? row : best));
    expect(winner.value).toBe('nostalgia-reboot');
  });
});

describe('conservation', () => {
  it('clicks ≤ impressions and purchases ≤ clicks for every row', () => {
    const { metrics } = runSim(defaultMarketConfig, gen1Creatives, panelScores, DAYS, 42);
    expect(metrics.length).toBe(DAYS * gen1Creatives.length);
    for (const row of metrics) {
      expect(row.impressions).toBeGreaterThanOrEqual(0);
      expect(row.clicks).toBeGreaterThanOrEqual(0);
      expect(row.purchases).toBeGreaterThanOrEqual(0);
      expect(row.clicks).toBeLessThanOrEqual(row.impressions);
      expect(row.purchases).toBeLessThanOrEqual(row.clicks);
      expect(row.spend).toBeGreaterThanOrEqual(0);
      expect(row.purchaseValue).toBeGreaterThanOrEqual(0);
    }
  });
});
