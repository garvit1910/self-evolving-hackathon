import type { Creative, PanelScore } from '../contracts';
import { gen2Creatives } from '@/fixtures/creatives-gen2';
import { gen2PanelScores } from '@/fixtures/panel-scores-gen2';
import {
  createLiveSim,
  type LiveSim,
  type LiveSimEvent,
  type LiveSimOpts,
  type LiveSimSnapshot,
} from '../livesim';

// Client-side singleton owning the live sim instance + tick timer, so the
// autopilot orchestrator (layout-level provider) and the /market Live view
// drive the SAME flight across route navigation. useSyncExternalStore API.
// Pure TS — no React imports, node-testable.

export type StepResult = { dayMetrics: LiveSimSnapshot['metrics']; events: LiveSimEvent[] };

export type RuntimeInitOpts = LiveSimOpts & {
  /** Fixture-brand mode: join the gen-2 fixture creatives on trigger automatically. */
  autoGen2?: boolean;
};

const MAX_DAY = 60;
const BASE_MS_PER_DAY = 900;

type Listener = () => void;
type StepListener = (result: StepResult) => void;

class LiveSimRuntime {
  private sim: LiveSim | null = null;
  private initOpts: RuntimeInitOpts | null = null;
  private snapshot: LiveSimSnapshot | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private playingState = false;
  private speedState = 1;
  private gen2Joined = false;
  private listeners = new Set<Listener>();
  private stepListeners = new Set<StepListener>();

  init(opts: RuntimeInitOpts): void {
    this.stopTimer();
    this.initOpts = opts;
    this.sim = createLiveSim(opts);
    this.gen2Joined = false;
    this.playingState = false;
    this.snapshot = this.sim.getState();
    this.notify();
  }

  isInitialized(): boolean {
    return this.sim !== null;
  }

  stepOnce(): void {
    if (!this.sim) return;
    if (this.snapshot && this.snapshot.day >= MAX_DAY) {
      this.pause();
      return;
    }
    const result = this.sim.stepDay();
    if (
      this.initOpts?.autoGen2 &&
      !this.gen2Joined &&
      result.events.some((e) => e.type === 'trigger_regeneration')
    ) {
      this.gen2Joined = true;
      this.sim.addCreatives(gen2Creatives, gen2PanelScores);
    }
    this.snapshot = this.sim.getState();
    for (const cb of this.stepListeners) cb(result);
    this.notify();
  }

  addCreatives(creatives: Creative[], scores: PanelScore[]): void {
    if (!this.sim) return;
    this.gen2Joined = true;
    this.sim.addCreatives(creatives, scores);
    this.snapshot = this.sim.getState();
    this.notify();
  }

  play(): void {
    if (!this.sim || this.playingState) return;
    this.playingState = true;
    this.startTimer();
    this.notify();
  }

  pause(): void {
    this.playingState = false;
    this.stopTimer();
    this.notify();
  }

  setSpeed(speed: number): void {
    this.speedState = speed;
    if (this.playingState) this.startTimer();
    this.notify();
  }

  /** Re-runs the same flight from day 0 (same seed unless overridden). */
  reset(overrides?: Partial<RuntimeInitOpts>): void {
    if (!this.initOpts) return;
    this.init({ ...this.initOpts, ...overrides });
  }

  /** Full teardown — back to the uninitialized state. */
  clear(): void {
    this.stopTimer();
    this.sim = null;
    this.initOpts = null;
    this.snapshot = null;
    this.playingState = false;
    this.gen2Joined = false;
    this.notify();
  }

  playing(): boolean {
    return this.playingState;
  }

  speed(): number {
    return this.speedState;
  }

  opts(): RuntimeInitOpts | null {
    return this.initOpts;
  }

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  /** Fires after every stepped day with that day's metrics + events. */
  onStep(cb: StepListener): () => void {
    this.stepListeners.add(cb);
    return () => this.stepListeners.delete(cb);
  }

  getSnapshot = (): LiveSimSnapshot | null => this.snapshot;

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => this.stepOnce(), BASE_MS_PER_DAY / this.speedState);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}

// survives HMR module reloads like the server-side stores
const g = globalThis as typeof globalThis & { __adceroRuntime?: LiveSimRuntime };
export const liveSimRuntime: LiveSimRuntime = (g.__adceroRuntime ??= new LiveSimRuntime());
