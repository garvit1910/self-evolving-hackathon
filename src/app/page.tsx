'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAutopilot } from '@/components/autopilot/provider';

export default function OnboardingPage() {
  const [url, setUrl] = useState('https://magicspoon.com');
  const [mode, setMode] = useState<'offline' | 'live'>('offline');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fixtureAttached, setFixtureAttached] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { start } = useAutopilot();
  const router = useRouter();

  useEffect(() => {
    void fetch('/api/mode')
      .then((r) => r.json())
      .then((d: { mode: 'offline' | 'live' }) => setMode(d.mode))
      .catch(() => setMode('offline'));
  }, []);

  const attachFile = (f: File) => {
    setFile(f);
    setFixtureAttached(false);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
  };

  const unleash = async () => {
    if (mode === 'live') {
      setBusy(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.append('url', url.trim());
        if (file) fd.append('productImage', file, file.name);
        const res = await fetch('/api/brands', { method: 'POST', body: fd });
        if (!res.ok) throw new Error(`brand creation failed (HTTP ${res.status})`);
        const { brandId } = (await res.json()) as { brandId: string };
        start({ brandId });
        router.push('/research');
        router.refresh(); // pick up the new brand cookie in the layout
        return;
      } catch (err) {
        setError(String(err instanceof Error ? err.message : err));
        setBusy(false);
        return;
      }
    }
    start();
    router.push('/research');
  };

  const attached = file !== null || fixtureAttached;

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.3em] text-accent">
          Self-evolving ad engine
          {mode === 'live' && <span className="ml-3 rounded-sm border border-accent/60 px-1.5 py-0.5 text-[10px]">live mode</span>}
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
          Product image{mode === 'live' ? ' · PNG/JPG — appears in every generated ad' : ''}
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) attachFile(f);
          }}
        />
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) attachFile(f);
            else setFixtureAttached(true);
          }}
          onClick={() => {
            if (mode === 'live') fileInputRef.current?.click();
            else setFixtureAttached(true);
          }}
          className={`mb-10 flex cursor-pointer items-center justify-center rounded-sm border border-dashed transition-colors ${
            attached ? 'border-accent bg-panel' : 'border-line bg-panel hover:border-mut'
          }`}
        >
          {attached ? (
            <div className="flex w-full items-center gap-4 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview ?? '/creatives/product-magic-spoon.svg'}
                alt="Product"
                className="h-24 w-24 rounded-sm border border-line object-cover"
              />
              <div>
                <p className="font-mono text-sm text-fg">
                  {file?.name ?? 'product-magic-spoon.svg'}
                </p>
                <p className="font-mono text-xs text-accent">✓ attached to brief</p>
              </div>
            </div>
          ) : (
            <p className="p-10 font-mono text-xs text-dim">
              {mode === 'live'
                ? 'drop your product photo here — or click to browse'
                : 'drop product image here — or click to use the fixture'}
            </p>
          )}
        </div>

        {error && (
          <p className="mb-4 rounded-sm border border-danger/60 bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
            {error}
          </p>
        )}

        <button
          onClick={unleash}
          disabled={busy}
          className={`w-full rounded-sm px-6 py-4 font-mono text-sm font-bold uppercase tracking-[0.2em] transition-colors ${
            busy
              ? 'cursor-default bg-panel text-dim'
              : 'bg-accent text-ink hover:bg-accent/85'
          }`}
        >
          {busy ? 'Onboarding brand…' : 'Unleash the swarm →'}
        </button>
      </div>
    </div>
  );
}
