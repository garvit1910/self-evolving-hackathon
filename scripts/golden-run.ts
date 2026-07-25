/**
 * Golden run (Phase 6): one autopilot chain on a FRESH brand with all real
 * integrations on, then persist the ENTIRE run under public/runs/golden/ so
 * replay needs zero network.
 *
 *   npx tsx --env-file=.env.local scripts/golden-run.ts <brandUrl> <productImagePath> [appBase]
 *
 * Chain (same routes the one-button UI autopilot drives): create brand with
 * product photo → research (Band swarm via the route when USE_REAL_BAND=1 on
 * the server, else the worker directly) → gen-1 (real images) → Thompson
 * livesim → learning → writeback (Senso + hash flip + sensoIngested) → gen-2
 * with sampled priors → verdict. Captures events, facts, briefs, creatives +
 * image files, metrics, learnings, panel scores, brand, and a manifest.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Brief, ContextSnapshot, Creative, PanelScore } from '../src/lib/contracts';
import {
  DEMO_LEARNING_OPTS,
  DEMO_RETIREMENT_OPTS,
  createLiveSim,
  type LiveSimEvent,
} from '../src/lib/livesim';
import { marketConfigFor } from '../src/lib/market-config';

const [brandUrl = 'https://magicspoon.com', productImagePath, appBaseArg] = process.argv.slice(2);
const BASE = (appBaseArg ?? 'http://localhost:3002').replace(/\/$/, '');

type GenerateResponse = {
  creatives: Creative[];
  briefs: Brief[];
  panelScores: PanelScore[];
  mode: { copy: string; image: string };
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

function fail(msg: string): never {
  console.error(`❌ GOLDEN RUN FAILED: ${msg}`);
  process.exit(1);
}

async function main() {
  const t0 = Date.now();
  if (!productImagePath || !existsSync(productImagePath)) {
    fail('pass the product image path as the second argument');
  }

  // 1 — brand with product photo (multipart, the real onboarding route)
  const form = new FormData();
  form.set('url', brandUrl);
  form.set('name', 'Magic Spoon');
  form.set(
    'productImage',
    new Blob([readFileSync(productImagePath)], { type: 'image/png' }),
    'product.png',
  );
  const createRes = await fetch(`${BASE}/api/brands`, { method: 'POST', body: form });
  if (!createRes.ok) fail(`POST /api/brands → ${createRes.status}`);
  const { brandId } = (await createRes.json()) as { brandId: string };
  console.log(`brand: ${brandId}`);

  // 2 — research. SWARM=1 spawns the Band swarm worker directly (bypasses the
  // server's USE_REAL_BAND flag); otherwise POST /research lets the server
  // decide (swarm when USE_REAL_BAND=1 in its env, else interim).
  let t = Date.now();
  let research: { factCount: number; mode: string };
  if (process.env.SWARM === '1') {
    const { execFileSync } = await import('node:child_process');
    execFileSync('npx', ['tsx', 'src/agents/swarm.ts', brandId, brandUrl, BASE], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      timeout: 240_000,
    });
    const ctx = await get<ContextSnapshot>(`/api/brands/${brandId}/context`);
    research = { factCount: ctx.facts.length, mode: 'swarm' };
  } else {
    research = await post<{ factCount: number; mode: string }>(`/api/brands/${brandId}/research`, {});
  }
  console.log(`research: ${research.factCount} facts via ${research.mode} (${Date.now() - t}ms)`);
  if (research.factCount < 8) fail(`research produced ${research.factCount} facts (<8)`);

  const ctx1 = await get<ContextSnapshot>(`/api/brands/${brandId}/context`);
  console.log(`context v${ctx1.version} hash=${ctx1.hash} facts=${ctx1.facts.length}`);

  // 3 — gen-1
  t = Date.now();
  const gen1 = await post<GenerateResponse>(`/api/brands/${brandId}/generate`, { generation: 1 });
  console.log(`gen-1: ${gen1.creatives.length} creatives copy=${gen1.mode.copy} image=${gen1.mode.image} (${Date.now() - t}ms)`);

  // 4 — market → learning → writeback → gen-2 → verdict
  const sim = createLiveSim({
    config: marketConfigFor(brandId, gen1.creatives),
    creatives: gen1.creatives,
    panelScores: gen1.panelScores,
    seed: 42,
    allocator: 'thompson',
    learningOpts: DEMO_LEARNING_OPTS,
    retirementOpts: DEMO_RETIREMENT_OPTS,
  });
  let gen2: GenerateResponse | null = null;
  let verdict: Extract<LiveSimEvent, { type: 'verdict' }> | null = null;
  let wbInfo = '';
  for (let d = 1; d <= 40 && !verdict; d++) {
    const { dayMetrics, events } = sim.stepDay();
    await post(`/api/brands/${brandId}/metrics`, dayMetrics).catch(() => {});
    for (const e of events) {
      if (e.type === 'learning') {
        await post(`/api/brands/${brandId}/learnings`, [e.learning]).catch(() => {});
        console.log(`day ${e.day}: learning — ${e.learning.statement.slice(0, 80)}`);
      }
      if (e.type === 'trigger_regeneration' && !gen2) {
        const wb = await post<{ version: number; hash: string; learningIds?: string[] }>(
          `/api/brands/${brandId}/writeback`,
          {},
        );
        for (const lid of wb.learningIds ?? []) {
          await post(`/api/learnings/${lid}/ingested`, { brandId }).catch(() => {});
        }
        wbInfo = `v${wb.version} hash=${wb.hash}`;
        console.log(`day ${e.day}: writeback ${wbInfo} (+ingested×${(wb.learningIds ?? []).length})`);
        gen2 = await post<GenerateResponse>(`/api/brands/${brandId}/generate`, {
          generation: 2,
          priors: e.priors,
        });
        console.log(`day ${e.day}: gen-2 ${gen2.creatives.length} creatives image=${gen2.mode.image} angle="${e.priors.angle}"`);
        sim.addCreatives(gen2.creatives, gen2.panelScores);
      }
      if (e.type === 'verdict') verdict = e;
    }
  }
  if (!gen2 || !verdict) fail('loop did not complete (no gen-2 or verdict)');
  console.log(`verdict day ${verdict.day}: ${verdict.comparison.verdict} (gen1 ${(verdict.comparison.gen1Ctr * 100).toFixed(2)}% vs gen2 ${(verdict.comparison.gen2Ctr * 100).toFixed(2)}%)`);

  // 5 — capture everything under public/runs/golden/
  const dataRoot = process.env.DATA_DIR ?? join(process.cwd(), '.data');
  const goldenDir = join(process.cwd(), 'public', 'runs', 'golden');
  rmSync(goldenDir, { recursive: true, force: true });
  mkdirSync(join(goldenDir, 'images'), { recursive: true });

  const brandDir = join(dataRoot, 'brands', brandId);
  for (const f of readdirSync(brandDir)) {
    cpSync(join(brandDir, f), join(goldenDir, f));
  }
  const creativesDir = join(dataRoot, 'creatives', brandId);
  if (existsSync(creativesDir)) {
    for (const f of readdirSync(creativesDir)) {
      cpSync(join(creativesDir, f), join(goldenDir, 'images', f));
    }
  }
  const uploadsDir = join(dataRoot, 'uploads', brandId);
  if (existsSync(uploadsDir)) {
    for (const f of readdirSync(uploadsDir)) {
      cpSync(join(uploadsDir, f), join(goldenDir, 'images', f));
    }
  }
  // rewrite image urls to the static golden copies so replay needs no API
  const creativesJson = JSON.parse(readFileSync(join(goldenDir, 'creatives.json'), 'utf8')) as Creative[];
  for (const c of creativesJson) {
    c.imageUrl = c.imageUrl.replace(`/api/files/creatives/${brandId}/`, '/runs/golden/images/');
  }
  writeFileSync(join(goldenDir, 'creatives.json'), JSON.stringify(creativesJson, null, 2));

  writeFileSync(
    join(goldenDir, 'manifest.json'),
    JSON.stringify(
      {
        brandId,
        brandUrl,
        capturedAt: new Date().toISOString(),
        research: { facts: research.factCount, mode: research.mode },
        gen1: { creatives: gen1.creatives.length, copy: gen1.mode.copy, image: gen1.mode.image },
        gen2: { creatives: gen2.creatives.length, image: gen2.mode.image },
        writeback: wbInfo,
        verdict: {
          day: verdict.day,
          result: verdict.comparison.verdict,
          gen1Ctr: verdict.comparison.gen1Ctr,
          gen2Ctr: verdict.comparison.gen2Ctr,
        },
        files: readdirSync(goldenDir).sort(),
        wallClockSeconds: Math.round((Date.now() - t0) / 1000),
      },
      null,
      2,
    ),
  );
  console.log(`✅ GOLDEN RUN OK — captured to public/runs/golden/ (${Math.round((Date.now() - t0) / 1000)}s)`);
}

main().catch((e) => fail((e as Error).message));
