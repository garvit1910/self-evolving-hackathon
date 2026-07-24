// Thompson sampling: Beta sampler (via Marsaglia–Tsang Gamma), the bandit
// allocator plugging into sim.ts's Allocator slot, and posterior sampling over
// genome dimensions for regeneration priors.

import type { DimensionPosterior } from '../contracts';
import type { Allocator, Rand } from '../sim';

// Box–Muller (sim.ts keeps its own copy private).
function normal(rand: Rand): number {
  const u1 = 1 - rand(); // (0, 1] so log never sees 0
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Gamma(shape, 1) via Marsaglia–Tsang; shape < 1 boosted through shape + 1. */
export function sampleGamma(shape: number, rand: Rand): number {
  if (shape < 1) {
    const u = 1 - rand(); // (0, 1]
    return sampleGamma(shape + 1, rand) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rand);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = 1 - rand(); // (0, 1]
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(alpha: number, beta: number, rand: Rand): number {
  const x = sampleGamma(alpha, rand);
  const y = sampleGamma(beta, rand);
  const sum = x + y;
  return sum > 0 ? x / sum : alpha / (alpha + beta); // underflow fallback
}

export type ThompsonOpts = {
  /** Exponent on sampled θ; 1 = proportional, higher = greedier, 0 = uniform. */
  temperature?: number;
  /** Guaranteed budget fraction per live arm (when ≥2 live) so no arm starves. */
  minShare?: number;
};

/**
 * Returns an Allocator: each day samples θ_i ~ Beta(arm.alpha, arm.beta) per
 * live creative and splits state.dailyBudget ∝ θ_i^temperature above a minShare
 * floor. Largest-remainder rounding — integer allocations sum exactly to budget.
 */
export function makeThompsonAllocator(rng: Rand, opts: ThompsonOpts = {}): Allocator {
  const temperature = opts.temperature ?? 1;
  const minShare = opts.minShare ?? 0.02;
  return (liveCreatives, state) => {
    const alloc = new Map<string, number>();
    if (liveCreatives.length === 0) return alloc;
    const budget = state.dailyBudget;
    const weights = liveCreatives.map((c) =>
      Math.pow(sampleBeta(c.arm.alpha, c.arm.beta, rng), temperature),
    );
    let floor = liveCreatives.length >= 2 ? Math.floor(minShare * budget) : 0;
    if (floor * liveCreatives.length > budget) floor = Math.floor(budget / liveCreatives.length);
    const remaining = budget - floor * liveCreatives.length;
    const wSum = weights.reduce((a, b) => a + b, 0);
    const shares = weights.map((w) =>
      wSum > 0 ? (w / wSum) * remaining : remaining / liveCreatives.length,
    );
    const bases = shares.map(Math.floor);
    let leftover = remaining - bases.reduce((a, b) => a + b, 0);
    const byFraction = shares
      .map((s, i) => ({ frac: s - bases[i], i }))
      .sort((a, b) => b.frac - a.frac); // stable sort → deterministic tie-break
    for (const { i } of byFraction) {
      if (leftover <= 0) break;
      bases[i] += 1;
      leftover -= 1;
    }
    liveCreatives.forEach((c, i) => alloc.set(c.publishedAdId, floor + bases[i]));
    return alloc;
  };
}

/**
 * Posterior-samples a winning value WITHIN each genome dimension. Returned
 * strings are the exact attribution keys — never rephrased or re-cased.
 * A dimension absent from `posteriors` yields ''.
 */
export function samplePriors(
  posteriors: DimensionPosterior[],
  rng: Rand,
): { angle: string; persona: string; hook: string; style: string } {
  const winners = { angle: '', persona: '', hook: '', style: '' };
  const best = { angle: -1, persona: -1, hook: -1, style: -1 };
  for (const p of posteriors) {
    const theta = sampleBeta(p.alpha, p.beta, rng);
    if (theta > best[p.dimension]) {
      best[p.dimension] = theta;
      winners[p.dimension] = p.value;
    }
  }
  return winners;
}
