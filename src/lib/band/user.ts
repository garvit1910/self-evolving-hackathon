/**
 * Band room reader (server-only) — powers the in-app Band room view.
 *
 * Band's human API (GET /api/v1/me/chats/…) is Enterprise-gated, so the full
 * transcript is reconstructed from the AGENT side instead: each swarm agent's
 * GET /api/v1/agent/chats/{id}/context returns that agent's own messages (all
 * types — text, thought, tool telemetry) plus messages that @mention it.
 * Band requires every chat message to mention someone, so the union across
 * all seven agents IS the complete room. Credentials come from band-swarm/.env
 * (the swarm project is the credential home — nothing to copy).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROLES = ['conductor', 'cartographer', 'scout', 'analyst', 'critic', 'personasmith', 'competitor'];

const BASE = () => (process.env.BAND_REST_URL ?? 'https://app.band.ai').replace(/\/$/, '');

let cachedEnv: Record<string, string> | undefined;

function swarmEnv(): Record<string, string> {
  if (cachedEnv) return cachedEnv;
  cachedEnv = {};
  try {
    for (const line of readFileSync(path.join(process.cwd(), 'band-swarm', '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) cachedEnv[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // band-swarm/.env absent (e.g. deployed container) — env vars may still be set
  }
  return cachedEnv;
}

function keyFor(role: string): string | null {
  const name = `${role.toUpperCase()}_API_KEY`;
  return process.env[name] || swarmEnv()[name] || null;
}

export function agentKeys(): { role: string; key: string }[] {
  return ROLES.flatMap((role) => {
    const key = keyFor(role);
    return key ? [{ role, key }] : [];
  });
}

async function agentGet<T>(key: string, pathname: string): Promise<T> {
  const res = await fetch(`${BASE()}/api/v1/agent${pathname}`, {
    headers: { 'X-API-Key': key },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Band agent${pathname} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export type BandSession = { id: string; title: string; insertedAt: string };

type RawChat = { id: string; title?: string | null; inserted_at?: string };
type RawMessage = {
  id: string;
  content: string;
  message_type: string;
  sender_id: string;
  sender_name?: string | null;
  sender_type: string;
  inserted_at?: string;
  metadata?: { mentions?: { id: string; name?: string; handle?: string }[] } & Record<string, unknown>;
};

/** Swarm rooms (title "swarm:…") the Conductor belongs to, newest first. */
export async function listSwarmSessions(): Promise<BandSession[]> {
  const conductor = keyFor('conductor');
  if (!conductor) throw new Error('no Band agent credentials found');
  const { data } = await agentGet<{ data: RawChat[] }>(conductor, '/chats');
  return data
    .filter((c) => (c.title ?? '').startsWith('swarm:'))
    .map((c) => ({ id: c.id, title: c.title ?? c.id, insertedAt: c.inserted_at ?? '' }))
    .sort((a, b) => (a.insertedAt < b.insertedAt ? 1 : -1));
}

export type TranscriptMessage = {
  id: string;
  sender: string;
  senderType: 'User' | 'Agent' | string;
  kind: string; // text | thought | tool_call | tool_result | error | task
  content: string;
  ts: string;
};

/** Mentions arrive as "@[[uuid]]" — swap in the display name from metadata. */
function prettifyMentions(msg: RawMessage): string {
  let content = msg.content;
  for (const m of msg.metadata?.mentions ?? []) {
    if (m.id && m.name) content = content.split(`@[[${m.id}]]`).join(`@${m.name}`);
  }
  return content.replace(/@\[\[[0-9a-f-]{16,}\]\]/gi, '@agent');
}

/** Full room transcript: union of every agent's scoped context, deduped by
 *  message id, oldest first. Agents not in the room (404) are skipped. */
export async function roomTranscript(roomId: string): Promise<TranscriptMessage[]> {
  const views = await Promise.all(
    agentKeys().map(async ({ key }) => {
      try {
        const { data } = await agentGet<{ data: RawMessage[] }>(
          key,
          `/chats/${encodeURIComponent(roomId)}/context?limit=100`,
        );
        return data;
      } catch {
        return [] as RawMessage[];
      }
    }),
  );
  const byId = new Map<string, RawMessage>();
  for (const view of views) for (const m of view) byId.set(m.id, m);
  return [...byId.values()]
    .map((m) => ({
      id: m.id,
      sender: m.sender_name ?? 'unknown',
      senderType: m.sender_type,
      kind: m.message_type,
      content: prettifyMentions(m),
      ts: m.inserted_at ?? '',
    }))
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));
}
