/**
 * Unit test for the prohibited-claims gate.
 * Run: npx tsx scripts/test-compliance-gate.ts
 */
import assert from 'node:assert/strict';
import { findViolations, screenCreatives } from '../src/lib/creative/complianceGate';

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

console.log('✅ COMPLIANCE GATE OK — screening catches banned terms by index.');
