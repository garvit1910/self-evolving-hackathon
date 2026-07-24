/**
 * Spine smoke-test + fixture freeze.
 *   npm run freeze
 *
 * 1. Assembles a BriefInput entirely from mock adapters (zero network).
 * 2. Runs composeBrief — the deterministic spine.
 * 3. Asserts the Brief has every required field (the adapter contract).
 * 4. Writes fixtures/ for Track G to build against.
 *
 * Exits non-zero if the spine is broken. This is the "spine compiles" gate.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Brand, BriefInput, Persona } from '../src/lib/contracts';
import { createMockAdapters } from '../src/lib/adapters/mocks';
import { composeBrief } from '../src/lib/brief/composeBrief';

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
  const facts = await adapters.context.search('positioning voice objections', 8);

  // --- retrieval (Actian) ---
  await adapters.vector.upsert(facts.map((f) => ({ id: f.id, text: f.statement })));
  const topK = await adapters.vector.topK('taste nostalgia protein', 3);

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

  const input: BriefInput = {
    runId,
    brand,
    generation: 1,
    facts,
    personas,
    topKChunks: topK.map((t) => t.text),
    priors: [],
  };

  const brief = composeBrief(input);

  // --- contract assertions: a sponsor "counts" only if composeBrief consumed it ---
  assert(brief.id === `${runId}-brief-g1`, 'brief id deterministic');
  assert(brief.contextHash === contextHash, 'contextHash provenance carried from Senso');
  assert(brief.angle && typeof brief.angle === 'string', 'angle present');
  assert(brief.coreMessage.length > 0, 'coreMessage from Senso value_prop');
  assert(brief.hooks.length > 0, 'hooks from Actian top-k / voice');
  assert(brief.persona === 'Nostalgic Millennial', 'persona from swarm');
  assert(Array.isArray(brief.compliance), 'compliance carried');

  // --- freeze fixtures for Track G ---
  const outDir = join(process.cwd(), 'fixtures');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'brand.json'), JSON.stringify(brand, null, 2));
  writeFileSync(join(outDir, 'facts.json'), JSON.stringify(facts, null, 2));
  writeFileSync(join(outDir, 'personas.json'), JSON.stringify(personas, null, 2));
  writeFileSync(join(outDir, 'brief.g1.json'), JSON.stringify(brief, null, 2));

  console.log('✅ SPINE OK — composeBrief produced a valid Brief from mock adapters.');
  console.log(`   brief.id=${brief.id}  angle=${brief.angle}  contextHash=${brief.contextHash}`);
  console.log(`   fixtures written to ${outDir}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
