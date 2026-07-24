'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Creative, PanelScore } from '@/lib/contracts';
import { fmtInt, fmtMoney, fmtPct, fmtRoas } from '@/lib/format';
import { liveSimRuntime } from '@/lib/autopilot/runtime';
import { DEMO_LEARNING_OPTS, DEMO_RETIREMENT_OPTS } from '@/lib/livesim';
import { marketConfigFor } from '@/lib/market-config';
import { CountUp } from '@/components/ui/count-up';
import { AllocationRiver } from './allocation-river';
import { CtrSparklines } from './ctr-sparklines';
import { PosteriorPanel } from './posterior-panel';

const SPEEDS = [1, 2, 4] as const;

function Tile({ label, value, format, accent = false }: {
  label: string;
  value: number;
  format: (n: number) => string;
  accent?: boolean;
}) {
  return (
    <div className="flex-1 rounded-sm border border-line bg-panel px-4 py-3">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.25em] text-mut">{label}</p>
      <p className={`font-mono text-3xl font-bold tabular-nums ${accent ? 'text-accent' : 'text-fg'}`}>
        <CountUp value={value} format={format} />
      </p>
    </div>
  );
}

// Live market mode: the real loop running day by day — Thompson allocation,
// learnings, retirement, gen-2 joining mid-flight, generation verdict.
export function LiveMarketView({
  brandId,
  creatives,
  panelScores,
  brandActive,
}: {
  brandId: string;
  creatives: Creative[];
  panelScores: PanelScore[];
  /** True when a created (non-fixture) brand is active — persists metrics. */
  brandActive: boolean;
}) {
  const snapshot = useSyncExternalStore(
    liveSimRuntime.subscribe,
    liveSimRuntime.getSnapshot,
    () => null,
  );
  const [seed, setSeed] = useState(42);
  const [allocator, setAllocator] = useState<'uniform' | 'thompson'>('thompson');
  const playing = liveSimRuntime.playing();
  const speed = liveSimRuntime.speed();

  // live-brand flights persist day batches so the market survives reloads
  useEffect(() => {
    if (!brandActive) return;
    return liveSimRuntime.onStep(({ dayMetrics }) => {
      void fetch(`/api/brands/${brandId}/metrics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(dayMetrics),
      }).catch(() => {});
    });
  }, [brandActive, brandId]);

  const gen1 = useMemo(() => creatives.filter((c) => c.genome.generation === 1), [creatives]);

  const start = () => {
    liveSimRuntime.init({
      config: marketConfigFor(brandId, gen1),
      creatives: gen1,
      panelScores,
      seed,
      allocator,
      learningOpts: DEMO_LEARNING_OPTS,
      retirementOpts: DEMO_RETIREMENT_OPTS,
      autoGen2: !brandActive,
    });
    liveSimRuntime.play();
  };

  if (!snapshot) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-sm border border-dashed border-line bg-panel/40 p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-dim">
          Live market · thompson vs uniform · learnings fire in real time
        </p>
        <div className="flex items-center gap-3">
          <label className="font-mono text-[11px] uppercase text-mut">
            seed
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 42)}
              className="ml-2 w-20 rounded-sm border border-line bg-panel px-2 py-1 font-mono text-xs text-fg outline-none focus:border-accent"
            />
          </label>
          <button
            onClick={() => setAllocator(allocator === 'thompson' ? 'uniform' : 'thompson')}
            className="rounded-sm border border-line px-2.5 py-1 font-mono text-[11px] uppercase text-mut transition-colors hover:border-mut hover:text-fg"
          >
            {allocator}
          </button>
          <button
            onClick={start}
            className="rounded-sm border border-accent bg-accent px-4 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-ink transition-colors hover:bg-accent/85"
          >
            Start flight
          </button>
        </div>
      </div>
    );
  }

  const totals = snapshot.metrics.reduce(
    (acc, m) => {
      acc.impressions += m.impressions;
      acc.clicks += m.clicks;
      acc.spend += m.spend;
      acc.revenue += m.purchaseValue;
      return acc;
    },
    { impressions: 0, clicks: 0, spend: 0, revenue: 0 },
  );
  const maxDay = Math.max(30, snapshot.day);
  const runtimeOpts = liveSimRuntime.opts();
  const maxDaily = runtimeOpts?.config.dailyImpressions ?? 10_000;
  const maxDailyCtr =
    Math.max(
      0.01,
      ...snapshot.metrics.map((m) => (m.impressions > 0 ? m.clicks / m.impressions : 0)),
    ) * 1.1;
  const latestLearning = snapshot.learnings[snapshot.learnings.length - 1];

  return (
    <div className="space-y-5">
      {/* controls + tiles */}
      <div className="flex flex-wrap items-stretch gap-4">
        <div className="flex flex-col justify-between rounded-sm border border-accent/40 bg-panel px-4 py-3">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
            Live flight · {runtimeOpts?.allocator ?? allocator}
          </p>
          <p className="font-mono text-3xl font-bold tabular-nums text-fg">
            DAY {String(snapshot.day).padStart(2, '0')}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => (playing ? liveSimRuntime.pause() : liveSimRuntime.play())}
              className="rounded-sm border border-accent px-2.5 py-1 font-mono text-[11px] font-bold uppercase text-accent transition-colors hover:bg-accent hover:text-ink"
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button
              onClick={() => liveSimRuntime.stepOnce()}
              className="rounded-sm border border-line px-2.5 py-1 font-mono text-[11px] uppercase text-mut transition-colors hover:border-mut hover:text-fg"
            >
              Step
            </button>
            <button
              onClick={() =>
                liveSimRuntime.setSpeed(SPEEDS[(SPEEDS.indexOf(speed as 1 | 2 | 4) + 1) % SPEEDS.length])
              }
              className="rounded-sm border border-line px-2.5 py-1 font-mono text-[11px] uppercase text-mut transition-colors hover:border-mut hover:text-fg"
            >
              ×{speed}
            </button>
            <button
              onClick={() => liveSimRuntime.reset({ seed, allocator })}
              className="rounded-sm border border-line px-2.5 py-1 font-mono text-[11px] uppercase text-mut transition-colors hover:border-mut hover:text-fg"
            >
              Reset
            </button>
          </div>
        </div>
        <Tile label="Cum spend" value={totals.spend} format={fmtMoney} />
        <Tile label="Revenue" value={totals.revenue} format={fmtMoney} />
        <Tile
          label="Blended ROAS"
          value={totals.spend > 0 ? totals.revenue / totals.spend : 0}
          format={fmtRoas}
          accent
        />
        <Tile
          label="Blended CTR"
          value={totals.impressions > 0 ? totals.clicks / totals.impressions : 0}
          format={(n) => fmtPct(n)}
        />
        <Tile label="Impressions" value={totals.impressions} format={fmtInt} />
      </div>

      {/* loop status strip */}
      <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
        <span className="rounded-sm border border-line px-2 py-1 text-mut">
          learnings {snapshot.learnings.length}
        </span>
        <span className="rounded-sm border border-line px-2 py-1 text-mut">
          retired {snapshot.retiredAdIds.length}
        </span>
        {snapshot.regenerationTriggered && (
          <span className="rounded-sm border border-accent/60 px-2 py-1 text-accent">
            regeneration triggered · gen-2 live
          </span>
        )}
        {snapshot.verdictFired && snapshot.comparison && (
          <span className="rounded-sm bg-accent px-2 py-1 font-bold uppercase tracking-wider text-ink">
            {snapshot.comparison.verdict === 'gen2_wins' ? 'Gen 2 wins' : 'Gen 1 holds'} ·{' '}
            {fmtPct(snapshot.comparison.gen2Ctr)} vs {fmtPct(snapshot.comparison.gen1Ctr)}
          </span>
        )}
        {latestLearning && (
          <span className="min-w-0 flex-1 truncate text-dim">↳ {latestLearning.statement}</span>
        )}
      </div>

      <AllocationRiver
        visible={snapshot.metrics}
        creatives={snapshot.creatives}
        maxDay={maxDay}
        maxDaily={maxDaily}
        retiredAdIds={snapshot.retiredAdIds}
      />

      <PosteriorPanel creatives={snapshot.creatives} />

      <CtrSparklines
        visible={snapshot.metrics}
        creatives={snapshot.creatives}
        maxDay={maxDay}
        maxDailyCtr={maxDailyCtr}
      />
    </div>
  );
}
