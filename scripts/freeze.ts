/**
 * Spine smoke-test + fixture freeze.
 *   npm run freeze
 *
 * 1. Assembles brief inputs entirely from mock adapters (zero network).
 * 2. Runs composeBriefs — the deterministic spine (UNIFIED at merge: Track G's
 *    composer is the survivor; the lead brief carries the engine's hook pool
 *    and compliance prose).
 * 3. Asserts the lead Brief has every required field (the adapter contract).
 * 4. Writes fixtures/ for the engine scripts to build against.
 *
 * Exits non-zero if the spine is broken. This is the "spine compiles" gate.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Brand, Brief, Fact, Persona } from '../src/lib/contracts';
import { createMockAdapters } from '../src/lib/adapters/mocks';
import { composeBriefs } from '../src/lib/creative/compose';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`❌ SPINE ASSERT FAILED: ${msg}`);
    process.exit(1);
  }
}

async function main() {
  const runId = 'magic-spoon-run1';
  const adapters = createMockAdapters();

  // --- context (Senso) ---
  const { sourceIds, contextHash } = await adapters.context.ingest([
    { title: 'home', text: 'Cereal reimagined: 0g sugar, 13g protein.' },
  ]);
  const searched = await adapters.context.search('positioning voice objections', 8);

  const personaFact: Fact = {
    id: 'f-persona',
    brandId: 'magic-spoon',
    section: 'persona',
    statement: 'Nostalgic Millennial: wants childhood cereal without the sugar guilt',
    confidence: 0.85,
    origin: 'research',
  };
  const facts: Fact[] = [...searched, personaFact];

  // --- retrieval (Actian) ---
  await adapters.vector.upsert(facts.map((f) => ({ id: f.id, text: f.statement })));
  const topK = await adapters.vector.topK('taste nostalgia protein', 3);
  const rankedFacts = topK
    .map((t) => facts.find((f) => f.id === t.id))
    .filter((f): f is Fact => Boolean(f));

  const brand: Brand = {
    id: 'magic-spoon',
    url: 'https://magicspoon.com',
    name: 'Magic Spoon',
    productImageUrl: '/fixtures/product.png',
    contextVersion: 1,
    contextHash,
    sensoSourceIds: sourceIds,
  };

  const personas: Persona[] = [
    {
      id: 'p1',
      brandId: brand.id,
      name: 'Nostalgic Millennial',
      summary: 'Wants childhood cereal without the sugar guilt.',
      pains: ['sugar crashes', 'guilt'],
      desires: ['nostalgia', 'protein'],
      objections: ['price', 'does it actually taste good?'],
      factIds: ['f1', 'f2', 'f3'],
    },
  ];

  const composed = composeBriefs({
    brand,
    facts,
    rankedFacts,
    count: 6,
    generation: 1,
    runId,
    contextVersion: brand.contextVersion,
    contextHash,
  });
  const brief: Brief = {
    ...composed[0],
    hooks: [...new Set(composed.map((b) => b.hook))],
    compliance: facts.filter((f) => f.section === 'compliance').map((f) => f.statement),
  };

  // --- contract assertions: a sponsor "counts" only if the composer consumed it ---
  assert(brief.id === `${runId}-b1`, 'brief id deterministic');
  assert(brief.contextHash === contextHash, 'contextHash provenance carried from Senso');
  assert(brief.angle && typeof brief.angle === 'string', 'angle present');
  assert(brief.coreMessage.length > 0, 'coreMessage from Senso value_prop');
  assert((brief.hooks ?? []).length > 0, 'hook pool composed');
  assert(brief.persona === 'Nostalgic Millennial', 'persona from research facts');
  assert(Array.isArray(brief.compliance), 'compliance carried');

  // --- freeze fixtures for the engine scripts ---
  const outDir = join(process.cwd(), 'fixtures');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'brand.json'), JSON.stringify(brand, null, 2));
  writeFileSync(join(outDir, 'facts.json'), JSON.stringify(facts, null, 2));
  writeFileSync(join(outDir, 'personas.json'), JSON.stringify(personas, null, 2));
  writeFileSync(join(outDir, 'brief.g1.json'), JSON.stringify(brief, null, 2));

  console.log('✅ SPINE OK — composeBriefs produced a valid lead Brief from mock adapters.');
  console.log(`   brief.id=${brief.id}  angle=${brief.angle}  contextHash=${brief.contextHash}`);
  console.log(`   fixtures written to ${outDir}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
