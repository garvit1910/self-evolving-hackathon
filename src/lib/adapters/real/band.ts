/**
 * Band — real agent-room feed adapter. REST base: https://app.band.ai/api/v1
 * Docs: https://docs.band.ai/api/introduction , /websocket/overview
 *
 * Model: rooms are "chats" (UUID). Auth via `X-API-Key: <agent key>` (the key
 * identifies both agent and owning human). Our use: the server posts swarm
 * findings into a chat as structured EVENTS (thoughts/tool results); the UI
 * mirrors them via our own DB. Band remains the agent-side bus.
 *
 *   POST /api/v1/agent/chats/{id}/participants   — add agent to a chat
 *   POST /api/v1/agent/chats/{id}/events         — structured event (what we use)
 *   POST /api/v1/agent/chats/{id}/messages       — text message (needs @mention)
 *   GET  /api/v1/agent/chats/{id}/context        — messages agent sent or @mentioned in
 *
 * WS (for live agents, not this server adapter):
 *   wss://app.band.ai/api/v1/socket/websocket?api_key=<key>&vsn=2.0.0
 *   join: ["1","1","chat_room:{roomId}","phx_join",{}] ; heartbeat every 30s.
 *
 * NOTE: `room` here is the Band chat id (UUID). Set BAND_API_KEY, BAND_REST_URL.
 * Falls back to mock on any error (see withFallback in adapters/index).
 */

import type { Feed } from '../interfaces';

function base() {
  const root = (process.env.BAND_REST_URL ?? 'https://app.band.ai').replace(/\/$/, '');
  const key = process.env.BAND_API_KEY;
  if (!key) throw new Error('BAND_API_KEY not set');
  return { url: `${root}/api/v1/agent`, key };
}

function headers(key: string) {
  return { 'content-type': 'application/json', 'X-API-Key': key };
}

export function createBandFeed(): Feed {
  return {
    async join(room: string): Promise<void> {
      const { url, key } = base();
      // best-effort: add this agent as a participant; non-fatal if already present.
      await fetch(`${url}/chats/${encodeURIComponent(room)}/participants`, {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify({}),
      }).catch(() => {});
    },
    async post(room, event): Promise<void> {
      const { url, key } = base();
      const res = await fetch(`${url}/chats/${encodeURIComponent(room)}/events`, {
        method: 'POST',
        headers: headers(key),
        // event kinds: "thought" | "tool_call" | "tool_result" | "error"
        body: JSON.stringify({
          event_type: event.kind,
          data: { agent: event.agent, payload: event.payload },
        }),
      });
      if (!res.ok) throw new Error(`Band post ${res.status}: ${await res.text()}`);
    },
  };
}
