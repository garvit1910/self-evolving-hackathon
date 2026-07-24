/**
 * expandGenomes — deterministic fan-out, NO network, NO LLM.
 *
 * composeBrief emits ONE Brief (one angle, one persona, one style). The bandit
 * needs 6-8 creatives whose genomes differ, or per-dimension posteriors have
 * nothing to compare. This is that fan-out layer.
 *
 * Indexing (UNIFIED at merge — this is the "per-axis stride + distinct wrap
 * offset" fix the previous mixed-radix header identified as the workable
 * round-robin family; see docs/WIRING.md and the commit message for the old
 * vs new distributions):
 *
 *   value_j(i) = axis_j[(i + floor(i / len_j) * offset_j) % len_j]
 *
 * Every axis is a plain round-robin over its own values — so EVERY axis
 * reaches full coverage as soon as n >= len_j (the mixed-radix walk's known
 * limitation was the opposite: high-order axes barely moved at small n, and
 * under the unified vocabulary the style axis went fully CONSTANT at n=8).
 * Each time an axis completes a wrap it re-enters shifted by its own
 * distinct offset_j (its axis position: 0,1,2,3), so two axes of the same
 * length fall out of lockstep after their first wrap — the confounding a
 * bare shared-shift scheme could not avoid. Distinctness is enforced by the
 * `seen` set with a bounded scan: duplicate combinations are skipped and the
 * walk continues, so the result is n distinct genomes whenever the axes
 * admit them (i=0 still yields each axis's lead value).
 *
 * Gen-2 (UNIFIED at merge, pinned by tests/api-generate.test.ts): an ANGLE
 * prior collapses its axis to [winner] — every gen-2 creative rides the
 * sampled winning angle VERBATIM, matching composeBriefs' exploitation rule.
 * Persona/hook/style priors LEAD their axes instead (creative 1 carries them
 * verbatim, the rest keep exploring), so the set concentrates on what won
 * without collapsing to N identical genomes.
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

/** Highest-weight prior for a dimension, if any. */
function priorFor(priors: Prior[], dimension: Prior['dimension']): Prior | undefined {
  return priors
    .filter((p) => p.dimension === dimension)
    .sort((a, b) => b.weight - a.weight)[0];
}

/** Round-robin over one axis with a per-wrap offset (see header). */
function axisValue(axis: string[], i: number, offset: number): string {
  const len = axis.length;
  return axis[(i + Math.floor(i / len) * offset) % len];
}

export function expandGenomes(
  brief: Brief,
  personas: Persona[],
  n: number,
  priors: Prior[] = [],
): Genome[] {
  const anglePrior = priorFor(priors, 'angle');
  const angleAxis = anglePrior
    ? [anglePrior.value] // exploitation: every creative rides the winner verbatim
    : dedupe(leadFirst(brief.angle, DEFAULT_ANGLES));
  const styleAxis = dedupe(
    leadFirst(priorFor(priors, 'style')?.value ?? brief.style, DEFAULT_STYLES),
  );
  const personaAxis = dedupe(
    leadFirst(priorFor(priors, 'persona')?.value, [brief.persona, ...personas.map((p) => p.name)]),
  );
  const hookPool = brief.hooks?.length ? brief.hooks : [brief.hook || brief.coreMessage];
  const hookAxis = dedupe(leadFirst(priorFor(priors, 'hook')?.value, hookPool));

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

  const out: Genome[] = [];
  const seen = new Set<string>();

  // Bounded scan: at most `total` distinct combinations exist; the wrap-offset
  // walk revisits some, so scan a few multiples of `total` before giving up
  // (the seen set skips revisits, so the loop below only ever emits distinct
  // genomes — it just may need more than `total` iterations to find them all).
  const bound = Math.max(total * 4, n * 4);
  for (let i = 0; out.length < n && i < bound; i++) {
    const genome: Genome = {
      angle: axisValue(angleAxis, i, 0),
      persona: axisValue(personaAxis, i, 1),
      hook: axisValue(hookAxis, i, 2),
      style: axisValue(styleAxis, i, 3),
      generation: brief.generation,
    };
    const key = `${genome.angle}|${genome.persona}|${genome.hook}|${genome.style}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(genome);
  }

  return out;
}
