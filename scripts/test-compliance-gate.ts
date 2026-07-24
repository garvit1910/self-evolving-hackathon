/**
 * Unit test for the prohibited-claims gate.
 * Run: npx tsx scripts/test-compliance-gate.ts
 */
import assert from 'node:assert/strict';
import { findViolations, screenCreatives } from '../src/lib/creative/complianceGate';
import { distillBannedTerms, FLOOR_TERMS } from '../src/lib/creative/bannedTerms';
import { createMockLLM } from '../src/lib/adapters/mocks';

// --- matching is case- and whitespace-insensitive -----------------------
assert.deepEqual(findViolations('Clinically  PROVEN to work', ['clinically proven']), [
  'clinically proven',
]);
assert.deepEqual(findViolations('A gentle morning bowl', ['clinically proven']), []);

// --- multiple hits are all reported ------------------------------------
assert.deepEqual(
  findViolations('Guaranteed to cure your cravings', ['guaranteed', 'cure']).sort(),
  ['cure', 'guaranteed'],
);

// --- empty banned list means nothing is flagged ------------------------
assert.deepEqual(findViolations('anything at all', []), []);

// --- screenCreatives reports only violators, by index ------------------
const violations = screenCreatives(
  ['clean copy', 'this will cure you', 'also clean'],
  ['cure'],
);
assert.equal(violations.length, 1);
assert.equal(violations[0].index, 1);
assert.deepEqual(violations[0].terms, ['cure']);

// --- distillation: floor list always applies ---------------------------

// The mock LLM does not recognise the terms schema and returns facts instead,
// so `terms` comes back undefined. This is exactly the failure mode the floor
// list exists to cover: a gate that appears to pass while checking nothing.
const mockTerms = await distillBannedTerms(
  ['Avoid absolute health claims; "keto-friendly" allowed, "cures" is not.'],
  'ctx_test1',
  createMockLLM(),
);
for (const floor of FLOOR_TERMS) {
  assert.ok(mockTerms.includes(floor), `floor term missing: ${floor}`);
}
assert.ok(findViolations('this will cure you', mockTerms).length > 0, 'floor list must fire');

// --- a throwing LLM still yields the floor list ------------------------
const throwingLLM = {
  async extract<T>(): Promise<T> {
    throw new Error('LLM down');
  },
  async complete(): Promise<string> {
    return '';
  },
};
const afterThrow = await distillBannedTerms(['some prose'], 'ctx_test2', throwingLLM);
assert.deepEqual(afterThrow, FLOOR_TERMS);

// --- distilled terms are merged in, deduped, lowercased ----------------
const distillingLLM = {
  async extract<T>(): Promise<T> {
    return { terms: ['Cures', '  Sugar-Free  ', ''] } as unknown as T;
  },
  async complete(): Promise<string> {
    return '';
  },
};
const merged = await distillBannedTerms(['prose'], 'ctx_test3', distillingLLM);
assert.ok(merged.includes('sugar-free'), 'distilled term must be normalized and included');
assert.equal(merged.filter((t) => t === 'cures').length, 1, 'must dedupe against floor list');

// --- results are cached per contextHash --------------------------------
let calls = 0;
const countingLLM = {
  async extract<T>(): Promise<T> {
    calls++;
    return { terms: ['zzz'] } as unknown as T;
  },
  async complete(): Promise<string> {
    return '';
  },
};
await distillBannedTerms(['prose'], 'ctx_cache', countingLLM);
await distillBannedTerms(['prose'], 'ctx_cache', countingLLM);
assert.equal(calls, 1, 'second call with same contextHash must hit the cache');

console.log('✅ COMPLIANCE GATE OK — screening catches banned terms by index.');
