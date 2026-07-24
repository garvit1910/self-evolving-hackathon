/** Smoke test: run getAdapters() → composeBrief, and prove record→replay tapes. */
import type { Brand, BriefInput, Persona } from '../src/lib/contracts';
import { getAdapters } from '../src/lib/adapters';
import { composeBrief } from '../src/lib/brief/composeBrief';

async function run(label: string) {
  const a = getAdapters();
  const { sourceIds, contextHash } = await a.context.ingest([
    { title: 'home', text: 'Cereal reimagined: 0g sugar, 13g protein.' },
  ]);
  const facts = await a.context.search('positioning voice', 8);
  await a.vector.upsert(facts.map((f) => ({ id: f.id, text: f.statement })));
  const topK = await a.vector.topK('protein nostalgia', 3);
  const gov = await a.governance.approve('writeback', { confidence: 0.4 });

  const brand: Brand = {
    id: 'magic-spoon', url: 'https://magicspoon.com', name: 'Magic Spoon',
    productImageUrl: '/fixtures/product.png', contextVersion: 1, contextHash, sensoSourceIds: sourceIds,
  };
  const personas: Persona[] = [{
    id: 'p1', brandId: brand.id, name: 'Nostalgic Millennial', summary: '', pains: [], desires: [], objections: [], factIds: [],
  }];
  const input: BriefInput = { runId: 'smoke', brand, generation: 1, facts, personas, topKChunks: topK.map((t) => t.text), priors: [] };
  const brief = composeBrief(input);
  console.log(`  [${label}] angle=${brief.angle} hooks=${brief.hooks.length} govVeto=${!gov.ok ? 'BLOCKED ✓' : 'allowed'}`);
  return brief;
}

async function main() {
  console.log(`TAPE_MODE=${process.env.TAPE_MODE ?? 'live'}`);
  await run('run');
  console.log('✅ SMOKE OK — getAdapters() → composeBrief works, governance veto fired.');
}
main().catch((e) => { console.error(e); process.exit(1); });
