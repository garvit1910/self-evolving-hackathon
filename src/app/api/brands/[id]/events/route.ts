import type { AutopilotEvent } from '@/lib/contracts';
import { getStore } from '@/lib/store';

const STEPS = new Set<AutopilotEvent['step']>([
  'research',
  'context',
  'generate',
  'simulate',
  'learn',
  'writeback',
  'regenerate',
  'verdict',
]);
const STATUSES = new Set<AutopilotEvent['status']>(['running', 'done', 'failed']);

// The research feed and autopilot stepper poll GET ?since=<ts>; the orchestrator,
// interim researcher, and Track A's swarm all POST here — the UI cannot tell
// them apart, which is the point.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const raw = Array.isArray(body) ? body : [body];
  const events: AutopilotEvent[] = [];
  for (const item of raw) {
    const e = item as Partial<AutopilotEvent>;
    if (!STEPS.has(e.step as AutopilotEvent['step'])) continue;
    if (!STATUSES.has(e.status as AutopilotEvent['status'])) continue;
    events.push({
      step: e.step as AutopilotEvent['step'],
      status: e.status as AutopilotEvent['status'],
      payload: e.payload,
      ts: typeof e.ts === 'number' ? e.ts : Date.now(),
    });
  }
  getStore().appendEvents(id, events);
  return Response.json({ ok: true, count: events.length });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const since = new URL(request.url).searchParams.get('since');
  const events = getStore().getEvents(id, since === null ? undefined : Number(since));
  return Response.json({ events });
}
