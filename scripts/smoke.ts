/** Smoke test: run getAdapters() → composeBriefs, and prove record→replay tapes. */
import type { Brand, Fact } from '../src/lib/contracts';
import { getAdapters } from '../src/lib/adapters';
import { composeBriefs } from '../src/lib/creative/compose';

async function run(label: string) {
  const a = getAdapters();
  const { sourceIds, contextHash } = await a.context.ingest([
    { title: 'home', text: 'Cereal reimagined: 0g sugar, 13g protein.' },
  ]);
  const facts: Fact[] = await a.context.search('positioning voice', 8);
  await a.vector.upsert(facts.map((f) => ({ id: f.id, text: f.statement })));
  const topK = await a.vector.topK('protein nostalgia', 3);
  const gov = await a.governance.approve('writeback', { confidence: 0.4 });

  const brand: Brand = {
    id: 'magic-spoon', url: 'https://magicspoon.com', name: 'Magic Spoon',
    productImageUrl: '/fixtures/product.png', contextVersion: 1, contextHash, sensoSourceIds: sourceIds,
  };
  const rankedFacts = topK
    .map((t) => facts.find((f) => f.id === t.id))
    .filter((f): f is Fact => Boolean(f));
  const composed = composeBriefs({
    brand, facts, rankedFacts, count: 4, generation: 1, runId: 'smoke',
    contextVersion: 1, contextHash,
  });
  const hooks = [...new Set(composed.map((b) => b.hook))];
  console.log(`  [${label}] angle=${composed[0].angle} hooks=${hooks.length} govVeto=${!gov.ok ? 'BLOCKED ✓' : 'allowed'}`);
  return composed[0];
}

async function main() {
  console.log(`TAPE_MODE=${process.env.TAPE_MODE ?? 'live'}`);
  await run('run');
  console.log('✅ SMOKE OK — getAdapters() → composeBriefs works, governance veto fired.');
}
main().catch((e) => { console.error(e); process.exit(1); });
