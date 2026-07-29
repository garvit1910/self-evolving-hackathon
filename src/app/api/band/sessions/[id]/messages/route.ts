import { agentKeys, roomTranscript } from '@/lib/band/user';

// Full transcript of one Band room — union of every swarm agent's scoped
// context (their own messages + thoughts + tool telemetry + anything that
// mentions them). The /research page's Band-room panel polls this.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (agentKeys().length === 0) {
    return Response.json({ error: 'no Band agent credentials (band-swarm/.env)' }, { status: 503 });
  }
  try {
    return Response.json({ messages: await roomTranscript(id) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
