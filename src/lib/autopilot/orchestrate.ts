import type { AutopilotEvent, Brief, ContextSnapshot, Creative, PanelScore } from '../contracts';
import type { Priors } from '../creative/compose';
import { DEMO_LEARNING_OPTS, DEMO_RETIREMENT_OPTS } from '../livesim';
import { marketConfigFor } from '../market-config';
import { liveSimRuntime } from './runtime';

// The one-button loop for a created brand: research (skipped when Track A's
// swarm already posted facts) → context → generate gen-1 → live thompson sim →
// learnings → write-back → regenerate gen-2 with sampled priors → verdict.
// Every step posts AutopilotEvents through the same route the swarm uses, so
// the stepper + research feed render identically for either producer.
// Client-safe: talks to the server exclusively through the HTTP routes.

type GenerateResponse = {
  creatives: Creative[];
  briefs: Brief[];
  panelScores: PanelScore[];
  mode: { copy: string; image: string };
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function runAutopilot(brandId: string): Promise<void> {
  const emit = (step: AutopilotEvent['step'], status: AutopilotEvent['status'], payload?: unknown) =>
    post(`/api/brands/${brandId}/events`, { step, status, payload, ts: Date.now() }).catch(
      () => {},
    );
  let currentStep: AutopilotEvent['step'] = 'research';

  try {
    // 1 — research (skip when facts already posted by the real swarm)
    const before = await get<ContextSnapshot>(`/api/brands/${brandId}/context`);
    if (before.facts.length === 0) {
      await post(`/api/brands/${brandId}/research`, {}); // route emits its own events
    } else {
      await emit('research', 'done', {
        facts: before.facts.length,
        message: 'Facts already posted by the research swarm — skipping interim researcher.',
      });
    }

    // 2 — context ready
    currentStep = 'context';
    const context = await get<ContextSnapshot>(`/api/brands/${brandId}/context`);
    await emit('context', 'running', {
      message: `Compiling ${context.facts.length} facts into context v${context.version}.`,
    });
    await emit('context', 'done', {
      version: context.version,
      hash: context.hash,
      facts: context.facts.length,
    });

    // 3 — generate gen-1 (real images with the uploaded product photo)
    currentStep = 'generate';
    await emit('generate', 'running', {
      message: 'Composing briefs → ad copy → product-photo image generation.',
    });
    const gen1 = await post<GenerateResponse>(`/api/brands/${brandId}/generate`, {
      generation: 1,
    });
    await emit('generate', 'done', {
      creatives: gen1.creatives.length,
      generation: 1,
      copyMode: gen1.mode.copy,
      imageMode: gen1.mode.image,
      creativeIds: gen1.creatives.map((c) => c.id),
    });

    // 4 — live simulated market, thompson allocation
    currentStep = 'simulate';
    await emit('simulate', 'running', {
      day: 0,
      message: 'Flight started: 10,000 impressions/day, thompson allocation, seed 42.',
    });
    liveSimRuntime.init({
      config: marketConfigFor(brandId, gen1.creatives),
      creatives: gen1.creatives,
      panelScores: gen1.panelScores,
      seed: 42,
      allocator: 'thompson',
      learningOpts: DEMO_LEARNING_OPTS,
      retirementOpts: DEMO_RETIREMENT_OPTS,
      autoGen2: false, // gen-2 arrives via the real /generate route below
    });

    let regenerating = false;
    const regenerate = async (priors: Priors) => {
      // hold the market while learnings feed back + gen-2 renders
      liveSimRuntime.pause();
      currentStep = 'writeback';
      await emit('writeback', 'running', {
        message: 'Writing performance facts back into brand context.',
      });
      const wb = await post<{ version: number; hash: string; factIds: string[]; learningIds?: string[] }>(
        `/api/brands/${brandId}/writeback`,
        {},
      );
      // flip sensoIngested through the existing route so /learnings shows "written back"
      for (const learningId of wb.learningIds ?? []) {
        await post(`/api/learnings/${learningId}/ingested`, { brandId }).catch(() => {});
      }
      await emit('writeback', 'done', {
        version: wb.version,
        hash: wb.hash,
        factIds: wb.factIds,
        sensoIngested: (wb.learningIds ?? []).length,
      });

      currentStep = 'regenerate';
      await emit('regenerate', 'running', {
        message: `Breeding gen-2 briefs from the winning genome (${priors.angle} forward).`,
      });
      const gen2 = await post<GenerateResponse>(`/api/brands/${brandId}/generate`, {
        generation: 2,
        priors,
      });
      liveSimRuntime.addCreatives(gen2.creatives, gen2.panelScores);
      await emit('regenerate', 'done', {
        creatives: gen2.creatives.length,
        generation: 2,
        imageMode: gen2.mode.image,
        creativeIds: gen2.creatives.map((c) => c.id),
      });
      liveSimRuntime.play();
    };

    liveSimRuntime.onStep(({ dayMetrics, events }) => {
      void post(`/api/brands/${brandId}/metrics`, dayMetrics).catch(() => {});
      for (const e of events) {
        if (e.type === 'learning') {
          void post(`/api/brands/${brandId}/learnings`, [e.learning])
            .then(() =>
              emit('learn', 'done', {
                learningId: e.learning.id,
                headline: e.learning.statement,
              }),
            )
            .catch(() => {});
        }
        if (e.type === 'trigger_regeneration' && !regenerating) {
          regenerating = true;
          void regenerate(e.priors).catch((err) => {
            void emit(currentStep, 'failed', { message: String(err) });
            liveSimRuntime.play(); // keep the market alive even if regen died
          });
        }
        if (e.type === 'verdict') {
          void emit('simulate', 'done', {
            days: e.day,
            message: `Flight goal reached on day ${e.day}.`,
          });
          void emit('verdict', 'done', {
            verdict: e.comparison.verdict,
            gen1Ctr: e.comparison.gen1Ctr,
            gen2Ctr: e.comparison.gen2Ctr,
            message:
              e.comparison.verdict === 'gen2_wins'
                ? `Gen 2 beats gen 1 — CTR ${(e.comparison.gen2Ctr * 100).toFixed(2)}% vs ${(e.comparison.gen1Ctr * 100).toFixed(2)}%. Context evolved v1 → v2.`
                : 'Gen 1 holds — regenerated creatives did not separate.',
          });
        }
        if (e.type === 'day' && e.day % 5 === 0) {
          void emit('simulate', 'running', { day: e.day, message: `Day ${e.day} complete.` });
        }
      }
    });
    liveSimRuntime.play();
  } catch (err) {
    await emit(currentStep, 'failed', { message: String(err) });
    throw err;
  }
}
