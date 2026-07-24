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
