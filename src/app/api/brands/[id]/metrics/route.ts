import type { DailyMetrics } from '@/lib/contracts';
import { getStore } from '@/lib/store';

// Live-sim persistence: the client-side market sim posts day batches so the
// flight survives reloads. Rows are keyed (adId, day) — re-posting replaces.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'body must be JSON (DailyMetrics[])' }, { status: 400 });
  }
  if (!Array.isArray(body)) {
    return Response.json({ error: 'expected DailyMetrics[]' }, { status: 400 });
  }
  const rows = body.filter(
    (m): m is DailyMetrics =>
      typeof (m as DailyMetrics)?.adId === 'string' && typeof (m as DailyMetrics)?.day === 'number',
  );
  getStore().appendMetrics(id, rows);
  return Response.json({ ok: true, count: rows.length });
}
