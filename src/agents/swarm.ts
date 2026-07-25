/**
 * Research swarm worker — a separate Node process running Scout → Analyst →
 * Personasmith, coordinating through a Band room (brand-research:{brandId}).
 *
 *   npm run swarm -- <brandId> <brandUrl> [appBase]
 *
 * A bridge mirrors EVERY room message into the app's own routes as it happens
 * (POST /api/brands/:id/events, step 'research'), and finalized facts +
 * personas land through POST /api/brands/:id/facts — so the /research feed
 * animates the real agent conversation and the UI never cares whether Band or
 * the interim researcher produced the stream.
 *
 * Sponsors: LLM calls go through Pioneer (USE_REAL_PIONEER=1, via
 * getAdapters), the room feed through Band (USE_REAL_BAND=1; Band chat ids are
 * UUIDs — set BAND_ROOM_ID to target a real chat, otherwise the logical room
 * name is used and Band posts fall back to the mock feed). The analyst's
 * mechanical substring source-quote verification is unchanged: fabricated
 * quotes are dropped and the drop is posted to the room.
 */

import type { Fact, Persona } from '../lib/contracts';
import type { Feed } from '../lib/adapters/interfaces';
import { getAdapters } from '../lib/adapters';
import { listBandChats } from '../lib/adapters/real/band';
import { runResearchSwarm } from '../lib/agents/researchSwarm';

const AGENT_LABELS: Record<string, string> = {
  scout: 'Scout',
  analyst: 'Analyst',
  personasmith: 'Personasmith',
  swarm: 'Swarm',
  governance: 'Governance',
};

function describe(agent: string, kind: string, p: Record<string, unknown>): string {
  if (agent === 'scout' && kind === 'tool_result') return `Fetched ${p.url} (${p.chars} chars).`;
  if (agent === 'scout' && kind === 'error') return `Could not fetch ${p.url} — ${p.error}.`;
  if (agent === 'analyst' && p.dropped === true)
    return `Dropped a ${p.section} fact — quote not verbatim in ${p.sourceUrl}.`;
  if (agent === 'analyst' && p.factId)
    return `Fact [${p.section}] ${p.statement} — source: "${p.sourceQuote}"`;
  if (agent === 'analyst' && kind === 'tool_result')
    return `Extraction complete: ${p.extracted} verified facts, ${p.dropped} dropped.`;
  if (agent === 'personasmith' && p.persona) return `Persona: ${p.persona} — ${p.summary}`;
  if (agent === 'governance')
    return p.ok
      ? 'Research publish approved.'
      : `Research publish DENIED: ${p.reason ?? 'low confidence'}.`;
  if (agent === 'swarm' && p.status === 'starting') return `Swarm launching on ${p.brandUrl}.`;
  if (agent === 'swarm' && p.status === 'done')
    return `Swarm done: ${p.pages} pages, ${p.facts} facts, ${p.personas} personas.`;
  const rest = Object.entries(p)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' ');
  return `${kind}: ${rest}`;
}

/** Band rooms are chat UUIDs, created ONLY from the Band dashboard (the human
 *  clicks "New Session" and adds the agent). Resolution: BAND_ROOM_ID env
 *  override → newest chat from GET /agent/chats, POLLING up to BAND_WAIT_MS
 *  (default 60s) so a session created mid-run attaches live → null (Band
 *  posts fall back to mock; the app feed is unaffected). */
async function resolveBandRoom(): Promise<string | null> {
  if (process.env.BAND_ROOM_ID) return process.env.BAND_ROOM_ID;
  const on = process.env.USE_REAL_BAND === '1' || process.env.USE_REAL_BAND === 'true';
  if (!on || !process.env.BAND_API_KEY) return null;
  const deadline = Date.now() + Number(process.env.BAND_WAIT_MS ?? 60_000);
  let warned = false;
  for (;;) {
    try {
      const chats = await listBandChats();
      if (chats.length > 0) return chats[0].id;
    } catch {
      return null;
    }
    if (Date.now() >= deadline) return null;
    if (!warned) {
      warned = true;
      console.log(
        'band: no session yet — open the Band dashboard (app.band.ai), click "New Session", and add this agent. Waiting…',
      );
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/** Mirrors room traffic into the app's events route; forwards to Band after.
 *  The Band-side room is the resolved chat UUID (see resolveBandRoom). */
function bridgeFeed(inner: Feed, appBase: string, brandId: string, bandChatId: string | null): Feed {
  const bandRoom = (room: string) => bandChatId ?? room;
  return {
    async join(room) {
      await inner.join(bandRoom(room)).catch(() => {});
    },
    async post(room, event) {
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const message = describe(event.agent, event.kind, payload);
      const deny = event.agent === 'governance' && event.kind === 'error';
      await fetch(`${appBase}/api/brands/${brandId}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          step: 'research',
          status: deny ? 'failed' : 'running',
          payload: {
            agent: AGENT_LABELS[event.agent] ?? event.agent,
            message,
            room,
            ...payload,
          },
        }),
      }).catch(() => {});
      // Band gets the humanized line (rendered in the dashboard chat)
      await inner
        .post(bandRoom(room), { ...event, payload: { ...payload, __message: message } })
        .catch(() => {});
    },
  };
}

function personaFacts(brandId: string, personas: Persona[]): Fact[] {
  return personas.map((p, i) => ({
    id: `f-persona-${i + 1}`,
    brandId,
    section: 'persona',
    statement: `${p.name}: ${p.summary}`,
    confidence: 0.8,
    origin: 'research',
  }));
}

async function main() {
  const [brandId, brandUrl, appBaseArg] = process.argv.slice(2);
  if (!brandId || !brandUrl) {
    console.error('usage: npm run swarm -- <brandId> <brandUrl> [appBase]');
    process.exit(2);
  }
  const appBase = (appBaseArg || process.env.APP_BASE || 'http://localhost:3002').replace(/\/$/, '');

  const adapters = getAdapters();
  const bandChatId = await resolveBandRoom();
  console.log(`band room: ${bandChatId ? `chat ${bandChatId}` : 'none resolved — Band posts will fall back to mock'}`);
  const feed = bridgeFeed(adapters.feed, appBase, brandId, bandChatId);

  const result = await runResearchSwarm(brandId, brandUrl, { ...adapters, feed });
  if (!result.governance.ok) {
    console.error(`swarm: governance denied publish — ${result.governance.reason}`);
    process.exit(1);
  }
  if (result.facts.length === 0) {
    console.error('swarm: no verified facts extracted');
    process.exit(1);
  }

  // finalized facts (+ personas as persona-section facts) land through the
  // same route the interim researcher and INTEGRATION.md contract use
  const res = await fetch(`${appBase}/api/brands/${brandId}/facts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([...result.facts, ...personaFacts(brandId, result.personas)]),
  });
  if (!res.ok) {
    console.error(`swarm: POST /facts failed — HTTP ${res.status}`);
    process.exit(1);
  }
  const ingest = (await res.json()) as { accepted: number; dropped: number; version: number; hash: string };

  await fetch(`${appBase}/api/brands/${brandId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      step: 'research',
      status: 'done',
      payload: {
        agent: 'Swarm',
        message: `Research complete: ${ingest.accepted} facts ingested (context v${ingest.version}).`,
        facts: ingest.accepted,
        personas: result.personas.length,
        version: ingest.version,
        hash: ingest.hash,
        mode: 'swarm',
      },
    }),
  }).catch(() => {});

  console.log(
    `swarm ok: pages=${result.pages.length} facts=${result.facts.length} personas=${result.personas.length} accepted=${ingest.accepted} v${ingest.version}`,
  );
}

main().catch((e) => {
  console.error('swarm failed:', (e as Error).message);
  process.exit(1);
});
