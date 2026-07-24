/**
 * Banned-term sourcing for the prohibited-claims gate.
 *
 * brief.compliance holds PROSE ("Avoid absolute health claims; keto-friendly
 * allowed, cures is not"), which a regex cannot mechanically turn into a term
 * list. One LLM call distills it, cached per contextHash since compliance facts
 * only change when the context does.
 *
 * The distilled list is ALWAYS unioned with FLOOR_TERMS. That is the mitigation
 * for the distiller's main failure mode: an empty or errored response would
 * otherwise turn the gate into a silent no-op, and a gate that appears to pass
 * while checking nothing is worse than no gate at all.
 */

import type { LLM } from '@/lib/adapters/interfaces';

/** Universally prohibited ad claims. Non-negotiable — never filtered out. */
export const FLOOR_TERMS = [
  'cure',
  'cures',
  'guaranteed',
  'clinically proven',
  'fda approved',
  'miracle',
  '100% safe',
  'risk-free',
  'no side effects',
  'doctor recommended',
];

const SCHEMA_HINT = '{ terms: string[] }';

const cache = new Map<string, string[]>();

function buildPrompt(compliance: string[]): string {
  return [
    'You are a advertising compliance analyst. Below are compliance rules for a brand,',
    'written as prose. Extract the specific WORDS AND PHRASES that must NOT appear in ad',
    'copy. Return only the forbidden terms themselves — not the rules, not explanations,',
    'and not terms the rules explicitly ALLOW.',
    '',
    ...compliance.map((c) => `- ${c}`),
  ].join('\n');
}

export async function distillBannedTerms(
  compliance: string[],
  contextHash: string,
  llm: LLM,
): Promise<string[]> {
  const cached = cache.get(contextHash);
  if (cached) return cached;

  let distilled: string[] = [];
  if (compliance.length > 0) {
    try {
      const res = await llm.extract<{ terms?: string[] }>(buildPrompt(compliance), SCHEMA_HINT);
      distilled = (res?.terms ?? [])
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0);
    } catch {
      // Swallowed deliberately — the floor list below is the safety net.
      distilled = [];
    }
  }

  const merged = [...new Set([...FLOOR_TERMS, ...distilled])];
  cache.set(contextHash, merged);
  return merged;
}
