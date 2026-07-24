/** Live Pioneer probe. Run: npx tsx --env-file=.env.local scripts/test-pioneer.ts */
import { createPioneerLLM } from '../src/lib/adapters/real/pioneer';

async function main() {
  console.log('base:', process.env.PIONEER_BASE_URL, 'model:', process.env.PIONEER_MODEL);
  const llm = createPioneerLLM();
  const out = await llm.complete('Reply with exactly: PIONEER OK');
  console.log('completion →', JSON.stringify(out));

  const facts = await llm.extract<{ items: string[] }>(
    'List two value props for a high-protein cereal brand.',
    '{ "items": string[] }',
  );
  console.log('extract →', JSON.stringify(facts));
}
main().catch((e) => {
  console.error('PIONEER PROBE FAILED:', e.message);
  process.exit(1);
});
