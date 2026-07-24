'use client';

import { useRouter } from 'next/navigation';
import type { Brand } from '@/lib/contracts';
import { shortHash } from '@/lib/format';
import { useAutopilot } from '@/components/autopilot/provider';

export function Topbar({ brand }: { brand: Brand }) {
  const { status, events, start } = useAutopilot();
  const router = useRouter();

  // Context evolves v1 → v2 once the writeback step lands.
  const writeback = events.find((e) => e.step === 'writeback' && e.status === 'done');
  const wb = writeback?.payload as { version?: number; hash?: string } | undefined;
  const version = wb?.version ?? brand.contextVersion;
  const hash = wb?.hash ?? brand.contextHash;

  return (
    <header className="flex items-center gap-4 border-b border-line bg-panel px-6 py-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-base font-semibold text-fg">{brand.name}</h1>
        <span className="font-mono text-xs text-dim">{brand.url.replace('https://', '')}</span>
      </div>
      <span
        className={`rounded-sm border px-2 py-0.5 font-mono text-xs transition-colors ${
          version > 1 ? 'border-accent text-accent' : 'border-line text-mut'
        }`}
        title={`context v${version} · ${hash}`}
      >
        v{version} · {shortHash(hash)}
      </span>
      <div className="ml-auto flex items-center gap-3">
        {status === 'running' && (
          <span className="anim-pulse font-mono text-xs uppercase tracking-wider text-accent">
            ● live
          </span>
        )}
        <button
          onClick={() => {
            start();
            router.push('/research');
          }}
          disabled={status === 'running'}
          className={`rounded-sm border px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider transition-colors ${
            status === 'running'
              ? 'cursor-default border-line text-dim'
              : 'border-accent bg-accent text-ink hover:bg-accent/85'
          }`}
        >
          {status === 'idle' ? 'Autopilot' : status === 'running' ? 'Running…' : 'Run complete'}
        </button>
      </div>
    </header>
  );
}
