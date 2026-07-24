'use client';

import { useMemo } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Creative } from '@/lib/contracts';
import { fmtPct } from '@/lib/format';
import { betaPdfPoints } from '@/lib/loop';
import { adColor, CHART_CHROME } from '@/lib/palette';

// Beta posterior curves for the top 4 live arms by posterior mean, refreshed
// each simulated day. Sharper, right-shifted curves = the bandit's conviction.
export function PosteriorPanel({ creatives }: { creatives: Creative[] }) {
  const { series, xMax } = useMemo(() => {
    const top = creatives
      .map((c, index) => ({ creative: c, index }))
      .filter(({ creative }) => creative.status === 'live')
      .sort(
        (a, b) =>
          b.creative.arm.alpha / (b.creative.arm.alpha + b.creative.arm.beta) -
          a.creative.arm.alpha / (a.creative.arm.alpha + a.creative.arm.beta),
      )
      .slice(0, 4);
    if (top.length === 0) return { series: [], xMax: 0.1 };
    const means = top.map(
      ({ creative }) => creative.arm.alpha / (creative.arm.alpha + creative.arm.beta),
    );
    const bound = Math.min(1, Math.max(0.02, Math.max(...means) * 2.5));
    // n=800 gives enough resolution to render concentrated posteriors inside
    // the zoomed x-window (betaPdfPoints spans the full (0,1) domain)
    const curves = top.map(({ creative, index }) => ({
      creative,
      index,
      points: betaPdfPoints(creative.arm.alpha, creative.arm.beta, 800).filter(
        (p) => p.x <= bound,
      ),
    }));
    return { series: curves, xMax: bound };
  }, [creatives]);

  if (series.length === 0) return null;

  return (
    <div className="rounded-sm border border-line bg-panel p-4">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.25em] text-mut">
        CTR posteriors · top 4 arms · Beta(α, β)
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {series.map(({ creative, index, points }) => (
          <div key={creative.id} className="rounded-sm border border-line bg-panel2 p-2.5">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-[1px]"
                  style={{ background: adColor(index) }}
                />
                <span className="truncate font-mono text-[10px] text-mut">{creative.id}</span>
              </span>
              <span className="font-mono text-xs font-bold text-fg">
                {fmtPct(creative.arm.alpha / (creative.arm.alpha + creative.arm.beta))}
              </span>
            </div>
            <p className="mb-1 truncate font-mono text-[9px] uppercase tracking-wider text-dim">
              α {Math.round(creative.arm.alpha)} · β {Math.round(creative.arm.beta)}
            </p>
            <div className="h-14">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                  <XAxis dataKey="x" type="number" domain={[0, xMax]} hide />
                  <YAxis domain={[0, 1]} hide />
                  <Tooltip
                    isAnimationActive={false}
                    labelFormatter={(x) => `CTR ${fmtPct(Number(x))}`}
                    formatter={(value) => [Number(value ?? 0).toFixed(2), 'density']}
                    contentStyle={{
                      background: CHART_CHROME.tooltipBg,
                      border: `1px solid ${CHART_CHROME.tooltipBorder}`,
                      borderRadius: 2,
                      fontFamily: 'monospace',
                      fontSize: 11,
                    }}
                    itemStyle={{ padding: 0 }}
                  />
                  <Line
                    dataKey="y"
                    stroke={adColor(index)}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
