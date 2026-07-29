import { agentKeys, listSwarmSessions } from '@/lib/band/user';

// Swarm sessions (Band rooms titled "swarm:…"). Read agent-side — the human
// API is Enterprise-gated, so the Conductor's chat list is the source.

export async function GET() {
  if (agentKeys().length === 0) {
    return Response.json({ error: 'no Band agent credentials (band-swarm/.env)' }, { status: 503 });
  }
  try {
    return Response.json({ sessions: await listSwarmSessions() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
