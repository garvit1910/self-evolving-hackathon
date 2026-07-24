/**
 * Unit test for expandGenomes — the fan-out that turns one Brief into N distinct
 * genomes. Run: npx tsx scripts/test-expand-genomes.ts
 *
 * The decorrelation assertion is the important one: if two genome dimensions move
 * in lockstep, Track G's per-dimension posteriors cannot attribute performance to
 * either of them.
 *
 * PINNED DISTRIBUTION (updated DELIBERATELY at merge — see commit message):
 * under the per-axis wrap-offset walk with the unified fixture (La=5, Lp=3,
 * Lh=4, Ls=2), coverage at n=8 is angle 5/5, persona 3/3, hook 4/4,
 * style 2/2 — every axis reaches full coverage. The retired mixed-radix walk
 * measured angle 4/4, persona 3/3, hook 2/2, style 2/4 on the old fixture,
 * and under the unified vocabulary left style CONSTANT (1/2) at n=8.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Brief, Persona, Prior } from '../src/lib/contracts';
import { expandGenomes } from '../src/lib/brief/expandGenomes';
import { DEFAULT_ANGLES, DEFAULT_STYLES } from '../src/lib/brief/axes';

const brief = JSON.parse(readFileSync('fixtures/brief.g1.json', 'utf8')) as Brief;
const briefHooks = brief.hooks ?? [];

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
// The lead brief's own angle may be a competitive-fact slug outside
// DEFAULT_ANGLES; it leads the axis, so it is legitimate too.
const legitAngles = new Set([brief.angle, ...DEFAULT_ANGLES]);
const legitStyles = new Set([brief.style, ...DEFAULT_STYLES]);
const personaNames = new Set([brief.persona, ...personas.map((p) => p.name)]);
for (const g of g1) {
  assert.ok(legitAngles.has(g.angle), `angle not verbatim: ${g.angle}`);
  assert.ok(legitStyles.has(g.style), `style not verbatim: ${g.style}`);
  assert.ok(personaNames.has(g.persona), `persona not verbatim: ${g.persona}`);
  assert.ok(briefHooks.includes(g.hook), `hook not verbatim: ${g.hook}`);
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

// --- axis coverage ------------------------------------------------------
// The wrap-offset walk guarantees full per-axis coverage once n >= axis
// length; assert the strong bound min(axisLength, 3) for EVERY axis — the
// weakened style bound the mixed-radix walk needed is gone.
function localDedupe(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v && v.trim().length > 0))];
}
const angleAxisLen = localDedupe([brief.angle, ...DEFAULT_ANGLES]).length;
const styleAxisLen = localDedupe([brief.style, ...DEFAULT_STYLES]).length;
const personaAxisLen = localDedupe([brief.persona, ...personas.map((p) => p.name)]).length;
const hookAxisLen = localDedupe(briefHooks.length ? briefHooks : [brief.coreMessage]).length;

// Lock in the fixture's axis pool sizes so the numbers quoted above can't go
// silently stale if the fixture or the axes.ts vocabulary ever changes.
assert.equal(angleAxisLen, 5, 'angle axis pool size drifted — re-measure the pinned numbers above');
assert.equal(styleAxisLen, 2, 'style axis pool size drifted — re-measure the pinned numbers above');
assert.equal(hookAxisLen, 4, 'hook axis pool size drifted — re-measure the pinned numbers above');

const expectedMinDistinct: Record<string, number> = {
  angle: Math.min(angleAxisLen, 3),
  persona: Math.min(personaAxisLen, 3),
  hook: Math.min(hookAxisLen, 3),
  style: Math.min(styleAxisLen, 3),
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

// --- gen-2: an angle prior collapses the axis (exploitation, verbatim) ---
const priors: Prior[] = [{ dimension: 'angle', value: 'nostalgia-reboot', weight: 0.9 }];
const g2 = expandGenomes({ ...brief, generation: 2 }, personas, 8, priors);
const g2Angles = new Set(g2.map((g) => g.angle));
assert.deepEqual([...g2Angles], ['nostalgia-reboot'], 'gen-2 must ride the angle prior VERBATIM on every genome');
assert.equal(g2[0].angle, 'nostalgia-reboot', 'prior winner must lead');
for (const g of g2) assert.equal(g.generation, 2);

// --- gen-2: persona/hook/style priors LEAD their axes without collapsing --
const leadPriors: Prior[] = [
  { dimension: 'hook', value: 'Remember Saturday mornings?', weight: 0.8 },
];
const gLead = expandGenomes({ ...brief, generation: 2 }, personas, 8, leadPriors);
assert.equal(gLead[0].hook, 'Remember Saturday mornings?', 'hook prior must lead the axis');
assert.ok(new Set(gLead.map((g) => g.hook)).size > 1, 'non-angle prior axes keep exploring');

// --- regression: 4 distinct hooks (hookAxis.length === styleAxis.length × 2) --
// The shift-only scheme collided when two axes shared a length; the wrap
// offsets must keep same-length axes decorrelated too.
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

// --- empty axis returns [] instead of undefined-filled genomes ----------
const emptyHooks = expandGenomes({ ...brief, hooks: ['  ', ''] }, [], 8);
assert.deepEqual(emptyHooks, [], 'an empty axis (all-whitespace hooks) must yield no genomes, not undefined fields');

console.log('✅ EXPAND GENOMES OK — 8 distinct, decorrelated, deterministic, full axis coverage, gen-2 exploits.');
