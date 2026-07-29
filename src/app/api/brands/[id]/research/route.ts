import { spawn } from 'node:child_process';
import { runInterimResearch } from '@/lib/research/interim';
import { getStore } from '@/lib/store';

// Research entry point. Live default (USE_REAL_BAND=1): kick off the Band
// swarm (band-swarm/ — six real Band agents conversing in a room; kickoff.py
// posts the opening mention and waits for facts to land via /facts, with the
// conversation mirrored into /events). The agents themselves must already be
// running: `cd band-swarm && uv run python run_swarm.py`. Legacy escape hatch:
// BAND_KICKOFF=ts spawns the old single-identity worker (src/agents/swarm.ts).
// Kill switch (unset/0) or any swarm failure: the interim researcher, same
// routes, same feed — the UI cannot tell the producers apart.

// A seven-agent conversation (parallel competitor branch, Critic revision
// rounds) runs well past the old 180s single-process budget. Must stay above
// kickoff.py's KICKOFF_TIMEOUT_S (600s) so the child exits on its own.
const SWARM_TIMEOUT_MS = 660_000;

function swarmEnabled(): boolean {
  return process.env.USE_REAL_BAND === '1' || process.env.USE_REAL_BAND === 'true';
}

function runSwarmWorker(brandId: string, url: string): Promise<number> {
  return new Promise((resolve) => {
    const appBase = `http://localhost:${process.env.PORT ?? 3002}`;
    const legacy = process.env.BAND_KICKOFF === 'ts';
    const cmd = legacy ? 'npx' : 'uv';
    const args = legacy
      ? ['tsx', 'src/agents/swarm.ts', brandId, url, appBase]
      : ['run', '--project', 'band-swarm', 'python', 'band-swarm/kickoff.py', brandId, url, appBase];
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(-1);
    }, SWARM_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? -1);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(-1);
    });
  });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const brand = store.getBrand(id);
  if (!brand) return Response.json({ error: `unknown brand: ${id}` }, { status: 404 });

  if (swarmEnabled()) {
    const before = store.getFacts(id).length;
    const code = await runSwarmWorker(id, brand.url);
    const factCount = store.getFacts(id).length - before;
    if (code === 0 && factCount > 0) {
      return Response.json({ factCount, droppedQuotes: 0, mode: 'swarm' });
    }
    store.appendEvents(id, [
      {
        step: 'research',
        status: 'running',
        ts: Date.now(),
        payload: {
          agent: 'Autopilot',
          message: `Swarm unavailable (exit ${code}) — falling back to interim researcher.`,
        },
      },
    ]);
  }

  const result = await runInterimResearch({
    brandId: id,
    url: brand.url,
    postEvent: (event) => {
      store.appendEvents(id, [{ ...event, ts: Date.now() }]);
    },
  });
  return Response.json(result);
}
