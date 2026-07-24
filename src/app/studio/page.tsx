import { dataSource } from '@/lib/datasource';
import type { Creative, PanelScore } from '@/lib/contracts';

function GenomeChip({ label, accent = false }: { label: string; accent?: boolean }) {
  return (
    <span
      className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] ${
        accent ? 'border-accent/70 text-accent' : 'border-line text-mut'
      }`}
    >
      {label}
    </span>
  );
}

function CreativeCard({ creative, scores }: { creative: Creative; scores: PanelScore[] }) {
  const retired = creative.status === 'retired';
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-sm border border-line bg-panel">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={creative.imageUrl}
          alt={`${creative.genome.angle} × ${creative.genome.style}`}
          className="aspect-[4/5] w-full object-cover"
        />
        {/* persona panel scores on hover */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end gap-2 bg-ink/95 p-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-mut">
            Persona panel
          </p>
          {scores.map((s) => (
            <div key={s.persona}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs text-fg/90">{s.persona}</span>
                <span className="font-mono text-sm font-bold text-accent">{s.appealScore}</span>
              </div>
              <div className="mb-0.5 h-[3px] overflow-hidden rounded-full bg-line">
                <div className="h-full bg-accent" style={{ width: `${s.appealScore}%` }} />
              </div>
              <p className="text-[10px] leading-snug text-mut">{s.reason}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-dim">{creative.id}</span>
          <span className="flex items-center gap-2">
            <span
              className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                retired ? 'border-danger text-danger' : 'border-line text-mut'
              }`}
            >
              {retired ? 'retired' : `gen ${creative.genome.generation}`}
            </span>
            <span className={`h-1.5 w-1.5 rounded-full ${retired ? 'bg-danger' : 'bg-accent'}`} />
          </span>
        </div>
        <p className="line-clamp-3 text-xs leading-relaxed text-fg/90">{creative.copy}</p>
        <div className="mt-auto flex flex-wrap gap-1 pt-1">
          <GenomeChip label={creative.genome.angle} accent />
          <GenomeChip label={creative.genome.style} />
          <GenomeChip label={creative.genome.persona} />
        </div>
      </div>
    </div>
  );
}

export default async function StudioPage() {
  const [creatives, panelScores] = await Promise.all([
    dataSource.getCreatives(),
    dataSource.getPanelScores(),
  ]);
  return (
    <div className="p-6">
      <div className="mb-5 flex items-baseline gap-3">
        <h2 className="text-xl font-semibold text-fg">Creative studio</h2>
        <span className="font-mono text-xs text-dim">
          {creatives.length} live · generation 1 · hover for panel scores
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {creatives.map((c) => (
          <CreativeCard
            key={c.id}
            creative={c}
            scores={panelScores.filter((s) => s.creativeId === c.id)}
          />
        ))}
      </div>
    </div>
  );
}
