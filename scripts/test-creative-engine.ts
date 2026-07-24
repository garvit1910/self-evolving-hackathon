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
import type { LLM, ImageGen } from '../src/lib/adapters/interfaces';
import { getAdapters } from '../src/lib/adapters';
import { createFileCreativeStore } from '../src/lib/store/creativeStore';
import { runCreativeEngine } from '../src/lib/agents/creativeEngine';
import { FLOOR_TERMS } from '../src/lib/creative/bannedTerms';

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

// =========================================================================
// Finding 3 (final review): drop/repair/governance-deny pathway had zero
// end-to-end coverage — under mocks `dropped` is always [], `repairCopy` is
// never invoked, and the existing banned-term assertion above is vacuous
// (the fixture contains no banned terms). This second run injects an `llm`
// stub that deliberately violates for exactly one genome and cannot be
// repaired, so the drop path actually executes.
// =========================================================================

const violatingTerm = FLOOR_TERMS.find((t) => t === 'clinically proven')!;

/** Returns one violating copy (index 0) and clean copy for every other index
 *  on the initial writeCopy call; on the repair call (detected by the
 *  "FORBIDDEN TERMS USED" marker copywriter.ts emits) returns nothing, so
 *  the violator cannot be rescued and must be dropped. */
function createViolatingLLM(): LLM {
  return {
    async extract<T>(prompt: string, schemaHint: string): Promise<T> {
      if (schemaHint.includes('terms')) {
        // No distilled terms — the floor list alone must still catch the violation.
        return { terms: [] } as unknown as T;
      }
      if (schemaHint.includes('copies')) {
        const isRepairCall = prompt.includes('FORBIDDEN TERMS USED');
        if (isRepairCall) {
          return { copies: [] } as unknown as T; // repair fails — violator stays dropped
        }
        const indices = [...prompt.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
        const copies = indices.map((i) => ({
          index: i,
          copy:
            i === 0
              ? `This product is ${violatingTerm} to help. Try it today.`
              : `Clean, compliant copy for variant ${i}.`,
        }));
        return { copies } as unknown as T;
      }
      return {} as unknown as T;
    },
    async complete() {
      return '';
    },
  };
}

const violatingAdapters = { ...getAdapters(), llm: createViolatingLLM() };
const dropRunId = 'test-creative-run-violation';
const dropResult = await runCreativeEngine(
  dropRunId,
  brand,
  brief,
  personas,
  violatingAdapters,
  store,
  8,
);

assert.equal(dropResult.dropped.length, 1, `expected exactly 1 drop, got ${dropResult.dropped.length}`);
assert.equal(dropResult.dropped[0].index, 0, 'the planted violator (index 0) must be the one dropped');
assert.ok(
  dropResult.dropped[0].terms.includes(violatingTerm),
  `dropped violation must record the planted term, got ${JSON.stringify(dropResult.dropped[0].terms)}`,
);

// Same brief/personas/n=8 as the first run above, so expandGenomes deterministically
// produces the same 8 genomes; 1 planted violation must leave exactly 7 survivors.
const totalGenomesForDropRun = dropResult.creatives.length + dropResult.dropped.length;
assert.equal(totalGenomesForDropRun, 8, `expected 8 total genomes, got ${totalGenomesForDropRun}`);
assert.equal(
  dropResult.creatives.length,
  totalGenomesForDropRun - 1,
  'survivor count must be exactly one fewer than the total genomes generated',
);

// surviving IDs must be contiguous `${dropRunId}-c1..cN` with no gap
dropResult.creatives.forEach((c, i) => {
  assert.equal(c.id, `${dropRunId}-c${i + 1}`, `surviving IDs must be contiguous, got ${c.id} at position ${i}`);
});

assert.ok(dropResult.governance.ok, `governance unexpectedly denied: ${dropResult.governance.reason}`);

console.log(
  `✅ CREATIVE ENGINE DROP PATH OK — planted 1 violation, dropped ${dropResult.dropped.length}, ${dropResult.creatives.length} survivors contiguous.`,
);

// =========================================================================
// Finding 4 (final review): store.saveImage was never executed by any test —
// it only runs when imageGen returns a `data:` URL, which under mocks never
// happens (mocks return static /fixtures/*.svg paths). This run injects an
// imageGen stub that returns a real (tiny, valid) 1x1 PNG as a data URL, so
// the base64 decode, the public/runs/ write, and the .png naming convention
// all actually execute.
// =========================================================================

const ONE_PIXEL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function createDataUrlImageGen(): ImageGen {
  return {
    async generate() {
      return { imageUrl: `data:image/png;base64,${ONE_PIXEL_PNG_B64}` };
    },
  };
}

const imageAdapters = { ...getAdapters(), imageGen: createDataUrlImageGen() };
const imageRunId = 'test-creative-run-image';
const imageResult = await runCreativeEngine(
  imageRunId,
  brand,
  brief,
  personas,
  imageAdapters,
  store,
  8,
);

assert.ok(imageResult.governance.ok, `governance unexpectedly denied: ${imageResult.governance.reason}`);
assert.ok(imageResult.creatives.length > 0, 'expected at least one creative from the image run');

for (const c of imageResult.creatives) {
  assert.equal(
    c.imageUrl,
    `/runs/${imageRunId}/${c.id}.png`,
    `imageUrl must be the persisted public path, not the data URL, got ${c.imageUrl}`,
  );
  assert.ok(
    existsSync(`public/runs/${imageRunId}/${c.id}.png`),
    `expected saved PNG at public/runs/${imageRunId}/${c.id}.png`,
  );
}

console.log(
  `✅ CREATIVE ENGINE IMAGE SAVE OK — ${imageResult.creatives.length} PNGs decoded and written under public/runs/${imageRunId}/.`,
);
