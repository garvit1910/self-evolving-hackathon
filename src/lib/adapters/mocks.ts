/**
 * Mock adapters — deterministic, offline, zero network. The demo's resting state.
 * Every mock returns the EXACT shape composeBrief consumes, so real adapters can
 * be swapped in one at a time behind the same interface.
 */

import type { Fact } from '@/lib/contracts';
import type {
  ContextStore,
  Feed,
  Governance,
  ImageGen,
  LLM,
  VectorStore,
} from './interfaces';
import { FLOOR_TERMS } from '@/lib/creative/bannedTerms';

/** stable sha-ish hash for deterministic contextHash values (demo-grade, not crypto). */
function stableHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  return 'ctx_' + (h >>> 0).toString(16).padStart(8, '0');
}

const MOCK_FACTS: Fact[] = [
  {
    id: 'f1',
    brandId: 'magic-spoon',
    section: 'positioning',
    statement: 'High-protein, low-sugar childhood cereal for health-conscious adults.',
    sourceUrl: 'https://magicspoon.com',
    sourceQuote: 'Cereal reimagined: 0g sugar, 13g protein.',
    confidence: 0.92,
    origin: 'research',
  },
  {
    id: 'f2',
    brandId: 'magic-spoon',
    section: 'value_prop',
    statement: 'Tastes like the sugary cereal you grew up with, without the sugar crash.',
    sourceUrl: 'https://magicspoon.com',
    sourceQuote: 'All the taste, none of the guilt.',
    confidence: 0.88,
    origin: 'research',
  },
  {
    id: 'f3',
    brandId: 'magic-spoon',
    section: 'voice',
    statement: 'Playful, nostalgic, cheeky challenger-brand tone.',
    sourceUrl: 'https://magicspoon.com',
    sourceQuote: 'Bring back Saturday mornings.',
    confidence: 0.8,
    origin: 'research',
  },
  {
    id: 'f4',
    brandId: 'magic-spoon',
    section: 'compliance',
    statement: 'Avoid absolute health claims; "keto-friendly" allowed, "cures" is not.',
    confidence: 0.75,
    origin: 'research',
  },
];

export function createMockContextStore(): ContextStore {
  let version = 1;
  return {
    async ingest(sources) {
      const hash = stableHash(sources.map((s) => s.title + s.text).join('|') + `v${version}`);
      return { sourceIds: sources.map((_, i) => `senso-src-${i + 1}`), contextHash: hash };
    },
    async search(query, k) {
      const q = query.toLowerCase();
      const ranked = [...MOCK_FACTS].sort((a, b) => {
        const sa = a.statement.toLowerCase().includes(q) ? 1 : 0;
        const sb = b.statement.toLowerCase().includes(q) ? 1 : 0;
        return sb - sa || b.confidence - a.confidence;
      });
      return ranked.slice(0, k);
    },
    async writeback(learningMarkdown) {
      version += 1;
      return { sourceId: `senso-learning-${version}`, contextHash: stableHash(learningMarkdown + `v${version}`) };
    },
  };
}

const FACT_SECTIONS = ['positioning', 'value_prop', 'voice', 'compliance'] as const;

/** Pull a short, verbatim-safe quote out of a page's own text (first substantial line). */
function pickQuote(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length >= 20) ?? text.slice(0, 80);
  return line.trim().slice(0, 100);
}

/** Derives facts/personas FROM the prompt content itself, so quotes always verify —
 *  mock stays a working resting state even for content-dependent extraction, not
 *  just a fixed canned answer. Real Fastino swaps in behind this. */
export function createMockLLM(): LLM {
  return {
    async extract<T>(prompt: string, schemaHint: string): Promise<T> {
      if (schemaHint.includes('sourceQuote')) {
        const pageRe = /^### (\S+)\n([\s\S]*?)(?=\n### |$)/gm;
        const facts: (typeof MOCK_FACTS)[number][] = [];
        let m: RegExpExecArray | null;
        let i = 0;
        while ((m = pageRe.exec(prompt))) {
          const [, url, text] = m;
          if (text.trim().length < 20) continue;
          const quote = pickQuote(text);
          facts.push({
            id: `mock-f${++i}`,
            brandId: 'unknown',
            section: FACT_SECTIONS[i % FACT_SECTIONS.length],
            statement: `Notable brand statement: "${quote}"`,
            sourceUrl: url,
            sourceQuote: quote,
            confidence: 0.75,
            origin: 'research',
          });
        }
        return { facts: facts.length ? facts : MOCK_FACTS } as unknown as T;
      }
      if (schemaHint.includes('copies')) {
        // The copywriter's prompt emits one `[i] angle: ... | style: ...` block
        // per genome (see genomeBlock in src/lib/agents/copywriter.ts), followed
        // by a `    hook: ...` line and a `    Audience: NAME — ...` line. Parse
        // those markers back out so mock copy is genome-distinct instead of
        // collapsing to the same fallback string for every variant.
        const blockRe = /^\[(\d+)\] angle: (.+?) \| style: (.+?)$\n {4}hook: (.+?)$(?:\n {4,}Audience: ([^—\n]+?)(?: —|$))?/gm;
        const copies: { index: number; copy: string }[] = [];
        let m: RegExpExecArray | null;
        while ((m = blockRe.exec(prompt))) {
          const [, idxStr, angle, style, hook, persona] = m;
          const audience = persona ? persona.trim() : 'you';
          let copy = `${angle}: ${hook} — made for ${audience}, ${style} style.`;
          // Belt-and-suspenders: never let a mock copy contain a floor term,
          // even though angle/hook/persona text should never legitimately
          // include one.
          for (const term of FLOOR_TERMS) {
            const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
            copy = copy.replace(re, '');
          }
          copies.push({ index: Number(idxStr), copy });
        }
        return { copies } as unknown as T;
      }
      if (schemaHint.includes('factIds')) {
        const ids = [...new Set([...prompt.matchAll(/\[(\S+?)\]/g)].map((m) => m[1]))];
        const personas = [
          { name: 'Nostalgic Millennial', summary: 'Wants childhood comfort without the guilt.', pains: ['guilt'], desires: ['nostalgia'], objections: ['price'], factIds: ids.slice(0, 2) },
          { name: 'Busy Professional', summary: 'Needs a fast, better-for-you option.', pains: ['no time'], desires: ['convenience'], objections: ['does it fill me up?'], factIds: ids.slice(0, 1) },
          { name: 'Health Optimizer', summary: 'Tracks macros, skeptical of marketing claims.', pains: ['hidden sugar'], desires: ['high protein'], objections: ['is this just marketing?'], factIds: ids },
        ];
        return { personas } as unknown as T;
      }
      return { facts: MOCK_FACTS } as unknown as T;
    },
    async complete(prompt: string) {
      return `[[mock-copy]] ${prompt.slice(0, 60)}`;
    },
  };
}

export function createMockVectorStore(): VectorStore {
  const store: { id: string; text: string }[] = [];
  return {
    async upsert(items) {
      for (const it of items) store.push({ id: it.id, text: it.text });
    },
    async topK(query, k) {
      const q = query.toLowerCase();
      return store
        .map((s) => ({
          id: s.id,
          text: s.text,
          score: s.text.toLowerCase().includes(q) ? 1 : 0.5,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
  };
}

export function createMockFeed(): Feed {
  return {
    async join(room) {
      void room;
    },
    async post(room, event) {
      // In real Band this streams to the room; mock just no-ops (or console for debug).
      void room;
      void event;
    },
  };
}

export function createMockGovernance(): Governance {
  return {
    async approve(action, ctx) {
      // Observable policy: block low-confidence writeback so the demo has a visible veto.
      const conf = typeof ctx.confidence === 'number' ? (ctx.confidence as number) : 1;
      if (action === 'writeback' && conf < 0.6) {
        return { ok: false, reason: `blocked: confidence ${conf} < 0.6` };
      }
      return { ok: true };
    },
  };
}

const FALLBACK_IMAGES = [
  '/fixtures/ad-1.svg',
  '/fixtures/ad-2.svg',
  '/fixtures/ad-3.svg',
  '/fixtures/ad-4.svg',
];

export function createMockImageGen(): ImageGen {
  let n = 0;
  return {
    async generate(_prompt, _refImageUrl) {
      const imageUrl = FALLBACK_IMAGES[n % FALLBACK_IMAGES.length];
      n += 1;
      return { imageUrl };
    },
  };
}

/** One place to assemble the full mock adapter set. */
export function createMockAdapters() {
  return {
    context: createMockContextStore(),
    llm: createMockLLM(),
    vector: createMockVectorStore(),
    feed: createMockFeed(),
    governance: createMockGovernance(),
    imageGen: createMockImageGen(),
  };
}

export type Adapters = ReturnType<typeof createMockAdapters>;
