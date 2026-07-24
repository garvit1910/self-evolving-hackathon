import type { Creative, Fact, PanelScore, ProviderMode } from './contracts';
import { parsePersonas } from './creative/compose';
import { fnv1a } from './hash';
import { HTTPLLMClient, getLLMConfig, pLimit } from './llm';

// Persona panel: each persona (from persona-section facts) scores each creative
// 0–100. Live path = one LLM call per creative×persona (concurrency 4, per-item
// fallback); mock path = deterministic hash base + genome↔persona affinity so
// e.g. the nostalgia persona favors nostalgia-angle creatives.

const REASONS = [
  (g: Creative['genome']) => `the ${g.angle.replace(/-/g, ' ')} framing lands for me`,
  (g: Creative['genome']) => `${g.style} visuals fit how I shop`,
  (g: Creative['genome']) => `hook grabbed me but the ${g.style} look is hit or miss`,
  (g: Creative['genome']) => `speaks to my priorities, though the angle feels familiar`,
  (g: Creative['genome']) => `strong ${g.angle.replace(/-/g, ' ')} pitch, would stop scrolling`,
  (g: Creative['genome']) => `not fully convinced by the ${g.angle.replace(/-/g, ' ')} take`,
];

function affinityBonus(genome: Creative['genome'], persona: string): number {
  const p = persona.toLowerCase();
  const angle = genome.angle.toLowerCase();
  let bonus = 0;
  if (p.includes('nostalgi') && angle.includes('nostalgia')) bonus += 18;
  if (p.includes('sugar') && angle.includes('sugar')) bonus += 12;
  if ((p.includes('keto') || p.includes('parent')) && genome.style === 'clean-clinical') bonus += 8;
  if ((p.includes('keto') || p.includes('parent')) && genome.style === 'retro-cartoon') bonus -= 6;
  // generic token overlap so any brand's personas get some signal (capped)
  let overlap = 0;
  for (const word of new Set(p.split(/[^a-z]+/))) {
    if (word.length > 4 && angle.includes(word)) overlap += 6;
  }
  return bonus + Math.min(overlap, 12);
}

export function mockScore(creative: Creative, persona: string): PanelScore {
  const base = 55 + (fnv1a(`${creative.id}|${persona}`) % 21); // 55..75
  const appealScore = Math.max(0, Math.min(100, base + affinityBonus(creative.genome, persona)));
  const reason = REASONS[fnv1a(`${persona}|${creative.id}`) % REASONS.length](creative.genome);
  return { creativeId: creative.id, persona, appealScore, reason };
}

export async function scorePanel(opts: {
  creatives: Creative[];
  personaFacts: Fact[];
  brandName: string;
}): Promise<{ scores: PanelScore[]; mode: ProviderMode }> {
  const personas = parsePersonas(opts.personaFacts);
  const pairs = opts.creatives.flatMap((c) => personas.map((p) => [c, p] as const));
  const config = getLLMConfig();
  if (!config) {
    return { scores: pairs.map(([c, p]) => mockScore(c, p)), mode: 'mock' };
  }

  const client = new HTTPLLMClient(config);
  const limit = pLimit(4);
  let anyLive = false;
  const scores = await Promise.all(
    pairs.map(([creative, persona]) =>
      limit(async () => {
        try {
          const r = await client.jsonChat<{ appealScore: number; reason: string }>({
            system: `You are "${persona}", a consumer panelist judging ad creatives for ${opts.brandName}. Score how appealing this ad is to you personally, 0-100. Respond as JSON: {"appealScore": <integer>, "reason": "<one short sentence>"}.`,
            user: `Ad copy: "${creative.copy}"\nAngle: ${creative.genome.angle}. Style: ${creative.genome.style}. Hook: "${creative.genome.hook}".`,
            maxTokens: 120,
          });
          const score = Math.round(Number(r.appealScore));
          if (!Number.isFinite(score) || typeof r.reason !== 'string' || r.reason === '') {
            throw new Error('bad panel shape');
          }
          anyLive = true;
          return {
            creativeId: creative.id,
            persona,
            appealScore: Math.max(0, Math.min(100, score)),
            reason: r.reason.slice(0, 200),
          };
        } catch {
          return mockScore(creative, persona);
        }
      }),
    ),
  );
  return { scores, mode: anyLive ? 'live' : 'mock' };
}
