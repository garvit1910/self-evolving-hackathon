/**
 * Analyst — extracts positioning / value_prop / voice / compliance facts from
 * scouted pages via Pioneer, each with a verbatim source quote. Every quote is
 * mechanically substring-verified against the source page text; anything that
 * doesn't verify is dropped. This grounding check is the credibility gate.
 */

import type { Fact, FactSection } from '@/lib/contracts';
import type { Feed, LLM } from '../adapters/interfaces';
import type { ScoutPage } from './scout';

const SECTIONS: FactSection[] = ['positioning', 'value_prop', 'voice', 'compliance'];
const MAX_PROMPT_CHARS = 12000;

type RawFact = {
  section: string;
  statement: string;
  sourceUrl: string;
  sourceQuote: string;
  confidence: number;
};

function buildPrompt(pages: ScoutPage[]): string {
  let budget = MAX_PROMPT_CHARS;
  const chunks: string[] = [];
  for (const p of pages) {
    if (budget <= 0) break;
    const slice = p.text.slice(0, Math.min(p.text.length, budget));
    budget -= slice.length;
    chunks.push(`### ${p.url}\n${slice}`);
  }
  return [
    'You are a brand analyst. From the pages below, extract facts about the brand:',
    `sections: ${SECTIONS.join(', ')}.`,
    'Each fact MUST include a sourceQuote copied VERBATIM (character-for-character)',
    'from the page at sourceUrl — no paraphrasing in the quote. Extract 1-3 facts per section',
    'where the pages support it. Skip a section entirely if unsupported.',
    '',
    chunks.join('\n\n'),
  ].join('\n');
}

const SCHEMA_HINT =
  '{ facts: { section: "positioning"|"value_prop"|"voice"|"compliance", statement: string, sourceUrl: string, sourceQuote: string, confidence: number }[] }';

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function analyzeBrand(
  brandId: string,
  pages: ScoutPage[],
  llm: LLM,
  feed: Feed,
  room: string,
): Promise<Fact[]> {
  if (pages.length === 0) return [];

  const { facts: raw } = await llm.extract<{ facts: RawFact[] }>(buildPrompt(pages), SCHEMA_HINT);
  const byUrl = new Map(pages.map((p) => [p.url, p.text]));

  const grounded: Fact[] = [];
  let dropped = 0;
  let n = 0;

  for (const f of raw ?? []) {
    if (!SECTIONS.includes(f.section as FactSection)) continue;
    const pageText = byUrl.get(f.sourceUrl);
    const quote = (f.sourceQuote ?? '').trim();
    const verified = !!pageText && !!quote && normalize(pageText).includes(normalize(quote));

    if (!verified) {
      dropped += 1;
      await feed.post(room, {
        agent: 'analyst',
        kind: 'thought',
        payload: { dropped: true, section: f.section, reason: 'quote not verbatim in source', sourceUrl: f.sourceUrl },
      });
      continue;
    }

    n += 1;
    const fact: Fact = {
      id: `f${n}`,
      brandId,
      section: f.section as FactSection,
      statement: f.statement,
      sourceUrl: f.sourceUrl,
      sourceQuote: quote,
      confidence: Math.max(0, Math.min(1, f.confidence ?? 0.7)),
      origin: 'research',
    };
    grounded.push(fact);
    // each verified fact is posted to the room as it lands — the live feed beat
    await feed.post(room, {
      agent: 'analyst',
      kind: 'tool_result',
      payload: {
        factId: fact.id,
        section: fact.section,
        statement: fact.statement,
        sourceQuote: quote,
        sourceUrl: fact.sourceUrl,
      },
    });
  }

  await feed.post(room, {
    agent: 'analyst',
    kind: 'tool_result',
    payload: { extracted: grounded.length, dropped, sections: [...new Set(grounded.map((f) => f.section))] },
  });

  return grounded;
}
