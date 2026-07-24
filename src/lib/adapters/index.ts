/**
 * Adapter assembly. One place decides real-vs-mock per sponsor, wraps each in the
 * record/replay tape, and guarantees a mock fallback if a real call throws.
 *
 * Resting state = mock. A sponsor goes live only when USE_REAL_<X>=1 is set.
 * Golden demo: TAPE_MODE=replay. Rehearsal (fills tapes): TAPE_MODE=record.
 */

import { withTape, type TapeMode } from './record-replay';
import { createMockAdapters } from './mocks';
import { createPioneerLLM } from './real/pioneer';
import { createBandFeed } from './real/band';
import { createSensoContextStore } from './real/senso';
import { createActianVectorStore } from './real/actian';
import { createGeminiImageGen } from './real/gemini';

// Guild: cut per plan fallback. Guild's real integration model is "deploy a
// TypeScript agent to their hosted runtime" (guild agent init/save/publish),
// not a REST authorize call — confirmed via `guild api`/CLI probing, no
// workspace or agent existed on the account. Too large a lift for the spike
// window. Governance stays the client-side observable-veto mock below; Band
// still carries the agent-infra story per the plan's own fallback.

function flag(name: string): boolean {
  return process.env[name] === '1' || process.env[name] === 'true';
}

function tapeMode(): TapeMode {
  const m = (process.env.TAPE_MODE ?? 'live').toLowerCase();
  return m === 'record' || m === 'replay' ? m : 'live';
}

/** Wrap a real adapter so any thrown method silently falls back to the mock's method. */
function withFallback<T extends object>(real: T, mock: T): T {
  return new Proxy(real, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== 'function') return orig;
      return async (...args: unknown[]) => {
        try {
          return await (orig as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        } catch (err) {
          console.warn(`[adapter fallback] ${String(prop)} → mock:`, (err as Error).message);
          const mfn = (mock as Record<string, unknown>)[prop as string] as (
            ...a: unknown[]
          ) => Promise<unknown>;
          return mfn.apply(mock, args);
        }
      };
    },
  }) as T;
}

/**
 * Assemble the live adapter set for a run. `pick(real, mock, flagName, tapeName)`
 * chooses real (with fallback) when the flag is on, then tapes the result.
 */
export function getAdapters() {
  const mock = createMockAdapters();
  const mode = tapeMode();

  const pick = <T extends object>(flagName: string, tapeName: string, real: () => T, m: T): T => {
    const chosen = flag(flagName) ? withFallback(real(), m) : m;
    return withTape(tapeName, chosen, mode);
  };

  return {
    context: pick('USE_REAL_SENSO', 'senso', createSensoContextStore, mock.context),
    llm: pick('USE_REAL_PIONEER', 'pioneer', createPioneerLLM, mock.llm),
    vector: pick('USE_REAL_ACTIAN', 'actian', createActianVectorStore, mock.vector),
    feed: pick('USE_REAL_BAND', 'band', createBandFeed, mock.feed),
    governance: withTape('governance', mock.governance, mode),
    imageGen: pick('USE_REAL_GEMINI', 'gemini', createGeminiImageGen, mock.imageGen),
  };
}

export type Adapters = ReturnType<typeof getAdapters>;
