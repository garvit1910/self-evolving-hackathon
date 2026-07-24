/**
 * expandGenomes — deterministic fan-out, NO network, NO LLM.
 *
 * composeBrief emits ONE Brief (one angle, one persona, one style). The bandit
 * needs 6-8 creatives whose genomes differ, or per-dimension posteriors have
 * nothing to compare. This is that fan-out layer.
 *
 * Indexing is a mixed-radix enumeration of the cartesian product of the four
 * axes, walked with a coprime stride — NOT a per-axis shifted round-robin.
 * A shift-ONLY scheme was tried first and turned out to be unfixable AS A
 * SHIFT: the shift only matters modulo the axis length, so four axes of
 * length 4 have only three usable residues {1,2,3} and some pair of axes is
 * always forced to collide (move in perfect lockstep) — exactly the
 * confounding this module exists to prevent. (A per-axis STRIDE combined
 * with a distinct per-axis WRAP OFFSET — i.e. more than a bare shift — would
 * have worked too; what specifically failed was shift-only, not the whole
 * family of round-robin schemes. The mixed-radix walk below was chosen over
 * that fix because it also gives a bijection proof for free, not because the
 * offset fix was impossible.)
 *
 * The mixed-radix scheme instead treats the four axes as digits of one
 * number in base (La, Lp, Lh, Ls) — `total = La*Lp*Lh*Ls` distinct
 * combinations exist — and walks that number line with `idx = (i * STEP) %
 * total`, where `STEP` is coprime to `total`. Because `STEP` is coprime to
 * `total`, `i -> (i * STEP) % total` is a bijection over `i < total`: every
 * combination is visited exactly once with no repeats, so combinations are
 * distinct BY CONSTRUCTION (the `seen` set below is a cheap safety net, not
 * the mechanism). Each axis is then read off `idx` by successive `% len` /
 * `div len` — angle off the LOWEST digit, style off the HIGHEST — so each
 * axis advances on its own period (its own radix) rather than sharing one
 * counter with another axis — no two axes can be functionally dependent on
 * each other regardless of their lengths.
 *
 * KNOWN LIMITATION (found in final review, not fixed — see plan Finding 2):
 * when `n` is small relative to `total` (e.g. n=8 against total=96 on the
 * real fixture: La=4, Lp=3, Lh=2, Ls=4), only n/total of the number line is
 * walked, and HIGH-ORDER digits barely move in that short a walk. Measured
 * on the real fixture at n=8: angle 4/4 distinct, persona 3/3, hook 2/2, but
 * style — the highest-order digit — only reaches 2 of its 4 values. This is
 * a sampling-depth artifact of walking few points on a big number line, not
 * a correctness bug in the bijection; it is NOT fixed here (see
 * scripts/test-expand-genomes.ts for the coverage assertion documenting the
 * current, weaker guarantee). A future fix would need to bias STEP or the
 * digit order so early digits rotate faster, which is a bigger change than
 * this pass's scope justifies.
 *
 * Gen-2: for each dimension with a Prior, the axis truncates to 2 values
 * (winner first) so the set concentrates on what won without collapsing to N
 * identical genomes.
 */

import type { Brief, Genome, Persona, Prior } from '@/lib/contracts';
import { DEFAULT_ANGLES, DEFAULT_STYLES } from './axes';

/** Put the brief's own choice at position 0, then the rest of the pool. */
function leadFirst(lead: string | undefined, pool: string[]): string[] {
  if (!lead) return [...pool];
  return [lead, ...pool.filter((v) => v !== lead)];
}

function dedupe(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v && v.trim().length > 0))];
}

/**
 * Gen-2 narrowing: winner first, then the axis's own gen-1 lead. If those are
 * the same value, the next unused value fills slot 2 so the axis never
 * degenerates to length 1.
 */
function narrow(axis: string[], priors: Prior[], dimension: Prior['dimension']): string[] {
  const winner = priors
    .filter((p) => p.dimension === dimension)
    .sort((a, b) => b.weight - a.weight)[0];
  if (!winner) return axis;
  const second = axis.find((v) => v !== winner.value);
  return second ? [winner.value, second] : [winner.value];
}

function gcd(a: number, b: number): number {
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * Smallest stride in [2, total) that is coprime to `total`, so that
 * `i -> (i * stride) % total` is a bijection over `i < total`. Falls back to
 * 1 when no such stride exists (total <= 2, or every candidate in range
 * shares a factor with total) — `gcd(1, total) === 1` always holds, so a
 * stride of 1 (a plain walk) is a safe default, just not decorrelating.
 */
function coprimeStride(total: number): number {
  for (let s = 2; s < total; s++) {
    if (gcd(s, total) === 1) return s;
  }
  return 1;
}

export function expandGenomes(
  brief: Brief,
  personas: Persona[],
  n: number,
  priors: Prior[] = [],
): Genome[] {
  const angleAxis = narrow(dedupe(leadFirst(brief.angle, DEFAULT_ANGLES)), priors, 'angle');
  const styleAxis = narrow(dedupe(leadFirst(brief.style, DEFAULT_STYLES)), priors, 'style');
  const personaAxis = narrow(
    dedupe([brief.persona, ...personas.map((p) => p.name)]),
    priors,
    'persona',
  );
  const hookAxis = narrow(
    dedupe(brief.hooks.length ? brief.hooks : [brief.coreMessage]),
    priors,
    'hook',
  );

  const La = angleAxis.length;
  const Lp = personaAxis.length;
  const Lh = hookAxis.length;
  const Ls = styleAxis.length;
  // An axis can go empty (e.g. hooks that are all whitespace, dedupe()'d to
  // []), which would make `total` 0 and every `idx % 0` NaN, silently
  // producing a Genome whose fields are `undefined` at runtime despite the
  // `string` type. No valid genome can be built with a missing axis, so bail
  // to an empty result instead.
  if (La === 0 || Lp === 0 || Lh === 0 || Ls === 0) return [];
  const total = La * Lp * Lh * Ls;
  const STEP = coprimeStride(total);

  const out: Genome[] = [];
  const seen = new Set<string>();

  // Bounded scan: `total` distinct combinations exist by construction (see
  // header), so i < total is enough to enumerate all of them; the extra
  // `n * 4` bound only guards the degenerate `total === 0` case.
  const bound = Math.max(total, n * 4);
  for (let i = 0; out.length < n && i < bound; i++) {
    let idx = (i * STEP) % total;
    const angle = angleAxis[idx % La];
    idx = Math.floor(idx / La);
    const persona = personaAxis[idx % Lp];
    idx = Math.floor(idx / Lp);
    const hook = hookAxis[idx % Lh];
    idx = Math.floor(idx / Lh);
    const style = styleAxis[idx % Ls];

    const genome: Genome = { angle, persona, hook, style, generation: brief.generation };
    const key = `${genome.angle}|${genome.persona}|${genome.hook}|${genome.style}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(genome);
  }

  return out;
}
