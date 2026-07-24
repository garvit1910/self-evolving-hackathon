/**
 * composeBrief — deterministic, NO network, NO LLM. The load-bearing spine.
 * Given context (Senso facts) + personas + Actian top-k + sampled priors,
 * it produces a Brief. Sponsors only ENRICH its inputs; they never gate it.
 *
 * Gen-1: priors empty → angle chosen from brand positioning/value_prop.
 * Gen-2: priors present → angle = highest-weight sampled prior (VERBATIM value),
 *        so learnings from the performance loop steer the next generation.
 */

import type { Brief, BriefInput } from '@/lib/contracts';
import { DEFAULT_ANGLES, DEFAULT_STYLES } from './axes';

export function composeBrief(input: BriefInput): Brief {
  const { runId, brand, generation, facts, personas, topKChunks, priors } = input;

  const positioning = facts.find((f) => f.section === 'positioning');
  const valueProp = facts.find((f) => f.section === 'value_prop');
  const voice = facts.find((f) => f.section === 'voice');
  const compliance = facts.filter((f) => f.section === 'compliance').map((f) => f.statement);

  // angle: prior-sampled (verbatim) > brand advantage > default
  const anglePrior = [...priors]
    .filter((p) => p.dimension === 'angle')
    .sort((a, b) => b.weight - a.weight)[0];
  const angle =
    anglePrior?.value ??
    (positioning ? DEFAULT_ANGLES[0] : DEFAULT_ANGLES[generation % DEFAULT_ANGLES.length]);

  const personaPrior = [...priors]
    .filter((p) => p.dimension === 'persona')
    .sort((a, b) => b.weight - a.weight)[0];
  const persona = personaPrior?.value ?? personas[0]?.name ?? 'General buyer';

  const stylePrior = [...priors]
    .filter((p) => p.dimension === 'style')
    .sort((a, b) => b.weight - a.weight)[0];
  const style = stylePrior?.value ?? DEFAULT_STYLES[generation % DEFAULT_STYLES.length];

  const coreMessage =
    valueProp?.statement ?? positioning?.statement ?? `${brand.name}: the better choice.`;

  // hooks drawn from top-k retrieval + voice, deterministic order
  const hookSeeds = [
    voice?.statement,
    topKChunks[0],
    positioning?.statement,
  ].filter(Boolean) as string[];
  const hooks = hookSeeds.slice(0, 3);

  return {
    id: `${runId}-brief-g${generation}`,
    brandId: brand.id,
    contextHash: brand.contextHash,
    generation,
    angle,
    persona,
    coreMessage,
    hooks: hooks.length ? hooks : [coreMessage],
    cta: 'Try it today',
    style,
    compliance,
    priorProvenance: priors.map((p) => `${p.dimension}:${p.value}`),
  };
}
