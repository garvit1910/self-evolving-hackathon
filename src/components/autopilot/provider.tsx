'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { AutopilotEvent } from '@/lib/contracts';
import { dataSource } from '@/lib/datasource';
import { runAutopilot } from '@/lib/autopilot/orchestrate';
import { mulberry32 } from '@/lib/sim';

export type AutopilotStatus = 'idle' | 'running' | 'done';

type AutopilotContextValue = {
  status: AutopilotStatus;
  /** Events fired so far, in order. */
  events: AutopilotEvent[];
  /**
   * No arg → offline fixture replay. With brandId → live orchestration.
   * mode 'research' → kick ONLY the Band research swarm (fresh session) and
   * stream just this run's events; mode 'full' (default) → whole autopilot.
   */
  start: (opts?: { brandId?: string; mode?: 'full' | 'research' }) => void;
};

const AutopilotContext = createContext<AutopilotContextValue>({
  status: 'idle',
  events: [],
  start: () => {},
});

export const useAutopilot = () => useContext(AutopilotContext);

// Offline: replays the fixture event stream with 300–1200ms seeded delays —
// identical demo pacing on every run. Live: kicks the client orchestrator and
// polls the brand's real event stream, which the stepper + research feed
// consume exactly like the fixture one (same shapes, same route the Track A
// swarm posts to).
export function AutopilotProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AutopilotStatus>('idle');
  const [events, setEvents] = useState<AutopilotEvent[]>([]);
  const startedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback((opts?: { brandId?: string; mode?: 'full' | 'research' }) => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStatus('running');
    setEvents([]);

    const finish = () => {
      setStatus('done');
      startedRef.current = false; // allow another run without a page reload
      if (pollRef.current) clearInterval(pollRef.current);
    };

    const brandId = opts?.brandId;
    if (!brandId) {
      // offline fixture replay — byte-identical to the original demo behavior
      void dataSource.getAutopilotEvents().then((all) => {
        const rand = mulberry32(1337);
        let at = 0;
        all.forEach((event, i) => {
          at += 300 + Math.floor(rand() * 900);
          setTimeout(() => {
            setEvents((prev) => [...prev, event]);
            if (i === all.length - 1) finish();
          }, at);
        });
      });
      return;
    }

    if (opts?.mode === 'research') {
      // research-only: kick the Band swarm (a fresh session) and stream ONLY
      // this run's events — ?since= keeps prior runs' history out of the feed
      const since = Date.now();
      fetch(`/api/brands/${brandId}/research`, { method: 'POST' }).catch(() => {
        // the swarm posts its own failure event; polling surfaces it
      });
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/brands/${brandId}/events?since=${since}`);
          if (!res.ok) return;
          const { events: fresh } = (await res.json()) as { events: AutopilotEvent[] };
          setEvents(fresh);
          if (fresh.some((e) => e.step === 'research' && (e.status === 'done' || e.status === 'failed'))) {
            finish();
          }
        } catch {
          // dev-server hiccup — next poll retries
        }
      }, 1500);
      return;
    }

    // live: the store's event log is the source of truth — replace wholesale
    // each poll so producer identity (orchestrator, researcher, swarm) and
    // same-millisecond timestamps never matter
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/brands/${brandId}/events`);
        if (!res.ok) return;
        const { events: all } = (await res.json()) as { events: AutopilotEvent[] };
        setEvents(all);
        if (all.some((e) => e.step === 'verdict' && e.status === 'done')) {
          finish();
        }
      } catch {
        // dev-server hiccup — next poll retries
      }
    }, 1500);

    void runAutopilot(brandId).catch(() => {
      // orchestrator already emitted a 'failed' event; polling surfaces it
    });
  }, []);

  return (
    <AutopilotContext.Provider value={{ status, events, start }}>
      {children}
    </AutopilotContext.Provider>
  );
}
