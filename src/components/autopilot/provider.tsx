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
  /** No arg → offline fixture replay. With brandId → live orchestration. */
  start: (opts?: { brandId?: string }) => void;
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

  const start = useCallback((opts?: { brandId?: string }) => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStatus('running');

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
            if (i === all.length - 1) setStatus('done');
          }, at);
        });
      });
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
          setStatus('done');
          if (pollRef.current) clearInterval(pollRef.current);
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
