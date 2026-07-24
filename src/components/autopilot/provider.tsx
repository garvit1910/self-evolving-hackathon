'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { AutopilotEvent } from '@/lib/contracts';
import { dataSource } from '@/lib/datasource';
import { mulberry32 } from '@/lib/sim';

export type AutopilotStatus = 'idle' | 'running' | 'done';

type AutopilotContextValue = {
  status: AutopilotStatus;
  /** Events fired so far, in order. */
  events: AutopilotEvent[];
  start: () => void;
};

const AutopilotContext = createContext<AutopilotContextValue>({
  status: 'idle',
  events: [],
  start: () => {},
});

export const useAutopilot = () => useContext(AutopilotContext);

// Replays the fixture event stream with 300–1200ms delays. Delays come from a
// seeded RNG so the demo pacing is identical on every run.
export function AutopilotProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AutopilotStatus>('idle');
  const [events, setEvents] = useState<AutopilotEvent[]>([]);
  const startedRef = useRef(false);

  const start = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStatus('running');
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
  }, []);

  return (
    <AutopilotContext.Provider value={{ status, events, start }}>
      {children}
    </AutopilotContext.Provider>
  );
}
