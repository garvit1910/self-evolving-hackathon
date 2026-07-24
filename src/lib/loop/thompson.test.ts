import { describe, expect, it } from 'vitest';
import type { Creative, DimensionPosterior } from '../contracts';
import { type SimState, mulberry32 } from '../sim';
import { makeThompsonAllocator, sampleBeta, samplePriors } from './thompson';

const makeCreative = (n: number, arm: { alpha: number; beta: number; pulls: number }): Creative => ({
  id: `cr-t-${n}`,
  briefId: `brief-t-${n}`,
  brandId: 'brand-test',
  imageUrl: '',
  copy: '',
  genome: { angle: `angle-${n}`, persona: `p-${n}`, hook: `h-${n}`, style: `s-${n}`, generation: 1 },
  status: 'live',
  publishedAdId: `ad-t-${n}`,
  arm,
});

const makeState = (dailyBudget: number, seed = 1): SimState => ({
  day: 0,
  rand: mulberry32(seed),
  dailyBudget,
  cumImpressions: {},
});

describe('Beta sampler', () => {
  it('2,000 draws from Beta(20, 80): mean within ±0.02 of 0.2', () => {
    const rand = mulberry32(123);
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += sampleBeta(20, 80, rand);
    const mean = sum / 2000;
    expect(Math.abs(mean - 0.2)).toBeLessThan(0.02);
  });

  it('draws stay in (0, 1) including shape < 1', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const x = sampleBeta(0.5, 2.5, rand);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('makeThompsonAllocator invariants', () => {
  const BUDGET = 9999; // non-divisible on purpose
  const arms = [
    makeCreative(1, { alpha: 50, beta: 950, pulls: 5 }),
    makeCreative(2, { alpha: 5, beta: 995, pulls: 5 }),
    makeCreative(3, { alpha: 500, beta: 100, pulls: 5 }),
  ];

  it('every day: non-negative integers summing exactly to budget, minShare floor held', () => {
    const allocator = makeThompsonAllocator(mulberry32(42));
    const state = makeState(BUDGET);
    const minPerArm = Math.floor(0.02 * BUDGET);
    for (let day = 0; day < 30; day++) {
      const alloc = allocator(arms, state);
      expect(alloc.size).toBe(arms.length);
      let total = 0;
      for (const c of arms) {
        const n = alloc.get(c.publishedAdId)!;
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(minPerArm); // ≥2 arms live → floor applies
        total += n;
      }
      expect(total).toBe(BUDGET);
    }
  });

  it('a single live arm receives the entire budget', () => {
    const allocator = makeThompsonAllocator(mulberry32(9));
    const alloc = allocator([arms[0]], makeState(BUDGET));
    expect(alloc.get(arms[0].publishedAdId)).toBe(BUDGET);
  });

  it('no live arms → empty allocation', () => {
    const allocator = makeThompsonAllocator(mulberry32(9));
    expect(allocator([], makeState(BUDGET)).size).toBe(0);
  });

  it('temperature 0 → uniform split up to rounding', () => {
    const allocator = makeThompsonAllocator(mulberry32(5), { temperature: 0 });
    const alloc = allocator(arms, makeState(9000));
    for (const c of arms) {
      expect(Math.abs(alloc.get(c.publishedAdId)! - 3000)).toBeLessThanOrEqual(1);
    }
  });
});

describe('samplePriors', () => {
  it('returns winning value strings verbatim, one per dimension', () => {
    const posteriors: DimensionPosterior[] = [
      { dimension: 'angle', value: 'nostalgia-reboot', alpha: 500, beta: 500, spend: 100, impressions: 998 },
      { dimension: 'angle', value: 'macro-math', alpha: 2, beta: 998, spend: 100, impressions: 998 },
      { dimension: 'persona', value: 'Keto Parent (TEST casing) ', alpha: 300, beta: 700, spend: 50, impressions: 998 },
      { dimension: 'hook', value: '0g sugar. Yes, really.', alpha: 400, beta: 600, spend: 50, impressions: 998 },
      { dimension: 'style', value: 'retro-cartoon', alpha: 100, beta: 900, spend: 50, impressions: 998 },
    ];
    const res = samplePriors(posteriors, mulberry32(11));
    expect(res.angle).toBe('nostalgia-reboot'); // dominant posterior wins
    expect(res.persona).toBe('Keto Parent (TEST casing) '); // verbatim: casing + trailing space kept
    expect(res.hook).toBe('0g sugar. Yes, really.');
    expect(res.style).toBe('retro-cartoon');
  });
});
