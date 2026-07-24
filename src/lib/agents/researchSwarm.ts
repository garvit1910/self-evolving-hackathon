/**
 * Research swarm orchestrator — Scout → Analyst → Personasmith, coordinating in
 * a Band room (brand-research:{brandId}) that the UI mirrors as the live "swarm
 * view". Findings are compiled and ingested into Senso (context v1) and embedded
 * into Actian for hot retrieval. Governance gates the publish step so a
 * low-confidence research pass is OBSERVABLY blocked rather than silently shipped.
 */

import type { Fact, Persona } from '@/lib/contracts';
import type { Adapters } from '../adapters';
import { scoutBrand, type ScoutPage } from './scout';
import { analyzeBrand } from './analyst';
import { generatePersonas } from './personasmith';

export type ResearchResult = {
  brandId: string;
  room: string;
  pages: ScoutPage[];
  facts: Fact[];
  personas: Persona[];
  sensoSourceIds: string[];
  contextHash: string;
  governance: { ok: boolean; reason?: string };
};

function roomFor(brandId: string): string {
  return `brand-research:${brandId}`;
}

function compileFactsMarkdown(brandId: string, facts: Fact[]): string {
  const bySection = new Map<string, Fact[]>();
  for (const f of facts) {
    const list = bySection.get(f.section) ?? [];
    list.push(f);
    bySection.set(f.section, list);
  }
  const lines: string[] = [`# ${brandId} — compiled research facts`];
  for (const [section, list] of bySection) {
    lines.push(`\n## ${section}`);
    for (const f of list) {
      lines.push(`- ${f.statement}${f.sourceQuote ? ` (source: "${f.sourceQuote}" — ${f.sourceUrl})` : ''}`);
    }
  }
  return lines.join('\n');
}

function avgConfidence(facts: Fact[]): number {
  if (facts.length === 0) return 0;
  return facts.reduce((s, f) => s + f.confidence, 0) / facts.length;
}

export async function runResearchSwarm(
  brandId: string,
  brandUrl: string,
  adapters: Adapters,
): Promise<ResearchResult> {
  const { llm, feed, governance, context, vector } = adapters;
  const room = roomFor(brandId);

  await feed.join(room);
  await feed.post(room, { agent: 'swarm', kind: 'thought', payload: { status: 'starting', brandUrl } });

  const pages = await scoutBrand(brandUrl, feed, room);
  const facts = await analyzeBrand(brandId, pages, llm, feed, room);
  const personas = await generatePersonas(brandId, facts, llm, feed, room);

  const factsMd = compileFactsMarkdown(brandId, facts);
  const { sourceIds, contextHash } = await context.ingest([
    ...pages.map((p) => ({ title: p.title || p.url, text: p.text })),
    { title: 'facts.md', text: factsMd },
  ]);

  if (facts.length > 0) {
    await vector.upsert(facts.map((f) => ({ id: f.id, text: f.statement })));
  }

  const gov = await governance.approve('research_publish', { confidence: avgConfidence(facts) });
  await feed.post(room, {
    agent: 'governance',
    kind: gov.ok ? 'tool_result' : 'error',
    payload: { action: 'research_publish', ...gov },
  });

  await feed.post(room, {
    agent: 'swarm',
    kind: 'thought',
    payload: {
      status: 'done',
      pages: pages.length,
      facts: facts.length,
      personas: personas.length,
      contextHash,
      governanceOk: gov.ok,
    },
  });

  return { brandId, room, pages, facts, personas, sensoSourceIds: sourceIds, contextHash, governance: gov };
}
