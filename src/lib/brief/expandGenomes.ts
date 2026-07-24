/**
 * expandGenomes — deterministic fan-out, NO network, NO LLM.
 *
 * composeBrief emits ONE Brief (one angle, one persona, one style). The bandit
 * needs 6-8 creatives whose genomes differ, or per-dimension posteriors have
 * nothing to compare. This is that fan-out layer.
 *
 * Indexing uses a SHIFTED round-robin, not a plain one. Plain `axis[i % len]`
 * perfectly confounds any two axes of equal length: with 4 angles and 4 styles
 * across 8 creatives, angle and style would move in lockstep and no downstream
 * math could tell which drove performance. Each axis therefore advances by
 * `floor(i / len) * SHIFTS[dimension]` on wrap, with a DIFFERENT shift per
 * dimension — a shared shift would leave two same-length axes identical, which
 * is the same bug wearing a disguise.
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

/**
 * Per-dimension shift multipliers. A shared shift is NOT enough: two axes of the
 * same length with the same shift produce identical index sequences, so with 4
 * angles and 4 styles the two would still be perfectly confounded. These values
 * are chosen so that does not happen for any axis length 2-4, and
 * scripts/test-expand-genomes.ts asserts it empirically rather than on trust.
 */
const SHIFTS: Record<Prior['dimension'], number> = {
  angle: 1,
  persona: 2,
  hook: 3,
  style: 3,
};

/** Shifted round-robin — see the file header for why the shift matters. */
function pick(axis: string[], i: number, shift: number): string {
  const len = axis.length;
  // A shift that is a multiple of len degenerates to a plain round-robin.
  const s = shift % len === 0 ? 1 : shift;
  return axis[(i + Math.floor(i / len) * s) % len];
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

  const out: Genome[] = [];
  const seen = new Set<string>();

  // Bounded scan: if the axes cannot yield n distinct combinations, return
  // however many exist rather than looping forever.
  for (let i = 0; out.length < n && i < n * 4; i++) {
    const genome: Genome = {
      angle: pick(angleAxis, i, SHIFTS.angle),
      persona: pick(personaAxis, i, SHIFTS.persona),
      hook: pick(hookAxis, i, SHIFTS.hook),
      style: pick(styleAxis, i, SHIFTS.style),
      generation: brief.generation,
    };
    const key = `${genome.angle}|${genome.persona}|${genome.hook}|${genome.style}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(genome);
  }

  return out;
}
