/**
 * Band dashboard population check.
 *   USE_REAL_BAND=1 npx tsx --env-file=.env.local scripts/band-hello.ts
 *
 * Waits for a Band session (create one in the dashboard: "New Session" + add
 * this agent), then posts a short Scout→Analyst→Personasmith exchange as REAL
 * messages (with mentions) plus events — and reads the chat back. If you see
 * the exchange in the dashboard, the swarm's traffic will render the same way.
 */
import { createBandFeed, listBandChats } from '../src/lib/adapters/real/band';

const WAIT_MS = Number(process.env.BAND_WAIT_MS ?? 120_000);

async function main() {
  console.log('checking for a Band session…');
  const deadline = Date.now() + WAIT_MS;
  let chat: { id: string; title?: string } | undefined;
  let warned = false;
  while (!chat && Date.now() < deadline) {
    [chat] = await listBandChats();
    if (!chat) {
      if (!warned) {
        warned = true;
        console.log(
          '⏳ no session found — in the Band dashboard (app.band.ai) click "New Session" and add this agent. Waiting up to ' +
            Math.round(WAIT_MS / 1000) +
            's…',
        );
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!chat) {
    console.error('❌ no Band session appeared — create one in the dashboard and re-run.');
    process.exit(1);
  }
  console.log(`session found: ${chat.id}${chat.title ? ` ("${chat.title}")` : ''}`);

  const feed = createBandFeed();
  const room = chat.id;
  await feed.join(room);
  const script: [string, string, string][] = [
    ['scout', 'thought', 'Scout reporting — crawling magicspoon.com, 8 pages queued.'],
    ['scout', 'tool_result', 'Homepage + FAQ fetched. Handing page text to the Analyst.'],
    ['analyst', 'tool_result', 'Verified fact [value_prop]: "0g sugar, 13g protein per bowl" — quote matched verbatim in source.'],
    ['analyst', 'thought', 'One fabricated quote dropped. Personasmith, personas please.'],
    ['personasmith', 'tool_result', 'Persona: Nostalgic Millennial — wants childhood cereal without the sugar guilt.'],
    ['governance', 'tool_result', 'Research publish approved — confidence 0.84.'],
  ];
  for (const [agent, kind, message] of script) {
    await feed.post(room, { agent, kind, payload: { __message: message } });
    process.stdout.write('.');
  }
  console.log('\nposted 6 events + messages. Check the Band dashboard chat now.');
}

main().catch((e) => {
  console.error('❌ band-hello failed:', (e as Error).message);
  process.exit(1);
});
