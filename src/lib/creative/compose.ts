import type { Brand, Brief, Fact } from '../contracts';
import { slugify } from '../hash';
import { DEFAULT_ANGLES, DEFAULT_PERSONAS, DEFAULT_STYLES } from '../brief/axes';

// Deterministic brief composer — no LLM, no fs. Same inputs → same briefs.
// Angle priority: priors.angle VERBATIM ('sampled') > competitive-advantage
// fact slug ('competitive_fact') > default rotation ('default_rotation').
// Genome strings composed here become attribution keys — never rephrased;
// the vocabulary lives in src/lib/brief/axes.ts (single source).

export type Priors = { angle: string; persona: string; hook: string; style: string };

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function firstWords(text: string, n: number): string {
  return text.split(/\s+/).slice(0, n).join(' ').replace(/[.,;:]$/, '');
}

/** Persona display name: the statement up to the first '(' or ':'. */
export function parsePersonas(personaFacts: Fact[]): string[] {
  const names = personaFacts
    .map((f) => f.statement.split(/[(:]/)[0].trim())
    .filter((name) => name.length > 0 && name.length <= 64);
  return names.length > 0 ? uniq(names) : DEFAULT_PERSONAS;
}

export function composeBriefs(input: {
  brand: Brand;
  facts: Fact[];
  /** Retrieval-ranked facts (ContextStore.search + VectorStore.query). */
  rankedFacts: Fact[];
  priors?: Priors;
  count: number;
  generation: 1 | 2;
  runId: string;
  contextVersion: number;
  contextHash: string;
}): Brief[] {
  const { brand, facts, rankedFacts, priors, count, generation, runId } = input;

  const byConfidence = (section: Fact['section']) =>
    facts
      .filter((f) => f.section === section)
      .sort((a, b) => b.confidence - a.confidence || (a.id < b.id ? -1 : 1));

  const valueProps = byConfidence('value_prop');
  const positioning = byConfidence('positioning');
  const voice = byConfidence('voice');
  const personaFacts = facts.filter((f) => f.section === 'persona');

  const coreFact = valueProps[0] ?? positioning[0];
  const coreMessage = coreFact?.statement ?? `${brand.name} — built different.`;

  // -- angle pool --
  // market_prior facts (competitor insights from the research swarm) drive the
  // competitive angle when the brand's own positioning/value_prop are thin
  const marketPrior = byConfidence('market_prior');
  const competitiveFact = positioning[0] ?? valueProps[0] ?? marketPrior[0];
  let anglePool: string[];
  let priorSource: Brief['priorSource'];
  if (priors?.angle) {
    // exploitation: every regenerated brief rides the sampled winning angle
    anglePool = [priors.angle];
    priorSource = 'sampled';
  } else if (competitiveFact) {
    const competitiveSlug = slugify(firstWords(competitiveFact.statement, 3));
    anglePool = [competitiveSlug, ...DEFAULT_ANGLES];
    priorSource = 'competitive_fact';
  } else {
    anglePool = DEFAULT_ANGLES;
    priorSource = 'default_rotation';
  }

  // -- persona + style pools (priors seed the front of the rotation) --
  const personas = parsePersonas(personaFacts);
  const personaPool = priors?.persona ? uniq([priors.persona, ...personas]) : personas;
  const stylePool = priors?.style ? uniq([priors.style, ...DEFAULT_STYLES]) : DEFAULT_STYLES;

  const cta = [...positioning, ...valueProps].some((f) =>
    /subscri|direct[- ]to[- ]consumer|dtc/i.test(f.statement),
  )
    ? 'Try it today'
    : 'Shop now';

  const usedFactIds = uniq(
    [coreFact, competitiveFact, personaFacts[0], voice[0], ...rankedFacts.slice(0, 3)]
      .filter((f): f is Fact => f !== undefined)
      .map((f) => f.id),
  );

  const briefs: Brief[] = [];
  for (let i = 0; i < count; i++) {
    const angle = anglePool[i % anglePool.length];
    const persona = personaPool[i % personaPool.length];
    const style = stylePool[i % stylePool.length];
    const hookTemplates = [
      `${firstWords(coreMessage, 5)} — really.`,
      `Meet ${brand.name}, again.`,
      `The ${angle.replace(/-/g, ' ')} moment.`,
      voice[0] ? `${firstWords(voice[0].statement, 4)}.` : `Still sleeping on ${brand.name}?`,
    ];
    const hook = priors?.hook && i === 0 ? priors.hook : hookTemplates[i % hookTemplates.length];
    briefs.push({
      id: `${runId}-b${i + 1}`,
      brandId: brand.id,
      generation,
      angle,
      persona,
      hook,
      style,
      coreMessage,
      cta,
      sourceFactIds: usedFactIds,
      contextVersion: input.contextVersion,
      contextHash: input.contextHash,
      priorSource,
    });
  }
  return briefs;
}
