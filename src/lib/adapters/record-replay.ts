/**
 * LIVE / RECORD / REPLAY wrapper — the golden-run safety net.
 *
 * Wrap ANY adapter object; its async methods are transparently taped:
 *   - LIVE   : call through, no tape.
 *   - RECORD : call through (real), tee the result to tape keyed by (method,args).
 *              Tee-on-live: every rehearsal call fills the tape for free.
 *   - REPLAY : return the taped result; on a miss, fall through to the real call
 *              (which, in demo, is usually the mock) so nothing ever hangs.
 *
 * canonicalizeKey normalizes args so replay keys are deterministic — the single
 * load-bearing detail. Keep volatile fields (timestamps, nonces) out of args.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type TapeMode = 'live' | 'record' | 'replay';

const TAPE_DIR = join(process.cwd(), 'tapes');

function tapePath(name: string) {
  return join(TAPE_DIR, `${name}.json`);
}

function loadTape(name: string): Record<string, unknown> {
  const p = tapePath(name);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function saveTape(name: string, tape: Record<string, unknown>) {
  mkdirSync(TAPE_DIR, { recursive: true });
  writeFileSync(tapePath(name), JSON.stringify(tape, null, 2));
}

/** deterministic key from method + args (recursively key-sorted). */
export function canonicalizeKey(method: string, args: unknown[]): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, norm(val)]),
      );
    }
    return v;
  };
  return `${method}:${JSON.stringify(norm(args))}`;
}

/**
 * Wrap an adapter so every async method is taped. `name` scopes the tape file
 * (one per sponsor, e.g. "senso"). Non-function props pass through untouched.
 */
export function withTape<T extends object>(name: string, adapter: T, mode: TapeMode): T {
  if (mode === 'live') return adapter;

  const tape = loadTape(name);

  return new Proxy(adapter, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== 'function') return orig;
      const method = String(prop);

      return async (...args: unknown[]) => {
        const key = canonicalizeKey(method, args);

        if (mode === 'replay' && key in tape) {
          return tape[key];
        }

        // record, or replay-miss → call the real method
        const result = await (orig as (...a: unknown[]) => Promise<unknown>).apply(target, args);

        if (mode === 'record') {
          tape[key] = result;
          saveTape(name, tape);
        }
        return result;
      };
    },
  }) as T;
}
