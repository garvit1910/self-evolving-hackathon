'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAutopilot } from '@/components/autopilot/provider';

export default function OnboardingPage() {
  const [url, setUrl] = useState('https://magicspoon.com');
  const [dropped, setDropped] = useState(false);
  const { start } = useAutopilot();
  const router = useRouter();

  const unleash = () => {
    start();
    router.push('/research');
  };

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-accent">
          Self-evolving ad engine
        </p>
        <h2 className="mb-2 text-4xl font-semibold leading-tight text-fg">
          Brand in. Evolving ads out.
        </h2>
        <p className="mb-10 text-sm leading-relaxed text-mut">
          Point the swarm at a brand. It researches, generates, runs a simulated market,
          learns, and rewrites its own context — then generates better ads.
        </p>

        <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-mut">
          Brand URL
        </label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          className="mb-6 w-full rounded-sm border border-line bg-panel px-4 py-3 font-mono text-sm text-fg outline-none transition-colors focus:border-accent"
        />

        <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-mut">
          Product image
        </label>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setDropped(true);
          }}
          onClick={() => setDropped(true)}
          className={`mb-10 flex cursor-pointer items-center justify-center rounded-sm border border-dashed transition-colors ${
            dropped ? 'border-accent bg-panel' : 'border-line bg-panel hover:border-mut'
          }`}
        >
          {dropped ? (
            <div className="flex w-full items-center gap-4 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/creatives/product-magic-spoon.svg"
                alt="Magic Spoon product"
                className="h-24 w-24 rounded-sm border border-line"
              />
              <div>
                <p className="font-mono text-sm text-fg">product-magic-spoon.svg</p>
                <p className="font-mono text-xs text-accent">✓ attached to brief</p>
              </div>
            </div>
          ) : (
            <p className="p-10 font-mono text-xs text-dim">
              drop product image here — or click to use the fixture
            </p>
          )}
        </div>

        <button
          onClick={unleash}
          className="w-full rounded-sm bg-accent px-6 py-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-ink transition-colors hover:bg-accent/85"
        >
          Unleash the swarm →
        </button>
      </div>
    </div>
  );
}
