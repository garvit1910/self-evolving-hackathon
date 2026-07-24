/**
 * Prohibited-claims gate — pure, deterministic, no network, no LLM.
 * Case- and whitespace-insensitive substring matching, reusing the same
 * normalize() approach the Analyst uses for verbatim-quote grounding.
 */

export type Violation = { index: number; terms: string[] };

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Banned terms present in `copy`, returned in bannedTerms order. */
export function findViolations(copy: string, bannedTerms: string[]): string[] {
  const haystack = normalize(copy);
  return bannedTerms.filter((t) => {
    const needle = normalize(t);
    return needle.length > 0 && haystack.includes(needle);
  });
}

/** Screen a batch of copies; only violators are returned, keyed by array index. */
export function screenCreatives(copies: string[], bannedTerms: string[]): Violation[] {
  return copies
    .map((copy, index) => ({ index, terms: findViolations(copy, bannedTerms) }))
    .filter((v) => v.terms.length > 0);
}
