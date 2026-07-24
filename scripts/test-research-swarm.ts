/**
 * Research swarm probe. Run: npx tsx --env-file=.env.local scripts/test-research-swarm.ts [url]
 * Uses getAdapters() — respects USE_REAL_* flags, so it's mock-safe by default
 * and upgrades to live Senso/Pioneer/Band/Actian/Guild as keys land.
 */
import { getAdapters } from '../src/lib/adapters';
import { runResearchSwarm } from '../src/lib/agents/researchSwarm';

async function main() {
  const url = process.argv[2] ?? 'https://magicspoon.com';
  const adapters = getAdapters();
  const result = await runResearchSwarm('magic-spoon', url, adapters);

  console.log(`pages fetched: ${result.pages.length}`);
  for (const p of result.pages) console.log(`  - ${p.url} (${p.text.length} chars)`);

  console.log(`\nfacts grounded: ${result.facts.length}`);
  for (const f of result.facts) console.log(`  [${f.section}] ${f.statement}`);

  console.log(`\npersonas: ${result.personas.length}`);
  for (const p of result.personas) console.log(`  - ${p.name}: ${p.summary} (facts: ${p.factIds.join(',')})`);

  console.log(`\ncontextHash: ${result.contextHash}`);
  console.log(`sensoSourceIds: ${result.sensoSourceIds.join(', ')}`);
  console.log(`governance: ${JSON.stringify(result.governance)}`);
}

main().catch((e) => {
  console.error('RESEARCH SWARM PROBE FAILED:', e);
  process.exit(1);
});
