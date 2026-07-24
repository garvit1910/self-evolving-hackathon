/**
 * Personasmith — derives 3 personas grounded in extracted facts. Each persona's
 * pains/desires/objections must trace back to factIds so downstream briefs can
 * cite why a persona was targeted the way they were.
 */

import type { Fact, Persona } from '@/lib/contracts';
import type { Feed, LLM } from '../adapters/interfaces';

type RawPersona = {
  name: string;
  summary: string;
  pains: string[];
  desires: string[];
  objections: string[];
  factIds: string[];
};

const SCHEMA_HINT =
  '{ personas: { name: string, summary: string, pains: string[], desires: string[], objections: string[], factIds: string[] }[] }';

function buildPrompt(facts: Fact[]): string {
  const factLines = facts.map((f) => `[${f.id}] (${f.section}) ${f.statement}`).join('\n');
  return [
    'You are a persona strategist. From these grounded brand facts, derive exactly 3',
    'distinct buyer personas. Each persona must reference factIds from the list below',
    '(only IDs that appear in the list) to justify its pains/desires/objections.',
    '',
    factLines,
  ].join('\n');
}

export async function generatePersonas(
  brandId: string,
  facts: Fact[],
  llm: LLM,
  feed: Feed,
  room: string,
): Promise<Persona[]> {
  if (facts.length === 0) return [];

  const validIds = new Set(facts.map((f) => f.id));
  const { personas: raw } = await llm.extract<{ personas: RawPersona[] }>(buildPrompt(facts), SCHEMA_HINT);

  const personas: Persona[] = (raw ?? []).slice(0, 3).map((p, i) => ({
    id: `p${i + 1}`,
    brandId,
    name: p.name,
    summary: p.summary,
    pains: p.pains ?? [],
    desires: p.desires ?? [],
    objections: p.objections ?? [],
    factIds: (p.factIds ?? []).filter((id) => validIds.has(id)),
  }));

  await feed.post(room, {
    agent: 'personasmith',
    kind: 'tool_result',
    payload: { personas: personas.map((p) => ({ name: p.name, factIds: p.factIds })) },
  });

  return personas;
}
