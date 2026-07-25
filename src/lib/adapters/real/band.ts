/**
 * Band — real agent-room feed adapter. REST base: https://app.band.ai/api/v1
 * Docs: https://docs.band.ai/api/introduction , /websocket/overview
 *
 * Model: rooms are "chats" (UUID) created from the Band DASHBOARD (there is no
 * agent-side create endpoint) — the human clicks "New Session" and adds the
 * agent; the chat then appears in GET /agent/chats. Auth via `X-API-Key`
 * (an AGENT key; /me/* human endpoints reject it — confirmed live).
 *
 * Endpoints (confirmed live against the API validator):
 *   GET  /api/v1/agent/me                       — agent identity
 *   GET  /api/v1/agent/peers                    — humans + sibling agents
 *   GET  /api/v1/agent/chats                    — chats this agent is in
 *   POST /api/v1/agent/chats/{id}/events        — {event:{message_type,content}} → 201
 *   POST /api/v1/agent/chats/{id}/messages      — {message:{content,mentions:[{id}]}}
 *                                                  mentions REQUIRED (minItems 1) and
 *                                                  must resolve to chat participants
 *   GET  /api/v1/agent/chats/{id}/context       — messages sent/mentioned-in
 *
 * THE DASHBOARD RENDERS MESSAGES, NOT EVENTS — so this adapter posts every
 * feed item as an event (cheap telemetry) AND message-worthy items as real
 * messages, mentioning a resolved peer (sibling agent first, else the owning
 * human). Falls back to mock on any error (withFallback in adapters/index).
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

type Peer = { id: string; name?: string; type?: string };

/** Chats this agent participates in, newest first. Empty until the human
 *  creates a session with the agent in the Band dashboard. */
export async function listBandChats(): Promise<{ id: string; title?: string }[]> {
  const { url, key } = base();
  const res = await fetch(`${url}/chats`, { headers: headers(key) });
  if (!res.ok) return [];
  const j = (await res.json()) as { data?: { id: string; title?: string; inserted_at?: string }[] };
  const arr = Array.isArray(j.data) ? j.data : [];
  return [...arr].sort((a, b) => String(b.inserted_at ?? '').localeCompare(String(a.inserted_at ?? '')));
}

/** Mention targets, best first: sibling agents (the cross-agent story), then
 *  the owning human. Cached per process. */
let peerCache: Peer[] | null = null;
async function mentionTargets(): Promise<Peer[]> {
  if (peerCache) return peerCache;
  const { url, key } = base();
  try {
    const res = await fetch(`${url}/peers`, { headers: headers(key) });
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: Peer[] };
    const peers = Array.isArray(j.data) ? j.data : [];
    peerCache = [
      ...peers.filter((p) => p.type === 'Agent'),
      ...peers.filter((p) => p.type === 'User'),
    ];
  } catch {
    peerCache = [];
  }
  return peerCache;
}

/** Message kinds worth a real chat message (events carry the rest). */
const MESSAGE_KINDS = new Set(['thought', 'tool_result', 'error']);

export function createBandFeed(): Feed {
  // remember which mention target actually resolves in this chat (404 = the
  // peer is not a participant of the session; try the next one)
  let workingMention: Peer | null | undefined;

  async function postMessage(room: string, content: string): Promise<void> {
    const { url, key } = base();
    const candidates = workingMention ? [workingMention] : await mentionTargets();
    for (const peer of candidates) {
      const res = await fetch(`${url}/chats/${encodeURIComponent(room)}/messages`, {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify({ message: { content, mentions: [{ id: peer.id }] } }),
      });
      if (res.ok) {
        workingMention = peer;
        return;
      }
      if (res.status !== 404) {
        throw new Error(`Band message ${res.status}: ${await res.text()}`);
      }
    }
    // no peer resolved as a participant — events still flow, message skipped
  }

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
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const pretty =
        typeof payload.__message === 'string'
          ? payload.__message
          : JSON.stringify(event.payload);
      const content = `[${event.agent}] ${pretty}`;
      const res = await fetch(`${url}/chats/${encodeURIComponent(room)}/events`, {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify({ event: { message_type: event.kind, content } }),
      });
      if (!res.ok) throw new Error(`Band post ${res.status}: ${await res.text()}`);
      if (MESSAGE_KINDS.has(event.kind)) {
        await postMessage(room, content).catch((err) => {
          console.warn(`[band] message skipped: ${(err as Error).message.slice(0, 120)}`);
        });
      }
    },
  };
}
