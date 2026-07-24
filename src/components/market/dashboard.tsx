'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Creative, DailyMetrics, PanelScore } from '@/lib/contracts';
import { fmtInt, fmtMoney, fmtPct, fmtRoas } from '@/lib/format';
import { CountUp } from '@/components/ui/count-up';
import { AllocationRiver } from './allocation-river';
import { CtrSparklines } from './ctr-sparklines';
import { LiveMarketView } from './live-view';
import { RegretChart } from './regret-chart';

const SPEEDS = [1, 2, 4] as const;

function StatTile({
  label,
  value,
  format,
  accent = false,
}: {
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

export function MarketDashboard({
  metrics,
  creatives,
  panelScores,
  brandId,
  brandActive,
}: {
  metrics: DailyMetrics[];
  creatives: Creative[];
  panelScores: PanelScore[];
  brandId: string;
  brandActive: boolean;
}) {
  // created brands land straight in Live mode (their store has no replay flight)
  const [mode, setMode] = useState<'replay' | 'live'>(brandActive ? 'live' : 'replay');
  const maxDay = useMemo(() => Math.max(1, ...metrics.map((m) => m.day)), [metrics]);
  const [day, setDay] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setDay((d) => Math.min(maxDay, d + 1)), 900 / speed);
    return () => clearInterval(id);
  }, [playing, speed, maxDay]);

  useEffect(() => {
    if (day >= maxDay) setPlaying(false);
  }, [day, maxDay]);

  const visible = useMemo(() => metrics.filter((m) => m.day <= day), [metrics, day]);

  const totals = useMemo(() => {
    let impressions = 0;
    let clicks = 0;
    let spend = 0;
    let revenue = 0;
    for (const m of visible) {
      impressions += m.impressions;
      clicks += m.clicks;
      spend += m.spend;
      revenue += m.purchaseValue;
    }
    return { impressions, clicks, spend, revenue };
  }, [visible]);

  // Stable chart scales computed from the FULL flight, so axes never jump mid-replay.
  const maxDaily = useMemo(() => {
    const perDay = new Map<number, number>();
    for (const m of metrics) perDay.set(m.day, (perDay.get(m.day) ?? 0) + m.impressions);
    return Math.max(1, ...perDay.values());
  }, [metrics]);
  const maxDailyCtr = useMemo(
    () =>
      Math.max(
        0.01,
        ...metrics.map((m) => (m.impressions > 0 ? m.clicks / m.impressions : 0)),
      ) * 1.1,
    [metrics],
  );

  const modeToggle = (
    <div className="flex items-center gap-1 rounded-sm border border-line p-0.5">
      {(['replay', 'live'] as const).map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          className={`rounded-[1px] px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors ${
            mode === m ? 'bg-accent text-ink' : 'text-mut hover:text-fg'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );

  if (mode === 'live') {
    return (
      <div className="space-y-5 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-fg">Simulated market</h2>
          {modeToggle}
        </div>
        <LiveMarketView
          brandId={brandId}
          creatives={creatives}
          panelScores={panelScores}
          brandActive={brandActive}
        />
        <RegretChart brandId={brandId} creatives={creatives} panelScores={panelScores} />
      </div>
    );
  }

  if (metrics.length === 0) {
    return (
      <p className="p-10 font-mono text-sm text-dim">
        no metrics fixture — run `npm run gen:fixtures`
      </p>
    );
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-fg">Simulated market</h2>
        {modeToggle}
      </div>
      {/* day ticker + controls */}
      <div className="flex flex-wrap items-stretch gap-4">
        <div className="flex flex-col justify-between rounded-sm border border-line bg-panel px-4 py-3">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.25em] text-mut">
            Simulated flight
          </p>
          <p className="font-mono text-3xl font-bold tabular-nums text-fg">
            DAY {String(day).padStart(2, '0')}
            <span className="text-dim">/{maxDay}</span>
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => {
                if (day >= maxDay) setDay(1);
                setPlaying((p) => !p);
              }}
              className="rounded-sm border border-accent px-2.5 py-1 font-mono text-[11px] font-bold uppercase text-accent transition-colors hover:bg-accent hover:text-ink"
            >
              {playing ? 'Pause' : day >= maxDay ? 'Replay' : 'Play'}
            </button>
            <button
              onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
              className="rounded-sm border border-line px-2.5 py-1 font-mono text-[11px] uppercase text-mut transition-colors hover:border-mut hover:text-fg"
            >
              ×{speed}
            </button>
            <input
              type="range"
              min={1}
              max={maxDay}
              value={day}
              onChange={(e) => {
                setPlaying(false);
                setDay(Number(e.target.value));
              }}
              className="w-28 accent-accent"
            />
          </div>
        </div>
        <StatTile label="Cum spend" value={totals.spend} format={fmtMoney} />
        <StatTile label="Revenue" value={totals.revenue} format={fmtMoney} />
        <StatTile
          label="Blended ROAS"
          value={totals.spend > 0 ? totals.revenue / totals.spend : 0}
          format={fmtRoas}
          accent
        />
        <StatTile
          label="Blended CTR"
          value={totals.impressions > 0 ? totals.clicks / totals.impressions : 0}
          format={(n) => fmtPct(n)}
        />
        <StatTile label="Impressions" value={totals.impressions} format={fmtInt} />
      </div>

      <AllocationRiver
        visible={visible}
        creatives={creatives}
        maxDay={maxDay}
        maxDaily={maxDaily}
      />

      <CtrSparklines
        visible={visible}
        creatives={creatives}
        maxDay={maxDay}
        maxDailyCtr={maxDailyCtr}
      />

      <RegretChart brandId={brandId} creatives={creatives} panelScores={panelScores} />
    </div>
  );
}
