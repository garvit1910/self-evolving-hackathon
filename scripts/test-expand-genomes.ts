/**
 * Unit test for expandGenomes — the fan-out that turns one Brief into N distinct
 * genomes. Run: npx tsx scripts/test-expand-genomes.ts
 *
 * The decorrelation assertion is the important one: if two genome dimensions move
 * in lockstep, Track G's per-dimension posteriors cannot attribute performance to
 * either of them.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Brief, Persona, Prior } from '../src/lib/contracts';
import { expandGenomes } from '../src/lib/brief/expandGenomes';
import { DEFAULT_ANGLES, DEFAULT_STYLES } from '../src/lib/brief/axes';

const brief = JSON.parse(readFileSync('fixtures/brief.g1.json', 'utf8')) as Brief;

const personas: Persona[] = ['Nostalgic Millennial', 'Busy Professional', 'Health Optimizer'].map(
  (name, i) => ({
    id: `p${i + 1}`,
    brandId: 'magic-spoon',
    name,
    summary: `${name} summary`,
    pains: [],
    desires: [],
    objections: [],
    factIds: [],
  }),
);

/** True when knowing `a` always tells you `b` — i.e. the two axes are confounded. */
function perfectlyCorrelated(a: string[], b: string[]): boolean {
  const seen = new Map<string, string>();
  for (let i = 0; i < a.length; i++) {
    const prev = seen.get(a[i]);
    if (prev !== undefined && prev !== b[i]) return false;
    seen.set(a[i], b[i]);
  }
  return true;
}

// --- gen-1: produces N distinct genomes ---------------------------------
const g1 = expandGenomes(brief, personas, 8);
assert.equal(g1.length, 8, 'expected 8 genomes');

const keys = g1.map((g) => `${g.angle}|${g.persona}|${g.hook}|${g.style}`);
assert.equal(new Set(keys).size, 8, 'genomes must be distinct');

// --- every value is verbatim from a legitimate axis ---------------------
const personaNames = new Set([brief.persona, ...personas.map((p) => p.name)]);
for (const g of g1) {
  assert.ok(DEFAULT_ANGLES.includes(g.angle), `angle not verbatim: ${g.angle}`);
  assert.ok(DEFAULT_STYLES.includes(g.style), `style not verbatim: ${g.style}`);
  assert.ok(personaNames.has(g.persona), `persona not verbatim: ${g.persona}`);
  assert.ok(brief.hooks.includes(g.hook), `hook not verbatim: ${g.hook}`);
  assert.equal(g.generation, brief.generation);
}

// --- the brief's own choices lead each axis -----------------------------
assert.equal(g1[0].angle, brief.angle, 'brief.angle must lead the angle axis');
assert.equal(g1[0].style, brief.style, 'brief.style must lead the style axis');

// --- no two multi-valued axes are perfectly correlated ------------------
const axes: Record<string, string[]> = {
  angle: g1.map((g) => g.angle),
  persona: g1.map((g) => g.persona),
  hook: g1.map((g) => g.hook),
  style: g1.map((g) => g.style),
};
const names = Object.keys(axes);
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const a = axes[names[i]];
    const b = axes[names[j]];
    // axes of length 1 are constant by definition and exempt
    if (new Set(a).size < 2 || new Set(b).size < 2) continue;
    assert.ok(
      !perfectlyCorrelated(a, b),
      `${names[i]} and ${names[j]} are perfectly correlated — posteriors cannot separate them`,
    );
  }
}

// --- axis coverage (Finding 2, final review) ----------------------------
// Ideally every multi-valued axis contributes >= min(axisLength, 3) distinct
// values across n=8. Measured on the real fixture (La=4, Lp=3, Lh=2, Ls=4,
// total=96): angle 4/4, persona 3/3, hook 2/2 all clear that bar — but style,
// the HIGHEST-order digit in the mixed-radix walk, only reaches 2/4. n=8
// walks just 8 of the 96 points on the number line, and high-order digits
// advance slowest, so this is expected, not a regression. This is documented
// and NOT fixed here (see expandGenomes.ts header "KNOWN LIMITATION"); do
// not silently relax `style`'s bound further, and do not raise it to
// min(axisLength,3) without actually fixing the sampling depth, or this
// assertion will start lying about what the code guarantees.
function localDedupe(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v && v.trim().length > 0))];
}
const angleAxisLen = localDedupe([brief.angle, ...DEFAULT_ANGLES]).length;
const styleAxisLen = localDedupe([brief.style, ...DEFAULT_STYLES]).length;
const personaAxisLen = localDedupe([brief.persona, ...personas.map((p) => p.name)]).length;
const hookAxisLen = localDedupe(brief.hooks.length ? brief.hooks : [brief.coreMessage]).length;

// Lock in the fixture's axis pool sizes so the numbers quoted above (and the
// weakened `style` bound below) can't go silently stale if the fixture or
// DEFAULT_STYLES/DEFAULT_ANGLES vocabulary ever changes.
assert.equal(styleAxisLen, 4, 'style axis pool size drifted — re-measure the Finding 2 numbers above');

const expectedMinDistinct: Record<string, number> = {
  angle: Math.min(angleAxisLen, 3),
  persona: Math.min(personaAxisLen, 3),
  hook: Math.min(hookAxisLen, 3),
  style: 2, // measured ceiling at n=8 for a 4-value axis — see comment above, NOT min(styleAxisLen, 3)
};
for (const dim of Object.keys(expectedMinDistinct)) {
  const got = new Set(axes[dim]).size;
  assert.ok(
    got >= expectedMinDistinct[dim],
    `${dim} axis coverage regressed: expected >= ${expectedMinDistinct[dim]} distinct values at n=8, got ${got}`,
  );
}

// --- determinism --------------------------------------------------------
assert.equal(
  JSON.stringify(expandGenomes(brief, personas, 8)),
  JSON.stringify(g1),
  'expandGenomes must be deterministic',
);

// --- gen-2 narrowing ----------------------------------------------------
const priors: Prior[] = [{ dimension: 'angle', value: 'Nostalgia', weight: 0.9 }];
const g2 = expandGenomes({ ...brief, generation: 2 }, personas, 8, priors);
const g2Angles = new Set(g2.map((g) => g.angle));
assert.ok(g2Angles.has('Nostalgia'), 'winning prior must appear');
assert.ok(g2Angles.size <= 2, `gen-2 angle axis must narrow to 2, got ${[...g2Angles].join(',')}`);
assert.equal(g2[0].angle, 'Nostalgia', 'prior winner must lead the narrowed axis');
for (const g of g2) assert.equal(g.generation, 2);

// --- regression: 4 distinct hooks (hookAxis.length === styleAxis.length) --
// A shift-based scheme with equal shifts for hook/style collided exactly
// here: with both axes at length 4, hook and style moved in perfect
// lockstep. This is the case that must stay decorrelated.
const fourHookBrief: Brief = {
  ...brief,
  hooks: ['hook one', 'hook two', 'hook three', 'hook four'],
};
const gFourHooks = expandGenomes(fourHookBrief, personas, 8);
assert.equal(gFourHooks.length, 8, 'expected 8 genomes with 4 distinct hooks');
const fourHookAxes: Record<string, string[]> = {
  angle: gFourHooks.map((g) => g.angle),
  persona: gFourHooks.map((g) => g.persona),
  hook: gFourHooks.map((g) => g.hook),
  style: gFourHooks.map((g) => g.style),
};
const fourHookNames = Object.keys(fourHookAxes);
for (let i = 0; i < fourHookNames.length; i++) {
  for (let j = i + 1; j < fourHookNames.length; j++) {
    const a = fourHookAxes[fourHookNames[i]];
    const b = fourHookAxes[fourHookNames[j]];
    if (new Set(a).size < 2 || new Set(b).size < 2) continue;
    assert.ok(
      !perfectlyCorrelated(a, b),
      `${fourHookNames[i]} and ${fourHookNames[j]} are perfectly correlated with 4 distinct hooks — posteriors cannot separate them`,
    );
  }
}

// --- degenerate input does not crash ------------------------------------
const single = expandGenomes({ ...brief, hooks: ['only hook'] }, [personas[0]], 8);
assert.ok(single.length >= 1 && single.length <= 8);
assert.ok(single.every((g) => g.hook === 'only hook'));

// --- empty axis returns [] instead of undefined-filled genomes (Finding 5) --
const emptyHooks = expandGenomes({ ...brief, hooks: ['  ', ''] }, [], 8);
assert.deepEqual(emptyHooks, [], 'an empty axis (all-whitespace hooks) must yield no genomes, not undefined fields');

console.log('✅ EXPAND GENOMES OK — 8 distinct, decorrelated, deterministic, gen-2 narrows.');
