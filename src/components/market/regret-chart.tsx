'use client';

import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Creative, PanelScore } from '@/lib/contracts';
import { fmtInt } from '@/lib/format';
import { runComparison } from '@/lib/loop';
import { marketConfigFor } from '@/lib/market-config';
import { CHART_CHROME } from '@/lib/palette';

// Fills the reserved "Regret vs uniform" slot: the same market run three ways
// on one seed — uniform, Thompson, and the true-CTR oracle — cumulative clicks
// plus the regret gap (oracle − Thompson) as a shaded band.
export function RegretChart({
  brandId,
  creatives,
  panelScores,
  seed = 42,
  days = 20,
}: {
  brandId: string;
  creatives: Creative[];
  panelScores: PanelScore[];
  seed?: number;
  days?: number;
}) {
  const data = useMemo(() => {
    const live = creatives.filter((c) => c.genome.generation === 1);
    if (live.length === 0) return [];
    const { byDay } = runComparison(
      marketConfigFor(brandId, live),
      live,
      panelScores,
      days,
      seed,
    );
    return byDay.map((d) => ({
      day: d.day,
      uniform: d.uniformCumClicks,
      thompson: d.thompsonCumClicks,
      oracle: Math.round(d.oracleCumClicks),
      // band between thompson and oracle — rendered as a stacked offset area
      regretBase: d.thompsonCumClicks,
      regretGap: Math.max(0, Math.round(d.oracleCumClicks) - d.thompsonCumClicks),
    }));
  }, [brandId, creatives, panelScores, seed, days]);

  if (data.length === 0) return null;

  return (
    <div className="rounded-sm border border-line bg-panel p-4">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.25em] text-mut">
        Thompson vs uniform · cumulative clicks, seed {seed} · shaded = regret to oracle
      </p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />
            <XAxis
              dataKey="day"
              type="number"
              domain={[1, days]}
              tickCount={Math.min(days, 20)}
              tick={{ fill: CHART_CHROME.label, fontSize: 10, fontFamily: 'monospace' }}
              axisLine={{ stroke: CHART_CHROME.axisLine }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
              tick={{ fill: CHART_CHROME.label, fontSize: 10, fontFamily: 'monospace' }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip
              isAnimationActive={false}
              labelFormatter={(day) => `Day ${day}`}
              formatter={(value, name) =>
                name === 'regretBase'
                  ? []
                  : [fmtInt(Number(value ?? 0)), name === 'regretGap' ? 'regret' : String(name)]
              }
              contentStyle={{
                background: CHART_CHROME.tooltipBg,
                border: `1px solid ${CHART_CHROME.tooltipBorder}`,
                borderRadius: 2,
                fontFamily: 'monospace',
                fontSize: 11,
              }}
              itemStyle={{ padding: 0 }}
            />
            <Legend
              formatter={(value) =>
                value === 'regretGap' ? 'regret' : value === 'regretBase' ? '' : value
              }
              wrapperStyle={{ fontFamily: 'monospace', fontSize: 10 }}
            />
            <Area
              dataKey="regretBase"
              stackId="regret"
              stroke="none"
              fill="transparent"
              isAnimationActive={false}
              legendType="none"
            />
            <Area
              dataKey="regretGap"
              stackId="regret"
              stroke="none"
              fill="#e66767"
              fillOpacity={0.12}
              isAnimationActive={false}
            />
            <Line dataKey="uniform" stroke="#3987e5" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="thompson" stroke="#f5a623" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line
              dataKey="oracle"
              stroke={CHART_CHROME.label}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
