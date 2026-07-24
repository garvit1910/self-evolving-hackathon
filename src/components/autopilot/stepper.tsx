'use client';

import type { AutopilotEvent } from '@/lib/contracts';
import { useAutopilot } from './provider';

const STEPS: AutopilotEvent['step'][] = [
  'research',
  'context',
  'generate',
  'simulate',
  'learn',
  'writeback',
  'regenerate',
  'verdict',
];

type StepState = 'pending' | 'running' | 'done' | 'failed';

function stepState(step: AutopilotEvent['step'], events: AutopilotEvent[]): StepState {
  let state: StepState = 'pending';
  for (const e of events) {
    if (e.step !== step) continue;
    if (e.status === 'failed') return 'failed';
    if (e.status === 'done') state = 'done';
    else if (state === 'pending') state = 'running';
  }
  return state;
}

// Horizontal 8-step run indicator; visible on every page while a run is active.
export function AutopilotStepper() {
  const { status, events } = useAutopilot();
  if (status === 'idle') return null;

  return (
    <div className="border-b border-line bg-panel px-6 py-2.5">
      <ol className="flex items-center gap-1 overflow-x-auto">
        {STEPS.map((step, i) => {
          const state = stepState(step, events);
          return (
            <li key={step} className="flex items-center gap-1 whitespace-nowrap">
              {i > 0 && (
                <span
                  className={`h-px w-4 shrink-0 sm:w-7 ${state === 'pending' ? 'bg-line' : 'bg-accent'}`}
                />
              )}
              <span
                className={`flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider ${
                  state === 'done'
                    ? 'text-accent'
                    : state === 'running'
                      ? 'bg-accent-dim/40 text-accent'
                      : state === 'failed'
                        ? 'text-danger'
                        : 'text-dim'
                }`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    state === 'done'
                      ? 'bg-accent'
                      : state === 'running'
                        ? 'anim-pulse bg-accent'
                        : state === 'failed'
                          ? 'bg-danger'
                          : 'bg-line'
                  }`}
                />
                {step}
              </span>
            </li>
          );
        })}
        <li className="ml-auto hidden pl-4 font-mono text-[11px] uppercase tracking-wider text-mut md:block">
          {status === 'done' ? 'run complete' : 'autopilot running'}
        </li>
      </ol>
    </div>
  );
}
