/**
 * Pioneer live smoke — the app-path proof (src/lib/llm.ts, not the adapter).
 *   npx tsx --env-file=.env.local scripts/smoke-pioneer.ts
 *
 * Forces USE_REAL_PIONEER=1 in-process, then:
 *   1. one jsonChat completion through getLLMConfig()/HTTPLLMClient
 *   2. one REAL persona-panel scoring (the /api/panel path) — asserts mode:'live'
 * Reports latency for both. Prints NO env values (presence flags only).
 */
import type { Creative, Fact } from '../src/lib/contracts';
import { HTTPLLMClient, getLLMConfig } from '../src/lib/llm';
import { scorePanel } from '../src/lib/panel';

process.env.USE_REAL_PIONEER = '1';

function makeCreative(id: string, angle: string, style: string): Creative {
  return {
    id,
    briefId: `${id}-b`,
    brandId: 'smoke',
    imageUrl: '/fixtures/ad-1.svg',
    copy: `${angle}: tastes like childhood, minus the sugar. Shop now.`,
    genome: { angle, persona: 'Nostalgic Millennial', hook: 'Remember this?', style, generation: 1 },
    status: 'live',
    publishedAdId: `ad-${id}`,
    arm: { alpha: 1, beta: 1, pulls: 0 },
  };
}

async function main() {
  const config = getLLMConfig();
  console.log(
    `config: provider=${config?.provider ?? 'none'} model=${config?.model ?? '-'} ` +
      `base=${config ? 'set' : 'missing'} key=${config ? 'set' : 'missing'}`,
  );
  if (!config || config.provider !== 'pioneer') {
    console.error('❌ PIONEER SMOKE FAILED: USE_REAL_PIONEER=1 did not resolve a Pioneer config (check PIONEER_BASE_URL / PIONEER_API_KEY).');
    process.exit(1);
  }

  const client = new HTTPLLMClient(config);
  let t = Date.now();
  const hello = await client.jsonChat<{ text: string }>({
    system: 'Answer as JSON: {"text": "<answer>"}.',
    user: 'Reply with exactly: PIONEER OK',
    maxTokens: 60,
  });
  const completionMs = Date.now() - t;
  console.log(`completion → ${JSON.stringify(hello)} (${completionMs}ms)`);

  const personaFacts: Fact[] = [
    {
      id: 'pf1',
      brandId: 'smoke',
      section: 'persona',
      statement: 'Nostalgic fitness enthusiast: adults chasing childhood cereal taste',
      confidence: 0.85,
      origin: 'research',
    },
  ];
  t = Date.now();
  const { scores, mode } = await scorePanel({
    creatives: [
      makeCreative('smk-c1', 'problem-solution', 'retro-cartoon'),
      makeCreative('smk-c2', 'social-proof', 'clean-clinical'),
    ],
    personaFacts,
    brandName: 'Magic Spoon',
  });
  const panelMs = Date.now() - t;
  console.log(`panel → mode=${mode} scores=${scores.map((s) => s.appealScore).join(',')} (${panelMs}ms)`);

  if (mode !== 'live') {
    console.error('❌ PIONEER SMOKE FAILED: panel fell back to mock — Pioneer call did not succeed.');
    process.exit(1);
  }
  console.log(`✅ PIONEER SMOKE OK — completion ${completionMs}ms, jsonMode panel ${panelMs}ms, mode=live.`);
}

main().catch((e) => {
  console.error('❌ PIONEER SMOKE FAILED:', (e as Error).message);
  process.exit(1);
});
