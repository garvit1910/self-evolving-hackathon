import type { Fact } from '../contracts';
import { getContextStore } from '../context';
import { getStore } from '../store';

const SECTIONS = new Set<Fact['section']>([
  'positioning',
  'value_prop',
  'voice',
  'compliance',
  'persona',
  'market_prior',
]);
const ORIGINS = new Set<Fact['origin']>(['research', 'performance_loop']);

/**
 * Validates inbound facts against the contract. brandId is always forced to the
 * route's brand; malformed items are dropped and counted, never rejected as a
 * whole batch — the swarm keeps its good facts even if one is bad.
 */
export function sanitizeFacts(brandId: string, input: unknown): { facts: Fact[]; dropped: number } {
  const raw = Array.isArray(input) ? input : (input as { facts?: unknown[] } | null)?.facts;
  if (!Array.isArray(raw)) return { facts: [], dropped: 0 };
  const existingCount = getStore().getFacts(brandId).length;
  const facts: Fact[] = [];
  let dropped = 0;
  for (const item of raw) {
    const f = item as Partial<Fact>;
    if (
      typeof f.statement !== 'string' ||
      f.statement.trim() === '' ||
      !SECTIONS.has(f.section as Fact['section'])
    ) {
      dropped++;
      continue;
    }
    facts.push({
      id:
        typeof f.id === 'string' && f.id
          ? f.id
          : `fact-${String(existingCount + facts.length + 1).padStart(2, '0')}`,
      brandId,
      section: f.section as Fact['section'],
      statement: f.statement.trim(),
      sourceUrl: typeof f.sourceUrl === 'string' ? f.sourceUrl : undefined,
      sourceQuote: typeof f.sourceQuote === 'string' ? f.sourceQuote : undefined,
      confidence:
        typeof f.confidence === 'number' ? Math.min(1, Math.max(0, f.confidence)) : 0.5,
      origin: ORIGINS.has(f.origin as Fact['origin']) ? (f.origin as Fact['origin']) : 'research',
    });
  }
  return { facts, dropped };
}

export async function ingestFactsService(
  brandId: string,
  input: unknown,
): Promise<{ accepted: number; dropped: number; version: number; hash: string }> {
  const { facts, dropped } = sanitizeFacts(brandId, input);
  const { version, hash } = await getContextStore().ingestFacts(brandId, facts);
  return { accepted: facts.length, dropped, version, hash };
}
