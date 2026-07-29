'use client';

import { useEffect, useRef, useState } from 'react';
import type { AutopilotEvent, Fact } from '@/lib/contracts';
import { ConfidenceBar } from '@/components/ui/confidence-bar';
import { useAutopilot } from '@/components/autopilot/provider';
import { AGENT_STYLES } from './agent-styles';
import { BandRoom } from './band-room';

type EventPayload = {
  agent?: string;
  message?: string;
  factId?: string;
  [key: string]: unknown;
};

function messageText(event: AutopilotEvent, payload: EventPayload): string {
  if (payload.message) return payload.message;
  const rest = Object.entries(payload)
    .filter(([k]) => !['agent', 'message', 'factId'].includes(k))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join(' · ');
  return `${event.step} ${event.status}${rest ? ` · ${rest}` : ''}`;
}

const TABS = [
  { key: 'feed', label: 'Agent feed' },
  { key: 'room', label: 'Band room' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function ResearchFeed({ facts, brandId }: { facts: Fact[]; brandId?: string | null }) {
  const { status, events, start } = useAutopilot();
  const [tab, setTab] = useState<Tab>('feed');
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [events.length]);

  const factById = new Map(facts.map((f) => [f.id, f]));
  const landedFacts = events
    .map((e) => (e.payload as EventPayload | undefined)?.factId)
    .filter((id): id is string => Boolean(id))
    .map((id) => factById.get(id))
    .filter((f): f is Fact => Boolean(f));

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col">
      <div className="flex items-center gap-1 border-b border-line bg-panel px-6 py-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-sm px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
              tab === t.key ? 'bg-panel2 text-accent' : 'text-mut hover:text-fg'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'room' ? (
        <BandRoom />
      ) : status === 'idle' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="font-mono text-sm text-dim">swarm idle — no run in progress</p>
          <button
            onClick={() => start(brandId ? { brandId, mode: 'research' } : undefined)}
            className="rounded-sm bg-accent px-5 py-2.5 font-mono text-xs font-bold uppercase tracking-[0.2em] text-ink transition-colors hover:bg-accent/85"
          >
            Unleash the swarm →
          </button>
          <button
            onClick={() => setTab('room')}
            className="font-mono text-[11px] text-mut underline-offset-4 transition-colors hover:text-accent hover:underline"
          >
            or browse past Band sessions →
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* agent feed */}
          <div ref={feedRef} className="min-w-0 flex-1 overflow-y-auto p-6">
            <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-mut">
              Agent feed · {events.length} events
            </p>
            <div className="space-y-3">
              {events.map((event, i) => {
                const payload = (event.payload ?? {}) as EventPayload;
                const agent = payload.agent ?? 'Autopilot';
                const style = AGENT_STYLES[agent] ?? AGENT_STYLES.Autopilot;
                return (
                  <div key={i} className="anim-slide-in-left flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm ${style.bg} font-mono text-[11px] font-bold text-ink`}
                    >
                      {agent.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-baseline gap-2">
                        <span className={`text-sm font-semibold ${style.fg}`}>{agent}</span>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-dim">
                          {event.step}
                          {event.status === 'done' ? ' ✓' : ''}
                        </span>
                      </p>
                      <p className="text-sm leading-relaxed text-fg/90">
                        {messageText(event, payload)}
                      </p>
                    </div>
                  </div>
                );
              })}
              {status === 'running' && (
                <p className="anim-pulse pl-10 font-mono text-xs text-accent">▍</p>
              )}
            </div>
          </div>

          {/* facts panel */}
          <aside className="w-96 shrink-0 overflow-y-auto border-l border-line bg-panel p-5">
            <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-mut">
              Facts extracted · {landedFacts.length}
            </p>
            <div className="space-y-3">
              {landedFacts.map((fact) => (
                <div
                  key={fact.id}
                  className="anim-slide-in-right rounded-sm border border-line bg-panel2 p-3"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
                      {fact.section}
                    </span>
                    <span className="font-mono text-[10px] text-dim">{fact.id}</span>
                  </div>
                  <p className="mb-2 text-xs leading-relaxed text-fg/90">{fact.statement}</p>
                  {fact.sourceQuote && (
                    <p className="mb-2 border-l-2 border-line pl-2 text-[11px] italic leading-snug text-mut">
                      “{fact.sourceQuote}”
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <ConfidenceBar value={fact.confidence} />
                    {fact.sourceUrl && (
                      <span className="truncate font-mono text-[10px] text-dim">
                        {fact.sourceUrl.replace('https://', '')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {landedFacts.length === 0 && (
                <p className="font-mono text-xs text-dim">waiting for the swarm…</p>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
