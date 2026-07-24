'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Creative, DailyMetrics } from '@/lib/contracts';
import { fmtInt } from '@/lib/format';
import { adColor, CHART_CHROME } from '@/lib/palette';

// Stacked-area "allocation river": impressions per ad per day. Uniform
// allocation renders as equal bands — the Thompson phase makes it bend.
export function AllocationRiver({
  visible,
  creatives,
  maxDay,
  maxDaily,
}: {
  visible: DailyMetrics[];
  creatives: Creative[];
  maxDay: number;
  maxDaily: number;
}) {
  const byDay = new Map<number, Record<string, number>>();
  for (const m of visible) {
    const row = byDay.get(m.day) ?? {};
    row[m.adId] = m.impressions;
    byDay.set(m.day, row);
  }
  const data = [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, row]) => ({ day, ...row }));

  return (
    <div className="rounded-sm border border-line bg-panel p-4">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.25em] text-mut">
        Allocation river · impressions / ad / day
      </p>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />
            <XAxis
              dataKey="day"
              type="number"
              domain={[1, maxDay]}
              tickCount={maxDay}
              tick={{ fill: CHART_CHROME.label, fontSize: 10, fontFamily: 'monospace' }}
              axisLine={{ stroke: CHART_CHROME.axisLine }}
              tickLine={false}
            />
            <YAxis
              domain={[0, maxDaily]}
              tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
              tick={{ fill: CHART_CHROME.label, fontSize: 10, fontFamily: 'monospace' }}
              axisLine={false}
              tickLine={false}
              width={34}
            />
            <Tooltip
              isAnimationActive={false}
              labelFormatter={(day) => `Day ${day}`}
              formatter={(value, name) => [fmtInt(Number(value ?? 0)), String(name)]}
              contentStyle={{
                background: CHART_CHROME.tooltipBg,
                border: `1px solid ${CHART_CHROME.tooltipBorder}`,
                borderRadius: 2,
                fontFamily: 'monospace',
                fontSize: 11,
              }}
              itemStyle={{ padding: 0 }}
            />
            {creatives.map((c, i) => (
              <Area
                key={c.publishedAdId}
                dataKey={c.publishedAdId}
                name={c.id}
                stackId="alloc"
                type="monotone"
                stroke="#0b0d0c"
                strokeWidth={1}
                fill={adColor(i)}
                fillOpacity={0.9}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {/* legend: identity is never color-alone */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {creatives.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1.5 font-mono text-[10px] text-mut">
            <span className="h-2 w-2 rounded-[1px]" style={{ background: adColor(i) }} />
            {c.id} · {c.genome.angle}
          </span>
        ))}
      </div>
    </div>
  );
}
