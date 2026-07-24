import { spawn } from 'node:child_process';
import { runInterimResearch } from '@/lib/research/interim';
import { getStore } from '@/lib/store';

// Research entry point. Live default (USE_REAL_BAND=1): spawn the Band swarm
// worker (src/agents/swarm.ts — Scout/Analyst/Personasmith in their own Node
// process, coordinating through a Band room, mirrored into /events + /facts).
// Kill switch (unset/0) or any swarm failure: the interim researcher, same
// routes, same feed — the UI cannot tell the producers apart.

const SWARM_TIMEOUT_MS = 180_000;

function swarmEnabled(): boolean {
  return process.env.USE_REAL_BAND === '1' || process.env.USE_REAL_BAND === 'true';
}

function runSwarmWorker(brandId: string, url: string): Promise<number> {
  return new Promise((resolve) => {
    const appBase = `http://localhost:${process.env.PORT ?? 3002}`;
    const child = spawn('npx', ['tsx', 'src/agents/swarm.ts', brandId, url, appBase], {
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
