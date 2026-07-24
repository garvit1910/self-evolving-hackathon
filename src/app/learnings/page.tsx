import { getDataSource } from '@/lib/datasource.server';
import { fmtInt, fmtLift, fmtPct } from '@/lib/format';

export default async function LearningsPage() {
  const dataSource = await getDataSource();
  const [learnings, events] = await Promise.all([
    dataSource.getLearnings(),
    dataSource.getAutopilotEvents(),
  ]);
  // generation verdict — fired by the loop once both gens have enough sample
  const verdictEvent = events.find((e) => e.step === 'verdict' && e.status === 'done');
  const verdict = verdictEvent?.payload as
    | { verdict?: string; gen1Ctr?: number; gen2Ctr?: number }
    | undefined;
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-baseline gap-3">
        <h2 className="text-xl font-semibold text-fg">Learnings</h2>
        <span className="font-mono text-xs text-dim">
          extracted from the simulated flight · fed back into context
        </span>
        {verdict?.verdict === 'gen2_wins' && (
          <span className="ml-auto rounded-sm bg-accent px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-ink">
            Gen 2 wins
            {typeof verdict.gen2Ctr === 'number' && typeof verdict.gen1Ctr === 'number'
              ? ` · ${fmtPct(verdict.gen2Ctr)} vs ${fmtPct(verdict.gen1Ctr)}`
              : ''}
          </span>
        )}
      </div>

      <div className="relative space-y-6 border-l border-line pl-6">
        {learnings.map((learning) => {
          // Display-only significance: CI entirely above zero.
          const significant = learning.stats.ciLow > 0;
          return (
            <div key={learning.id} className="relative">
              <span
                className={`absolute -left-[1.85rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-ink ${
                  significant ? 'bg-accent' : 'bg-line'
                }`}
              />
              <div
                className={`rounded-sm border p-4 ${
                  significant ? 'border-accent/60 bg-accent-dim/15' : 'border-line bg-panel'
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] text-dim">{learning.id}</span>
                  <span className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase text-mut">
                    {learning.stats.dimension} · {learning.stats.value}
                  </span>
                  {significant && (
                    <span className="rounded-sm bg-accent px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ink">
                      Wilson-significant
                    </span>
                  )}
                </div>
                <p className="mb-3 text-sm leading-relaxed text-fg/95">{learning.statement}</p>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs">
                  <span className={learning.stats.lift >= 0 ? 'text-accent' : 'text-danger'}>
                    LIFT {fmtLift(learning.stats.lift)}
                  </span>
                  <span className="text-mut">N {fmtInt(learning.stats.n)}</span>
                  <span className="text-mut">
                    CI [{fmtLift(learning.stats.ciLow)}, {fmtLift(learning.stats.ciHigh)}]
                  </span>
                  <span className={`ml-auto ${learning.sensoIngested ? 'text-accent' : 'text-dim'}`}>
                    {learning.sensoIngested ? '→ written back to context' : 'pending write-back'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
