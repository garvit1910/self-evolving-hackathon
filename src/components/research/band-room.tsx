'use client';

// The Band room, inside the app: session picker (newest = live run, older =
// cached demos) + the full room transcript polled from /api/band/sessions.
// Messages render like a chat: agent-colored text messages, italicized
// thought events, and (optionally) tool telemetry lines.

import { useCallback, useEffect, useRef, useState } from 'react';
import { styleFor } from './agent-styles';

type Session = { id: string; title: string; insertedAt: string };
type Message = {
  id: string;
  sender: string;
  senderType: string;
  kind: string;
  content: string;
  ts: string;
};

const POLL_MS = 2500;

function isLive(session: Session | undefined, messages: Message[]): boolean {
  if (!session || messages.length === 0) return false;
  const last = messages[messages.length - 1];
  return Date.now() - new Date(last.ts).getTime() < 90_000;
}

export function BandRoom() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [telemetry, setTelemetry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToLatest = useRef(true);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/band/sessions');
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      const { sessions: list } = (await res.json()) as { sessions: Session[] };
      setSessions(list);
      setError(null);
      // auto-attach to the newest session unless the user picked an older one
      setSelected((cur) => {
        if (cur && list.some((s) => s.id === cur) && !pinnedToLatest.current) return cur;
        return list[0]?.id ?? null;
      });
    } catch {
      setError('app server unreachable');
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    const t = setInterval(loadSessions, 10_000);
    return () => clearInterval(t);
  }, [loadSessions]);

  useEffect(() => {
    if (!selected) return;
    let stale = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/band/sessions/${selected}/messages`);
        if (!res.ok || stale) return;
        const { messages: msgs } = (await res.json()) as { messages: Message[] };
        if (!stale) setMessages(msgs);
      } catch {
        // next poll retries
      }
    };
    setMessages([]);
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      stale = true;
      clearInterval(t);
    };
  }, [selected]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const session = sessions.find((s) => s.id === selected);
  const visible = telemetry ? messages : messages.filter((m) => m.kind === 'text' || m.kind === 'thought');
  const live = isLive(session, messages);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-panel px-6 py-2.5">
        <select
          value={selected ?? ''}
          onChange={(e) => {
            pinnedToLatest.current = e.target.value === sessions[0]?.id;
            setSelected(e.target.value);
          }}
          className="max-w-96 rounded-sm border border-line bg-panel2 px-2 py-1.5 font-mono text-[11px] text-fg"
        >
          {sessions.map((s, i) => (
            <option key={s.id} value={s.id}>
              {s.title}
              {i === 0 ? ' (latest)' : ''}
            </option>
          ))}
        </select>
        {live && (
          <span className="anim-pulse rounded-sm border border-accent/50 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
            ● live
          </span>
        )}
        <label className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-mut">
          <input type="checkbox" checked={telemetry} onChange={(e) => setTelemetry(e.target.checked)} />
          tool telemetry
        </label>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-6">
        {error && <p className="font-mono text-xs text-danger">band room unavailable — {error}</p>}
        {!error && visible.length === 0 && (
          <p className="font-mono text-xs text-dim">
            {session ? 'waiting for the conversation…' : 'no swarm sessions yet — unleash the swarm to start one'}
          </p>
        )}
        <div className="space-y-3">
          {visible.map((m) => {
            const style = styleFor(m.sender, m.senderType);
            if (m.kind === 'tool_call' || m.kind === 'tool_result') {
              return (
                <p key={m.id} className="pl-10 font-mono text-[10px] leading-snug text-dim">
                  ⚙ {m.sender} · {m.kind} · {m.content.slice(0, 100)}
                </p>
              );
            }
            if (m.kind === 'thought') {
              return (
                <div key={m.id} className="anim-fade-up flex items-start gap-3 pl-10">
                  <p className="min-w-0 text-[12px] italic leading-relaxed text-mut">
                    <span className={`not-italic font-semibold ${style.fg}`}>{m.sender}</span>{' '}
                    <span className="font-mono text-[9px] uppercase tracking-wider text-dim">thinks</span>{' '}
                    {m.content}
                  </p>
                </div>
              );
            }
            return (
              <div key={m.id} className="anim-slide-in-left flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm ${style.bg} font-mono text-[11px] font-bold text-ink`}
                >
                  {m.sender.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="flex items-baseline gap-2">
                    <span className={`text-sm font-semibold ${style.fg}`}>{m.sender}</span>
                    <span className="font-mono text-[10px] text-dim">
                      {m.ts ? new Date(m.ts).toLocaleTimeString() : ''}
                    </span>
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg/90">{m.content}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
