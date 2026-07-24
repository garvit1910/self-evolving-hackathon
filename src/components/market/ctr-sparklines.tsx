'use client';

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Creative, DailyMetrics } from '@/lib/contracts';
import { fmtPct } from '@/lib/format';
import { adColor, CHART_CHROME } from '@/lib/palette';

// Small-multiple daily-CTR sparklines, one per ad, on a shared y-scale.
export function CtrSparklines({
  visible,
  creatives,
  maxDay,
  maxDailyCtr,
}: {
  visible: DailyMetrics[];
  creatives: Creative[];
  maxDay: number;
  maxDailyCtr: number;
}) {
  return (
    <div className="rounded-sm border border-line bg-panel p-4">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.25em] text-mut">
        CTR by ad · daily, shared scale
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {creatives.map((creative, i) => {
          const rows = visible
            .filter((m) => m.adId === creative.publishedAdId)
            .sort((a, b) => a.day - b.day);
          const impressions = rows.reduce((s, m) => s + m.impressions, 0);
          const clicks = rows.reduce((s, m) => s + m.clicks, 0);
          const cumCtr = impressions > 0 ? clicks / impressions : 0;
          const series = rows.map((m) => ({
            day: m.day,
            ctr: m.impressions > 0 ? m.clicks / m.impressions : 0,
          }));
          const color = adColor(i);
          return (
            <div key={creative.id} className="rounded-sm border border-line bg-panel2 p-2.5">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-[1px]" style={{ background: color }} />
                  <span className="truncate font-mono text-[10px] text-mut">{creative.id}</span>
                </span>
                <span className="font-mono text-sm font-bold text-fg">{fmtPct(cumCtr)}</span>
              </div>
              <p className="mb-1 truncate font-mono text-[9px] uppercase tracking-wider text-dim">
                {creative.genome.angle}
              </p>
              <div className="h-12">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                    <XAxis dataKey="day" type="number" domain={[1, maxDay]} hide />
                    <YAxis domain={[0, maxDailyCtr]} hide />
                    <Tooltip
                      isAnimationActive={false}
                      labelFormatter={(day) => `Day ${day}`}
                      formatter={(value) => [fmtPct(Number(value ?? 0)), 'CTR']}
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
                      dataKey="ctr"
                      stroke={color}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
