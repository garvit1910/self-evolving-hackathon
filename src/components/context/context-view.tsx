'use client';

import { useState } from 'react';
import type { Brand, Fact } from '@/lib/contracts';
import { shortHash } from '@/lib/format';
import { ConfidenceBar } from '@/components/ui/confidence-bar';

const SECTIONS: { key: Fact['section']; label: string }[] = [
  { key: 'positioning', label: 'Positioning' },
  { key: 'value_prop', label: 'Value proposition' },
  { key: 'voice', label: 'Voice' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'persona', label: 'Personas' },
  { key: 'market_prior', label: 'Market priors' },
];

export function ContextView({
  brand,
  factsV1,
  factsV2,
  hashV2,
}: {
  brand: Brand;
  factsV1: Fact[];
  factsV2: Fact[];
  hashV2: string;
}) {
  const [showV2, setShowV2] = useState(false);
  const facts = showV2 ? factsV2 : factsV1;
  const version = showV2 ? 2 : 1;
  const hash = showV2 ? hashV2 : brand.contextHash;
  const added = factsV2.length - factsV1.length;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <h2 className="text-xl font-semibold text-fg">Context layer</h2>
        <span
          key={version}
          className={`anim-fade-up rounded-sm border px-2.5 py-1 font-mono text-xs ${
            showV2 ? 'border-accent text-accent' : 'border-line text-mut'
          }`}
        >
          v{version} · {shortHash(hash)}
        </span>
        {/* v1 → v2 diff toggle */}
        <div className="ml-auto flex overflow-hidden rounded-sm border border-line font-mono text-xs">
          <button
            onClick={() => setShowV2(false)}
            className={`px-3 py-1.5 transition-colors ${!showV2 ? 'bg-panel2 text-fg' : 'text-dim hover:text-mut'}`}
          >
            v1
          </button>
          <button
            onClick={() => setShowV2(true)}
            className={`px-3 py-1.5 transition-colors ${showV2 ? 'bg-accent-dim/40 text-accent' : 'text-dim hover:text-mut'}`}
          >
            v1 → v2 diff
          </button>
        </div>
      </div>

      {showV2 && (
        <p className="anim-fade-up mb-6 rounded-sm border border-accent-dim bg-accent-dim/20 px-3 py-2 font-mono text-xs text-accent">
          +{added} facts written back by the performance loop · hash {shortHash(brand.contextHash)} → {shortHash(hashV2)}
        </p>
      )}

      <div className="space-y-8">
        {SECTIONS.map(({ key, label }) => {
          const sectionFacts = facts.filter((f) => f.section === key);
          if (sectionFacts.length === 0) return null;
          return (
            <section key={key}>
              <h3 className="mb-3 border-b border-line pb-2 font-mono text-[11px] uppercase tracking-[0.25em] text-mut">
                {label} · {sectionFacts.length}
              </h3>
              <div className="space-y-3">
                {sectionFacts.map((fact) => {
                  const fromLoop = fact.origin === 'performance_loop';
                  return (
                    <div
                      key={fact.id}
                      className={`rounded-sm border p-4 ${
                        fromLoop
                          ? 'anim-fade-up border-accent/60 bg-accent-dim/20'
                          : 'border-line bg-panel'
                      }`}
                    >
                      <div className="mb-2 flex items-start justify-between gap-4">
                        <p className="text-sm leading-relaxed text-fg/95">{fact.statement}</p>
                        {fromLoop && (
                          <span className="shrink-0 rounded-sm border border-accent px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
                            performance loop
                          </span>
                        )}
                      </div>
                      {fact.sourceQuote && (
                        <p className="mb-2 border-l-2 border-line pl-3 text-xs italic leading-snug text-mut">
                          “{fact.sourceQuote}”
                        </p>
                      )}
                      <div className="flex items-center justify-between gap-4">
                        <ConfidenceBar value={fact.confidence} />
                        <span className="truncate font-mono text-[10px] text-dim">
                          {fact.sourceUrl
                            ? fact.sourceUrl.replace('https://', '')
                            : fromLoop
                              ? 'derived from simulated flight'
                              : fact.id}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
