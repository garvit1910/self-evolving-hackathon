# Creative Engine (Phase 2, Track A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn one `Brief` into 6–8 persisted `Creative`s with distinct genomes, generated copy, Gemini imagery, a prohibited-claims gate, and a governance publish check.

**Architecture:** A new orchestrator `creativeEngine.ts` mirrors the existing `researchSwarm.ts` pattern (adapters injected, progress posted to a Band room, governance gates publish). It composes five small units: a pure `expandGenomes` fan-out, an LLM-backed banned-term distiller, a pure compliance screener, a batched copywriter, and an image renderer. Persistence goes behind a narrow `CreativeStore` interface with a filesystem implementation, so the missing Drizzle/Supabase schema does not block this phase.

**Tech Stack:** TypeScript, Next.js 16, `tsx` for scripts, `node:assert/strict` for assertions. No test runner and no new npm dependencies.

## Global Constraints

- **No new npm dependencies.** Everything uses Node builtins or what is already in `package.json`.
- **`angle` and `persona` strings are attribution keys — NEVER rephrase them** anywhere downstream (`src/lib/contracts/index.ts` header).
- **Do not modify `src/lib/contracts/index.ts`.** Contracts are frozen; they are the seam with Track G.
- **Mock is the default resting state.** Every unit must work fully offline with `createMockAdapters()`. Real adapters are opt-in via `USE_REAL_*=1`.
- Import alias is `@/` → `src/` for files under `src/`; scripts in `scripts/` use relative `../src/...` imports (see `scripts/smoke.ts`).
- Tests are standalone scripts run with `npx tsx scripts/<name>.ts`, following `scripts/test-research-swarm.ts`. Each ends by printing a line starting with `✅`.
- Creative IDs are `` `${runId}-c${n}` `` with n starting at 1. `publishedAdId` is `` `sim-${id}` ``.
- Every file starts with a `/** ... */` block comment explaining its purpose, matching the existing style in `src/lib/`.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/brief/axes.ts` | Create | Shared `DEFAULT_ANGLES` / `DEFAULT_STYLES` vocabulary |
| `src/lib/brief/composeBrief.ts` | Modify | Import axes instead of declaring them locally |
| `src/lib/brief/expandGenomes.ts` | Create | Brief + personas + priors → N distinct `Genome[]` |
| `src/lib/creative/complianceGate.ts` | Create | Pure copy-vs-banned-terms screening |
| `src/lib/creative/bannedTerms.ts` | Create | Compliance prose → term list ∪ floor list, cached |
| `src/lib/store/creativeStore.ts` | Create | `CreativeStore` interface + filesystem implementation |
| `src/lib/agents/copywriter.ts` | Create | Batched copy generation + batched repair pass |
| `src/lib/agents/imagesmith.ts` | Create | Genome → image prompt → Gemini → persisted image URL |
| `src/lib/adapters/real/gemini.ts` | Modify | Implement reference-image conditioning (existing TODO) |
| `src/lib/adapters/mocks.ts` | Modify | Point fallback images at files that actually exist |
| `src/lib/agents/creativeEngine.ts` | Create | Orchestrator: wires all of the above, Band feed, governance gate |
| `public/fixtures/ad-{1..4}.svg` | Create | Placeholder creative images for mock mode |
| `scripts/test-expand-genomes.ts` | Create | Unit test for the fan-out |
| `scripts/test-compliance-gate.ts` | Create | Unit test for screening + floor list |
| `scripts/test-creative-engine.ts` | Create | End-to-end mock-mode integration test |
| `.gitignore` | Modify | Ignore `.runs/` |
| `package.json` | Modify | Add test scripts |

**Spec deviation, deliberate:** the spec says commit four placeholder **PNGs**. This plan uses **SVGs** instead — they are authorable as plain text (no binary blobs in a plan, no PNG encoder), render identically in an `<img>` tag, and can carry a visible label. `mocks.ts` is updated to match.

---

### Task 1: Shared axes + `expandGenomes`

The load-bearing unit. Everything else consumes its output.

**Files:**
- Create: `src/lib/brief/axes.ts`
- Create: `src/lib/brief/expandGenomes.ts`
- Modify: `src/lib/brief/composeBrief.ts:13-14` (remove local consts, import instead)
- Test: `scripts/test-expand-genomes.ts`
- Modify: `package.json` (add `test:genomes` script)

**Interfaces:**
- Consumes: `Brief`, `Persona`, `Genome`, `Prior` from `@/lib/contracts` (all already defined).
- Produces:
  - `DEFAULT_ANGLES: string[]`, `DEFAULT_STYLES: string[]` from `@/lib/brief/axes`
  - `expandGenomes(brief: Brief, personas: Persona[], n: number, priors?: Prior[]): Genome[]`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-expand-genomes.ts`:

```ts
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

// --- degenerate input does not crash ------------------------------------
const single = expandGenomes({ ...brief, hooks: ['only hook'] }, [personas[0]], 8);
assert.ok(single.length >= 1 && single.length <= 8);
assert.ok(single.every((g) => g.hook === 'only hook'));

console.log('✅ EXPAND GENOMES OK — 8 distinct, decorrelated, deterministic, gen-2 narrows.');
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx scripts/test-expand-genomes.ts
```

Expected: FAIL — `Cannot find module '../src/lib/brief/expandGenomes'`.

- [ ] **Step 3: Create the shared axes module**

Create `src/lib/brief/axes.ts`:

```ts
/**
 * Shared genome axis vocabulary. composeBrief picks ONE value per axis;
 * expandGenomes fans out across all of them. Both must read from this single
 * list — `angle` and `style` are attribution keys, and two drifting copies of
 * the vocabulary would silently corrupt attribution.
 */

export const DEFAULT_ANGLES = ['Comparison', 'Nostalgia', 'Health', 'Convenience'];
export const DEFAULT_STYLES = ['bold-flatlay', 'lifestyle', 'macro-texture', 'retro-pop'];
```

- [ ] **Step 4: Point `composeBrief` at the shared axes**

In `src/lib/brief/composeBrief.ts`, delete these two lines:

```ts
const DEFAULT_ANGLES = ['Comparison', 'Nostalgia', 'Health', 'Convenience'];
const DEFAULT_STYLES = ['bold-flatlay', 'lifestyle', 'macro-texture', 'retro-pop'];
```

and add below the existing `import type` line:

```ts
import { DEFAULT_ANGLES, DEFAULT_STYLES } from './axes';
```

This is behavior-neutral — same values, same order.

- [ ] **Step 5: Implement `expandGenomes`**

Create `src/lib/brief/expandGenomes.ts`:

```ts
/**
 * expandGenomes — deterministic fan-out, NO network, NO LLM.
 *
 * composeBrief emits ONE Brief (one angle, one persona, one style). The bandit
 * needs 6-8 creatives whose genomes differ, or per-dimension posteriors have
 * nothing to compare. This is that fan-out layer.
 *
 * Indexing uses a SHIFTED round-robin, not a plain one. Plain `axis[i % len]`
 * perfectly confounds any two axes of equal length: with 4 angles and 4 styles
 * across 8 creatives, angle and style would move in lockstep and no downstream
 * math could tell which drove performance. Each axis therefore advances by
 * `floor(i / len) * SHIFTS[dimension]` on wrap, with a DIFFERENT shift per
 * dimension — a shared shift would leave two same-length axes identical, which
 * is the same bug wearing a disguise.
 *
 * Gen-2: for each dimension with a Prior, the axis truncates to 2 values
 * (winner first) so the set concentrates on what won without collapsing to N
 * identical genomes.
 */

import type { Brief, Genome, Persona, Prior } from '@/lib/contracts';
import { DEFAULT_ANGLES, DEFAULT_STYLES } from './axes';

/** Put the brief's own choice at position 0, then the rest of the pool. */
function leadFirst(lead: string | undefined, pool: string[]): string[] {
  if (!lead) return [...pool];
  return [lead, ...pool.filter((v) => v !== lead)];
}

function dedupe(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v && v.trim().length > 0))];
}

/**
 * Gen-2 narrowing: winner first, then the axis's own gen-1 lead. If those are
 * the same value, the next unused value fills slot 2 so the axis never
 * degenerates to length 1.
 */
function narrow(axis: string[], priors: Prior[], dimension: Prior['dimension']): string[] {
  const winner = priors
    .filter((p) => p.dimension === dimension)
    .sort((a, b) => b.weight - a.weight)[0];
  if (!winner) return axis;
  const second = axis.find((v) => v !== winner.value);
  return second ? [winner.value, second] : [winner.value];
}

/**
 * Per-dimension shift multipliers. A shared shift is NOT enough: two axes of the
 * same length with the same shift produce identical index sequences, so with 4
 * angles and 4 styles the two would still be perfectly confounded. These values
 * are chosen so that does not happen for any axis length 2-4, and
 * scripts/test-expand-genomes.ts asserts it empirically rather than on trust.
 */
const SHIFTS: Record<Prior['dimension'], number> = {
  angle: 1,
  persona: 2,
  hook: 3,
  style: 3,
};

/** Shifted round-robin — see the file header for why the shift matters. */
function pick(axis: string[], i: number, shift: number): string {
  const len = axis.length;
  // A shift that is a multiple of len degenerates to a plain round-robin.
  const s = shift % len === 0 ? 1 : shift;
  return axis[(i + Math.floor(i / len) * s) % len];
}

export function expandGenomes(
  brief: Brief,
  personas: Persona[],
  n: number,
  priors: Prior[] = [],
): Genome[] {
  const angleAxis = narrow(dedupe(leadFirst(brief.angle, DEFAULT_ANGLES)), priors, 'angle');
  const styleAxis = narrow(dedupe(leadFirst(brief.style, DEFAULT_STYLES)), priors, 'style');
  const personaAxis = narrow(
    dedupe([brief.persona, ...personas.map((p) => p.name)]),
    priors,
    'persona',
  );
  const hookAxis = narrow(
    dedupe(brief.hooks.length ? brief.hooks : [brief.coreMessage]),
    priors,
    'hook',
  );

  const out: Genome[] = [];
  const seen = new Set<string>();

  // Bounded scan: if the axes cannot yield n distinct combinations, return
  // however many exist rather than looping forever.
  for (let i = 0; out.length < n && i < n * 4; i++) {
    const genome: Genome = {
      angle: pick(angleAxis, i, SHIFTS.angle),
      persona: pick(personaAxis, i, SHIFTS.persona),
      hook: pick(hookAxis, i, SHIFTS.hook),
      style: pick(styleAxis, i, SHIFTS.style),
      generation: brief.generation,
    };
    const key = `${genome.angle}|${genome.persona}|${genome.hook}|${genome.style}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(genome);
  }

  return out;
}
```

- [ ] **Step 6: Add the npm script**

In `package.json`, add to `"scripts"`:

```json
"test:genomes": "tsx scripts/test-expand-genomes.ts"
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
npm run test:genomes
npx tsc --noEmit
npm run smoke
```

Expected: `✅ EXPAND GENOMES OK`, no type errors, and smoke still passes (the `composeBrief` refactor was behavior-neutral).

- [ ] **Step 8: Commit**

```bash
git add src/lib/brief/axes.ts src/lib/brief/expandGenomes.ts src/lib/brief/composeBrief.ts scripts/test-expand-genomes.ts package.json
git commit -m "feat: add expandGenomes fan-out with decorrelated axis sampling"
```

---

### Task 2: Compliance gate (pure screening)

**Files:**
- Create: `src/lib/creative/complianceGate.ts`
- Test: covered by `scripts/test-compliance-gate.ts` in Task 3 (this task's code is exercised there; run the assertions inline first per Step 2 below)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type Violation = { index: number; terms: string[] }`
  - `findViolations(copy: string, bannedTerms: string[]): string[]`
  - `screenCreatives(copies: string[], bannedTerms: string[]): Violation[]`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-compliance-gate.ts` with the screening assertions only (Task 3 appends the distillation assertions to this same file):

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx scripts/test-compliance-gate.ts
```

Expected: FAIL — `Cannot find module '../src/lib/creative/complianceGate'`.

- [ ] **Step 3: Implement the gate**

Create `src/lib/creative/complianceGate.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx tsx scripts/test-compliance-gate.ts
npx tsc --noEmit
```

Expected: `✅ COMPLIANCE GATE OK`, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/creative/complianceGate.ts scripts/test-compliance-gate.ts
git commit -m "feat: add pure prohibited-claims screening"
```

---

### Task 3: Banned-term distillation with floor list

**Files:**
- Create: `src/lib/creative/bannedTerms.ts`
- Modify: `scripts/test-compliance-gate.ts` (append distillation assertions)
- Modify: `package.json` (add `test:compliance` script)

**Interfaces:**
- Consumes: `LLM` from `@/lib/adapters/interfaces`.
- Produces:
  - `FLOOR_TERMS: string[]`
  - `distillBannedTerms(compliance: string[], contextHash: string, llm: LLM): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-compliance-gate.ts`, **above** the final `console.log` line:

```ts
// --- distillation: floor list always applies ---------------------------
import { distillBannedTerms, FLOOR_TERMS } from '../src/lib/creative/bannedTerms';
import { createMockLLM } from '../src/lib/adapters/mocks';

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
```

Move the two `import` statements to the top of the file with the others — top-level `import` cannot appear mid-file. Top-level `await` is fine: `tsconfig.json` targets ESM and `tsx` supports it.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx scripts/test-compliance-gate.ts
```

Expected: FAIL — `Cannot find module '../src/lib/creative/bannedTerms'`.

- [ ] **Step 3: Implement the distiller**

Create `src/lib/creative/bannedTerms.ts`:

```ts
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
```

- [ ] **Step 4: Add the npm script**

In `package.json`, add to `"scripts"`:

```json
"test:compliance": "tsx scripts/test-compliance-gate.ts"
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm run test:compliance
npx tsc --noEmit
```

Expected: `✅ COMPLIANCE GATE OK`, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/creative/bannedTerms.ts scripts/test-compliance-gate.ts package.json
git commit -m "feat: distill banned terms from compliance prose with floor-list fallback"
```

---

### Task 4: `CreativeStore` interface + filesystem backend

**Files:**
- Create: `src/lib/store/creativeStore.ts`
- Modify: `.gitignore` (add `.runs/`)

**Interfaces:**
- Consumes: `Creative` from `@/lib/contracts`.
- Produces:
  - `interface CreativeStore { saveRun(runId, creatives): Promise<void>; getRun(runId): Promise<Creative[] | null>; saveImage(runId, id, data: Buffer): Promise<string> }`
  - `createFileCreativeStore(root?: string): CreativeStore`

This task has no dedicated test script — it is exercised end-to-end by Task 7, which asserts the files land on disk. Splitting a filesystem-only wrapper into its own test harness would test `node:fs`, not our logic.

- [ ] **Step 1: Implement the store**

Create `src/lib/store/creativeStore.ts`:

```ts
/**
 * CreativeStore — the persistence seam. Phase 2 needs to persist creatives, but
 * the shared Drizzle/Supabase schema is Track-G-coupled and does not exist yet.
 * This narrow interface unblocks generation now; a Supabase implementation slots
 * in behind the same three methods later without touching the engine.
 *
 * Images go under public/runs/ so Next serves them directly. Metadata goes under
 * .runs/ (gitignored) so generated JSON never pollutes the repo.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Creative } from '@/lib/contracts';

export interface CreativeStore {
  saveRun(runId: string, creatives: Creative[]): Promise<void>;
  getRun(runId: string): Promise<Creative[] | null>;
  /** Persists image bytes; returns the public URL to store on Creative.imageUrl. */
  saveImage(runId: string, id: string, data: Buffer): Promise<string>;
}

export function createFileCreativeStore(root: string = process.cwd()): CreativeStore {
  const imageDir = (runId: string) => join(root, 'public', 'runs', runId);
  const metaDir = (runId: string) => join(root, '.runs', runId);

  return {
    async saveImage(runId, id, data) {
      const dir = imageDir(runId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${id}.png`), data);
      return `/runs/${runId}/${id}.png`;
    },

    async saveRun(runId, creatives) {
      const dir = metaDir(runId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'creatives.json'), JSON.stringify(creatives, null, 2));
    },

    async getRun(runId) {
      const path = join(metaDir(runId), 'creatives.json');
      if (!existsSync(path)) return null;
      return JSON.parse(await readFile(path, 'utf8')) as Creative[];
    },
  };
}
```

- [ ] **Step 2: Ignore generated metadata**

Append to `.gitignore`, under the `# hackathon additions` section:

```
# generated run metadata (images under public/runs/ ARE committed for the golden run)
.runs/
```

- [ ] **Step 3: Verify it type-checks**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/store/creativeStore.ts .gitignore
git commit -m "feat: add CreativeStore seam with filesystem backend"
```

---

### Task 5: Copywriter (batched generation + repair)

**Files:**
- Create: `src/lib/agents/copywriter.ts`

**Interfaces:**
- Consumes: `expandGenomes` output (`Genome[]`) from Task 1; `LLM`, `Feed` from `@/lib/adapters/interfaces`; `Violation` from Task 2.
- Produces:
  - `writeCopy(brief: Brief, genomes: Genome[], personas: Persona[], bannedTerms: string[], llm: LLM, feed: Feed, room: string): Promise<string[]>` — one copy per genome, index-aligned, never short.
  - `repairCopy(brief: Brief, genomes: Genome[], personas: Persona[], violations: Violation[], bannedTerms: string[], llm: LLM, feed: Feed, room: string): Promise<Map<number, string>>`

Exercised end-to-end by Task 7.

- [ ] **Step 1: Implement the copywriter**

Create `src/lib/agents/copywriter.ts`:

```ts
/**
 * Copywriter — generates ad copy for a whole genome set in ONE batched Pioneer
 * call rather than one call per creative: a single tape entry, a single failure
 * mode, and roughly 8x cheaper.
 *
 * The banned-term avoid-list is stated up front so most violations never occur;
 * repairCopy is the second chance for the ones that slip through.
 *
 * The return value is ALWAYS index-aligned with `genomes` and never short — a
 * missing index falls back deterministically to coreMessage + hook, so a partial
 * LLM response degrades one creative instead of derailing the run.
 */

import type { Brief, Genome, Persona } from '@/lib/contracts';
import type { Feed, LLM } from '../adapters/interfaces';
import type { Violation } from '../creative/complianceGate';

type RawCopy = { index: number; copy: string };

const SCHEMA_HINT = '{ copies: { index: number, copy: string }[] }';

function personaBlock(name: string, personas: Persona[]): string {
  const p = personas.find((x) => x.name === name);
  if (!p) return `Audience: ${name}.`;
  return [
    `Audience: ${p.name} — ${p.summary}`,
    p.pains.length ? `  pains: ${p.pains.join('; ')}` : '',
    p.desires.length ? `  desires: ${p.desires.join('; ')}` : '',
    p.objections.length ? `  objections: ${p.objections.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function genomeBlock(g: Genome, i: number, personas: Persona[]): string {
  return [
    `[${i}] angle: ${g.angle} | style: ${g.style}`,
    `    hook: ${g.hook}`,
    `    ${personaBlock(g.persona, personas).split('\n').join('\n    ')}`,
  ].join('\n');
}

function header(brief: Brief, bannedTerms: string[]): string[] {
  return [
    `Core message: ${brief.coreMessage}`,
    `Call to action: ${brief.cta}`,
    brief.compliance.length ? `Compliance rules: ${brief.compliance.join(' ')}` : '',
    `NEVER use these words or phrases: ${bannedTerms.join(', ')}.`,
  ].filter(Boolean);
}

/** Deterministic fallback so the returned array is never short. */
function fallbackCopy(brief: Brief, g: Genome): string {
  return `${g.hook} ${brief.coreMessage} ${brief.cta}.`;
}

export async function writeCopy(
  brief: Brief,
  genomes: Genome[],
  personas: Persona[],
  bannedTerms: string[],
  llm: LLM,
  feed: Feed,
  room: string,
): Promise<string[]> {
  if (genomes.length === 0) return [];

  const prompt = [
    'You are an advertising copywriter. Write ONE short ad copy (max 2 sentences)',
    `for each numbered variant below, for the brand described.`,
    'Each copy must match its variant\'s angle, hook and audience. Return one entry',
    'per index, using the SAME index numbers shown.',
    '',
    ...header(brief, bannedTerms),
    '',
    ...genomes.map((g, i) => genomeBlock(g, i, personas)),
  ].join('\n');

  let raw: RawCopy[] = [];
  try {
    const res = await llm.extract<{ copies?: RawCopy[] }>(prompt, SCHEMA_HINT);
    raw = res?.copies ?? [];
  } catch {
    raw = [];
  }

  const byIndex = new Map<number, string>();
  for (const r of raw) {
    if (typeof r?.index === 'number' && typeof r?.copy === 'string' && r.copy.trim()) {
      byIndex.set(r.index, r.copy.trim());
    }
  }

  const copies = genomes.map((g, i) => byIndex.get(i) ?? fallbackCopy(brief, g));

  await feed.post(room, {
    agent: 'copywriter',
    kind: 'tool_result',
    payload: { requested: genomes.length, generated: byIndex.size, fallbacks: genomes.length - byIndex.size },
  });

  return copies;
}

export async function repairCopy(
  brief: Brief,
  genomes: Genome[],
  personas: Persona[],
  violations: Violation[],
  bannedTerms: string[],
  llm: LLM,
  feed: Feed,
  room: string,
): Promise<Map<number, string>> {
  const repaired = new Map<number, string>();
  if (violations.length === 0) return repaired;

  const prompt = [
    'You are an advertising copywriter. The copy for these variants used FORBIDDEN',
    'terms. Rewrite each one to keep the same angle, hook and audience while removing',
    'every forbidden term. Return one entry per index, using the SAME index numbers.',
    '',
    ...header(brief, bannedTerms),
    '',
    ...violations.map((v) =>
      [
        genomeBlock(genomes[v.index], v.index, personas),
        `    FORBIDDEN TERMS USED: ${v.terms.join(', ')}`,
      ].join('\n'),
    ),
  ].join('\n');

  try {
    const res = await llm.extract<{ copies?: RawCopy[] }>(prompt, SCHEMA_HINT);
    for (const r of res?.copies ?? []) {
      if (typeof r?.index === 'number' && typeof r?.copy === 'string' && r.copy.trim()) {
        repaired.set(r.index, r.copy.trim());
      }
    }
  } catch {
    // No repair available; caller drops the violators.
  }

  await feed.post(room, {
    agent: 'copywriter',
    kind: 'thought',
    payload: { repairAttempted: violations.length, repairReturned: repaired.size },
  });

  return repaired;
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/agents/copywriter.ts
git commit -m "feat: add batched copywriter with repair pass"
```

---

### Task 6: Imagesmith + Gemini reference-image conditioning + placeholders

**Files:**
- Create: `src/lib/agents/imagesmith.ts`
- Create: `public/fixtures/ad-1.svg`, `ad-2.svg`, `ad-3.svg`, `ad-4.svg`
- Modify: `src/lib/adapters/mocks.ts:187-192` (`FALLBACK_IMAGES`)
- Modify: `src/lib/adapters/real/gemini.ts:17-37` (implement the `refImageUrl` TODO)

**Interfaces:**
- Consumes: `Genome[]` from Task 1; `CreativeStore` from Task 4; `ImageGen`, `Feed` from `@/lib/adapters/interfaces`.
- Produces:
  - `PLACEHOLDER_IMAGES: string[]`
  - `buildImagePrompt(brand: Brand, genome: Genome, personas: Persona[]): string`
  - `renderImages(brand: Brand, genomes: Genome[], personas: Persona[], ids: string[], runId: string, imageGen: ImageGen, store: CreativeStore, feed: Feed, room: string): Promise<string[]>` — one URL per genome, index-aligned, never short.

- [ ] **Step 1: Create the placeholder images**

Create `public/fixtures/ad-1.svg` (repeat for `ad-2`, `ad-3`, `ad-4`, changing only `FILL`, `LABEL`, and the filename):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Placeholder creative 1">
  <rect width="512" height="512" fill="#1f2937"/>
  <rect x="24" y="24" width="464" height="464" fill="none" stroke="#4b5563" stroke-width="2" stroke-dasharray="8 8"/>
  <text x="256" y="248" font-family="system-ui, sans-serif" font-size="28" fill="#9ca3af" text-anchor="middle">placeholder creative</text>
  <text x="256" y="288" font-family="system-ui, sans-serif" font-size="72" font-weight="700" fill="#e5e7eb" text-anchor="middle">1</text>
</svg>
```

Values per file:

| File | `fill` | number |
|---|---|---|
| `ad-1.svg` | `#1f2937` | 1 |
| `ad-2.svg` | `#312e81` | 2 |
| `ad-3.svg` | `#3f2937` | 3 |
| `ad-4.svg` | `#1e3a34` | 4 |

- [ ] **Step 2: Point the mock at files that exist**

In `src/lib/adapters/mocks.ts`, replace the `FALLBACK_IMAGES` constant:

```ts
const FALLBACK_IMAGES = [
  '/fixtures/ad-1.svg',
  '/fixtures/ad-2.svg',
  '/fixtures/ad-3.svg',
  '/fixtures/ad-4.svg',
];
```

These previously pointed at `.png` files that were never committed — every mock-mode image was a broken link.

- [ ] **Step 3: Implement Gemini reference-image conditioning**

In `src/lib/adapters/real/gemini.ts`, replace the body of `generate` (the whole function from `const key =` through the `return`) with:

```ts
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error('GEMINI_API_KEY not set');

      // Product image as reference: fetch → base64 → inlineData part. Without
      // this the generated ad shows a generic product, not the brand's.
      const parts: unknown[] = [{ text: prompt }];
      if (refImageUrl && /^https?:/.test(refImageUrl)) {
        const imgRes = await fetch(refImageUrl);
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          parts.unshift({
            inlineData: {
              mimeType: imgRes.headers.get('content-type') ?? 'image/png',
              data: buf.toString('base64'),
            },
          });
        }
      }

      const res = await fetch(`${BASE}/models/${MODEL}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] }),
      });
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
      const j = (await res.json()) as {
        candidates: { content: { parts: { inlineData?: { data: string } }[] } }[];
      };
      const b64 = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
      if (!b64) throw new Error('Gemini returned no image');
      return { imageUrl: `data:image/png;base64,${b64}` };
```

Also update the file's header comment: replace the `SKELETON:` paragraph's first sentence with `Product image is fetched and passed as an inlineData reference part.` Leave the note about confirming the model id — it is still unverified against the live API.

- [ ] **Step 4: Implement the imagesmith**

Create `src/lib/agents/imagesmith.ts`:

```ts
/**
 * Imagesmith — turns each genome into a Gemini image, persisted via CreativeStore.
 *
 * Two properties matter here. First, BOUNDED CONCURRENCY: Gemini is the slowest
 * and most quota-limited call in the system, so requests go out 3 at a time
 * rather than all 8 at once. Second, PER-ITEM ISOLATION: one failed image must
 * not kill the other seven — a failure falls back to a placeholder and is
 * reported to the feed, so the demo degrades instead of dying.
 */

import type { Brand, Genome, Persona } from '@/lib/contracts';
import type { Feed, ImageGen } from '../adapters/interfaces';
import type { CreativeStore } from '../store/creativeStore';

const CONCURRENCY = 3;

export const PLACEHOLDER_IMAGES = [
  '/fixtures/ad-1.svg',
  '/fixtures/ad-2.svg',
  '/fixtures/ad-3.svg',
  '/fixtures/ad-4.svg',
];

export function buildImagePrompt(brand: Brand, genome: Genome, personas: Persona[]): string {
  const persona = personas.find((p) => p.name === genome.persona);
  const audience = persona ? `${persona.name} — ${persona.summary}` : genome.persona;
  return `${genome.style} advertising image for ${brand.name}. ${genome.hook}. Angle: ${genome.angle}. Audience: ${audience}.`;
}

/** Run `worker` over every index of `items`, at most `limit` in flight. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function renderImages(
  brand: Brand,
  genomes: Genome[],
  personas: Persona[],
  ids: string[],
  runId: string,
  imageGen: ImageGen,
  store: CreativeStore,
  feed: Feed,
  room: string,
): Promise<string[]> {
  let failures = 0;

  const urls = await mapWithLimit(genomes, CONCURRENCY, async (genome, i) => {
    const placeholder = PLACEHOLDER_IMAGES[i % PLACEHOLDER_IMAGES.length];
    try {
      const prompt = buildImagePrompt(brand, genome, personas);
      const { imageUrl } = await imageGen.generate(prompt, brand.productImageUrl);

      // Real Gemini returns a data URL; mocks return a path already on disk.
      const dataMatch = /^data:image\/\w+;base64,(.+)$/.exec(imageUrl);
      if (!dataMatch) return imageUrl;

      try {
        return await store.saveImage(runId, ids[i], Buffer.from(dataMatch[1], 'base64'));
      } catch {
        return imageUrl; // write failed — serve inline rather than losing the image
      }
    } catch (err) {
      failures++;
      await feed.post(room, {
        agent: 'imagesmith',
        kind: 'error',
        payload: { id: ids[i], reason: (err as Error).message, usedPlaceholder: true },
      });
      return placeholder;
    }
  });

  await feed.post(room, {
    agent: 'imagesmith',
    kind: 'tool_result',
    payload: { rendered: genomes.length - failures, failed: failures, concurrency: CONCURRENCY },
  });

  return urls;
}
```

- [ ] **Step 5: Verify it type-checks and the placeholders resolve**

```bash
npx tsc --noEmit
ls public/fixtures/
```

Expected: no type errors; four `.svg` files listed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agents/imagesmith.ts public/fixtures src/lib/adapters/mocks.ts src/lib/adapters/real/gemini.ts
git commit -m "feat: add imagesmith with bounded concurrency and Gemini image conditioning"
```

---

### Task 7: Creative engine orchestrator + integration test

**Files:**
- Create: `src/lib/agents/creativeEngine.ts`
- Test: `scripts/test-creative-engine.ts`
- Modify: `package.json` (add `test:creative` script)
- Modify: `PROGRESS.md` (check off Phase 2 items)

**Interfaces:**
- Consumes: `expandGenomes` (Task 1), `screenCreatives`/`Violation` (Task 2), `distillBannedTerms` (Task 3), `CreativeStore` (Task 4), `writeCopy`/`repairCopy` (Task 5), `renderImages` (Task 6), `Adapters` from `@/lib/adapters`.
- Produces: `runCreativeEngine(...): Promise<CreativeRunResult>`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-creative-engine.ts`:

```ts
/**
 * Creative engine integration probe (mock mode).
 * Run: npx tsx scripts/test-creative-engine.ts
 *
 * Uses getAdapters() — respects USE_REAL_* flags, so it is mock-safe by default
 * and upgrades to live Pioneer/Gemini/Band as keys land.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import type { Brand, Brief, Persona } from '../src/lib/contracts';
import { getAdapters } from '../src/lib/adapters';
import { createFileCreativeStore } from '../src/lib/store/creativeStore';
import { runCreativeEngine } from '../src/lib/agents/creativeEngine';

const brief = JSON.parse(readFileSync('fixtures/brief.g1.json', 'utf8')) as Brief;

const brand: Brand = {
  id: 'magic-spoon',
  url: 'https://magicspoon.com',
  name: 'Magic Spoon',
  productImageUrl: '/fixtures/ad-1.svg',
  contextVersion: 1,
  contextHash: brief.contextHash,
  sensoSourceIds: ['senso-src-1'],
};

const personas: Persona[] = ['Nostalgic Millennial', 'Busy Professional', 'Health Optimizer'].map(
  (name, i) => ({
    id: `p${i + 1}`,
    brandId: brand.id,
    name,
    summary: `${name} summary`,
    pains: ['pain'],
    desires: ['desire'],
    objections: ['objection'],
    factIds: ['f1'],
  }),
);

const runId = 'test-creative-run';
const store = createFileCreativeStore();
const result = await runCreativeEngine(runId, brand, brief, personas, getAdapters(), store, 8);

// --- a full set was produced -------------------------------------------
assert.ok(result.creatives.length >= 4, `expected >= 4 creatives, got ${result.creatives.length}`);
assert.ok(result.governance.ok, `governance denied: ${result.governance.reason}`);

// --- every contract field is populated ----------------------------------
result.creatives.forEach((c, i) => {
  assert.equal(c.id, `${runId}-c${i + 1}`, 'id must be deterministic');
  assert.equal(c.publishedAdId, `sim-${c.id}`);
  assert.equal(c.briefId, brief.id);
  assert.equal(c.brandId, brand.id);
  assert.equal(c.status, 'live');
  assert.ok(c.copy.trim().length > 0, 'copy must not be empty');
  assert.ok(c.imageUrl.length > 0, 'imageUrl must not be empty');
  assert.deepEqual(c.arm, { alpha: 1, beta: 1, pulls: 0 }, 'bandit must start unbiased');
  assert.ok(c.genome.angle && c.genome.persona && c.genome.hook && c.genome.style);
  assert.equal(c.genome.generation, brief.generation);
});

// --- genomes are distinct ----------------------------------------------
const genomeKeys = result.creatives.map(
  (c) => `${c.genome.angle}|${c.genome.persona}|${c.genome.hook}|${c.genome.style}`,
);
assert.equal(new Set(genomeKeys).size, genomeKeys.length, 'genomes must be distinct');

// --- no surviving creative contains a banned term -----------------------
for (const c of result.creatives) {
  assert.ok(
    !/\bcures?\b|guaranteed|clinically proven/i.test(c.copy),
    `banned term survived screening: ${c.copy}`,
  );
}

// --- persistence round-trips -------------------------------------------
assert.ok(existsSync(`.runs/${runId}/creatives.json`), 'run metadata must be written');
const reloaded = await store.getRun(runId);
assert.deepEqual(reloaded, result.creatives, 'getRun must round-trip saveRun');

console.log(`✅ CREATIVE ENGINE OK — ${result.creatives.length} creatives, ${result.dropped.length} dropped.`);
console.log(`   room=${result.room} governance=${JSON.stringify(result.governance)}`);
for (const c of result.creatives) {
  console.log(`   ${c.id} [${c.genome.angle}/${c.genome.style}] ${c.copy.slice(0, 60)}`);
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx tsx scripts/test-creative-engine.ts
```

Expected: FAIL — `Cannot find module '../src/lib/agents/creativeEngine'`.

- [ ] **Step 3: Implement the orchestrator**

Create `src/lib/agents/creativeEngine.ts`:

```ts
/**
 * Creative engine orchestrator — Brief → N genome-stamped, copy-written,
 * image-rendered, compliance-screened Creatives, coordinating in a Band room
 * (brand-creative:{brandId}) that the UI mirrors.
 *
 * Ordering is deliberate: copy is screened BEFORE images, so no Gemini quota is
 * spent on a creative that is about to be dropped.
 *
 * Governance gates publish. If drops leave too few survivors the run is denied
 * rather than shipping a threadbare set — a second OBSERVABLE block, mirroring
 * the research swarm's low-confidence veto. (The hosted governance provider was cut in 22e7f66;
 * this client-side governance mock is now its permanent form.)
 */

import type { Brand, Brief, Creative, Genome, Persona, Prior } from '@/lib/contracts';
import type { Adapters } from '../adapters';
import type { CreativeStore } from '../store/creativeStore';
import { expandGenomes } from '../brief/expandGenomes';
import { distillBannedTerms } from '../creative/bannedTerms';
import { screenCreatives, type Violation } from '../creative/complianceGate';
import { writeCopy, repairCopy } from './copywriter';
import { renderImages } from './imagesmith';

/** Below this many survivors the set is too thin to be worth publishing. */
const MIN_SURVIVORS = 4;

export type CreativeRunResult = {
  runId: string;
  room: string;
  brief: Brief;
  creatives: Creative[];
  dropped: Violation[];
  governance: { ok: boolean; reason?: string };
};

function roomFor(brandId: string): string {
  return `brand-creative:${brandId}`;
}

export async function runCreativeEngine(
  runId: string,
  brand: Brand,
  brief: Brief,
  personas: Persona[],
  adapters: Adapters,
  store: CreativeStore,
  n = 8,
  priors: Prior[] = [],
): Promise<CreativeRunResult> {
  const { llm, feed, governance, imageGen } = adapters;
  const room = roomFor(brand.id);

  await feed.join(room);
  await feed.post(room, {
    agent: 'creative',
    kind: 'thought',
    payload: { status: 'starting', briefId: brief.id, generation: brief.generation, n },
  });

  const bannedTerms = await distillBannedTerms(brief.compliance, brief.contextHash, llm);
  const genomes = expandGenomes(brief, personas, n, priors);

  await feed.post(room, {
    agent: 'creative',
    kind: 'tool_result',
    payload: { genomes: genomes.length, bannedTerms: bannedTerms.length },
  });

  // --- copy, screened before any image is generated ---------------------
  const copies = await writeCopy(brief, genomes, personas, bannedTerms, llm, feed, room);

  let violations = screenCreatives(copies, bannedTerms);
  if (violations.length > 0) {
    const repaired = await repairCopy(
      brief, genomes, personas, violations, bannedTerms, llm, feed, room,
    );
    for (const [index, copy] of repaired) copies[index] = copy;
    violations = screenCreatives(copies, bannedTerms);
  }

  const dropped = violations;
  const droppedIndices = new Set(dropped.map((v) => v.index));
  for (const v of dropped) {
    await feed.post(room, {
      agent: 'governance',
      kind: 'error',
      payload: { action: 'creative_drop', index: v.index, terms: v.terms, reason: 'prohibited claim survived repair' },
    });
  }

  const survivorGenomes: Genome[] = [];
  const survivorCopies: string[] = [];
  genomes.forEach((g, i) => {
    if (droppedIndices.has(i)) return;
    survivorGenomes.push(g);
    survivorCopies.push(copies[i]);
  });

  const ids = survivorGenomes.map((_, i) => `${runId}-c${i + 1}`);

  // --- images, only for survivors --------------------------------------
  const imageUrls = await renderImages(
    brand, survivorGenomes, personas, ids, runId, imageGen, store, feed, room,
  );

  const creatives: Creative[] = survivorGenomes.map((genome, i) => ({
    id: ids[i],
    briefId: brief.id,
    brandId: brand.id,
    imageUrl: imageUrls[i],
    copy: survivorCopies[i],
    genome,
    status: 'live',
    publishedAdId: `sim-${ids[i]}`,
    arm: { alpha: 1, beta: 1, pulls: 0 },
  }));

  // --- governance gate -------------------------------------------------------
  let gov = await governance.approve('creative_publish', {
    generated: creatives.length,
    dropped: dropped.length,
    violations: dropped.reduce((s, v) => s + v.terms.length, 0),
  });
  if (gov.ok && creatives.length < MIN_SURVIVORS) {
    gov = { ok: false, reason: `only ${creatives.length} creatives survived screening (min ${MIN_SURVIVORS})` };
  }

  await feed.post(room, {
    agent: 'governance',
    kind: gov.ok ? 'tool_result' : 'error',
    payload: { action: 'creative_publish', ...gov },
  });

  if (gov.ok) await store.saveRun(runId, creatives);

  await feed.post(room, {
    agent: 'creative',
    kind: 'thought',
    payload: { status: 'done', creatives: creatives.length, dropped: dropped.length, governanceOk: gov.ok },
  });

  return { runId, room, brief, creatives, dropped, governance: gov };
}
```

- [ ] **Step 4: Add the npm script**

In `package.json`, add to `"scripts"`:

```json
"test:creative": "tsx scripts/test-creative-engine.ts"
```

- [ ] **Step 5: Run the full suite**

```bash
npm run test:genomes
npm run test:compliance
npm run test:creative
npm run smoke
npm run freeze
npx tsc --noEmit
npm run lint
```

Expected: all four `✅` lines, no type errors, no lint errors.

- [ ] **Step 6: Update PROGRESS.md**

Under `### Phase 2 — Creative engine`, change these lines from `[ ]` to `[x]`:

```
- [x] Gemini image generation (product image as reference) → 6–8 candidates.
- [x] Copy generation via Pioneer.
- [x] Genome stamping on every creative.
- [x] Creative persistence — via `CreativeStore` filesystem backend; Supabase impl slots in behind the same interface when the shared schema lands.
- [x] Optional: prohibited-claims gate + repair pass.
```

Add to the `## Log` section:

```
- 2026-07-24 — Creative engine built: expandGenomes fan-out, batched Pioneer copy, Gemini imagery, prohibited-claims gate, CreativeStore persistence. Verified in mock mode; Gemini path unverified pending key.
```

Add to `## Open blockers`:

```
4. Golden-run images are written to Railway's ephemeral filesystem — commit the golden run's `public/runs/` assets to the repo before the demo, or they vanish on redeploy.
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/agents/creativeEngine.ts src/lib/agents/imagesmith.ts scripts/test-creative-engine.ts package.json PROGRESS.md
git commit -m "feat: add creative engine orchestrator with governance publish gate"
```

Note: `PROGRESS.md` is listed in `.gitignore` as local-only, so the `git add` above will no-op for it unless forced. That is expected — update the file for local tracking, do not force-add it.

---

## Verification

The whole phase is verifiable offline. After Task 7:

```bash
npm run test:genomes && npm run test:compliance && npm run test:creative && npm run smoke && npm run freeze && npx tsc --noEmit && npm run lint
```

**Not verifiable in this phase:** the live Gemini path. `GEMINI_API_KEY` is empty, so `real/gemini.ts` ships built-but-unverified — including the model id and response shape, which the file's own header still flags as unconfirmed. Once the key lands, run `USE_REAL_GEMINI=1 npx tsx --env-file=.env.local scripts/test-creative-engine.ts` and check that `public/runs/test-creative-run/` contains real PNGs rather than placeholder SVG paths.
