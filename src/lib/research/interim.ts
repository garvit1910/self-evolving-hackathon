// Kill-switch fallback: the Band swarm (src/agents/swarm.ts) posts to the same
// routes (/facts + /events). This interim researcher exists so the demo works
// end-to-end today; the feed renders its events identically to the swarm's.

import type { AutopilotEvent, Fact } from '../contracts';
import { getContextStore } from '../context';
import { HTTPLLMClient, getLLMConfig } from '../llm';
import { researchFacts } from '@/fixtures/facts';

const MAX_EXTRA_PAGES = 2;
const MAX_CHARS_PER_PAGE = 8000;
const MAX_FACTS = 12;
const FETCH_TIMEOUT_MS = 10_000;
const PREFERRED_PATHS = /about|ingredients|faq|product|how-it-works|story/i;

const SECTIONS = new Set<Fact['section']>([
  'positioning',
  'value_prop',
  'voice',
  'compliance',
  'persona',
  'market_prior',
]);

export type InterimResult = { factCount: number; droppedQuotes: number; mode: 'live' | 'fallback' };

export interface ResearchLLM {
  jsonChat<T>(opts: { system: string; user: string; maxTokens?: number }): Promise<T>;
}

type RawFact = {
  section?: string;
  statement?: string;
  sourceUrl?: string;
  sourceQuote?: string;
  confidence?: number;
};

/** Lowercase, straighten curly quotes, collapse whitespace. */
export function normalizeForQuoteMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&(#39|apos);/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractSameOriginLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>([base.href]);
  const links: string[] = [];
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const resolved = new URL(match[1], base);
      if (resolved.origin !== base.origin) continue;
      if (/\.(png|jpe?g|svg|webp|css|js|ico|pdf|xml)$/i.test(resolved.pathname)) continue;
      resolved.hash = '';
      if (seen.has(resolved.href)) continue;
      seen.add(resolved.href);
      links.push(resolved.href);
    } catch {
      // unparsable href — skip
    }
  }
  return [
    ...links.filter((l) => PREFERRED_PATHS.test(l)),
    ...links.filter((l) => !PREFERRED_PATHS.test(l)),
  ];
}

async function fetchPage(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; SwarmAdsResearch/0.1)' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function runInterimResearch(opts: {
  brandId: string;
  url: string;
  /** Injectable for tests; undefined → resolve from env; null → force fallback. */
  llm?: ResearchLLM | null;
  fetchImpl?: typeof fetch;
  postEvent: (event: Omit<AutopilotEvent, 'ts'>) => void | Promise<void>;
}): Promise<InterimResult> {
  const { brandId, url, postEvent } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const config = getLLMConfig();
  const llm = opts.llm !== undefined ? opts.llm : config ? new HTTPLLMClient(config) : null;
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();

  const fallback = async (why: string): Promise<InterimResult> => {
    await postEvent({
      step: 'research',
      status: 'running',
      payload: { agent: 'Scout', message: `Offline fallback: fixture research corpus (${why}).` },
    });
    const facts = researchFacts.map((f) => ({ ...f, brandId }));
    await getContextStore().ingestFacts(brandId, facts);
    for (const fact of facts) {
      await postEvent({
        step: 'research',
        status: 'running',
        payload: {
          agent: fact.section === 'persona' ? 'Personasmith' : 'Analyst',
          message: fact.statement,
          factId: fact.id,
        },
      });
    }
    await postEvent({
      step: 'research',
      status: 'done',
      payload: { facts: facts.length, sources: 0, mode: 'fallback' },
    });
    return { factCount: facts.length, droppedQuotes: 0, mode: 'fallback' };
  };

  if (!llm) return fallback('no LLM key');

  await postEvent({
    step: 'research',
    status: 'running',
    payload: { agent: 'Scout', message: `Crawling ${host} — fetching homepage.` },
  });
  const homepage = await fetchPage(url, fetchImpl);
  if (homepage === null) return fallback(`could not fetch ${host}`);

  const extraUrls = extractSameOriginLinks(homepage, url).slice(0, MAX_EXTRA_PAGES);
  const pages: { url: string; text: string }[] = [
    { url, text: stripHtml(homepage).slice(0, MAX_CHARS_PER_PAGE) },
  ];
  for (const pageUrl of extraUrls) {
    const html = await fetchPage(pageUrl, fetchImpl);
    if (html !== null) {
      pages.push({ url: pageUrl, text: stripHtml(html).slice(0, MAX_CHARS_PER_PAGE) });
    }
  }
  await postEvent({
    step: 'research',
    status: 'running',
    payload: {
      agent: 'Scout',
      message: `${pages.length} page(s) fetched and stripped. Handing off to Analyst.`,
      pages: pages.length,
    },
  });

  let raw: RawFact[];
  try {
    const response = await llm.jsonChat<{ facts?: RawFact[] }>({
      system: `You are a brand research analyst. Extract 8-${MAX_FACTS} atomic facts about this brand from the provided pages. Each fact: {"section": one of "positioning"|"value_prop"|"voice"|"compliance"|"persona", "statement": <one concise sentence>, "sourceUrl": <the page url it came from>, "sourceQuote": <an EXACT verbatim substring copied from that page's text supporting the fact>, "confidence": 0..1}. Include 2-3 persona facts (audience archetypes, statement format "Name: description"). Respond as JSON {"facts": [...]}. sourceQuote MUST be copied character-for-character from the page text.`,
      user: pages.map((p) => `PAGE ${p.url}\n${p.text}`).join('\n\n'),
      maxTokens: 2000,
    });
    raw = Array.isArray(response.facts) ? response.facts : [];
  } catch (err) {
    return fallback(`LLM extraction failed: ${String(err).slice(0, 80)}`);
  }

  // mechanical quote verification — fabricated quotes are DROPPED, not trusted
  const normalizedPages = pages.map((p) => ({ url: p.url, norm: normalizeForQuoteMatch(p.text) }));
  let droppedQuotes = 0;
  const facts: Fact[] = [];
  for (const f of raw.slice(0, MAX_FACTS)) {
    if (
      typeof f.statement !== 'string' ||
      f.statement.trim() === '' ||
      !SECTIONS.has(f.section as Fact['section'])
    ) {
      continue;
    }
    const quote = typeof f.sourceQuote === 'string' ? f.sourceQuote.trim() : '';
    const normQuote = normalizeForQuoteMatch(quote);
    const sourcePage =
      normalizedPages.find((p) => p.url === f.sourceUrl) ?? normalizedPages[0];
    const verified =
      normQuote.length > 0 &&
      (sourcePage.norm.includes(normQuote) ||
        normalizedPages.some((p) => p.norm.includes(normQuote)));
    if (!verified) {
      droppedQuotes++;
      continue;
    }
    facts.push({
      id: `fact-${String(facts.length + 1).padStart(2, '0')}`,
      brandId,
      section: f.section as Fact['section'],
      statement: f.statement.trim(),
      sourceUrl: typeof f.sourceUrl === 'string' ? f.sourceUrl : url,
      sourceQuote: quote,
      confidence:
        typeof f.confidence === 'number' ? Math.min(1, Math.max(0, f.confidence)) : 0.7,
      origin: 'research',
    });
  }

  if (facts.length === 0) return fallback('no facts survived quote verification');

  await getContextStore().ingestFacts(brandId, facts);
  for (const fact of facts) {
    await postEvent({
      step: 'research',
      status: 'running',
      payload: {
        agent: fact.section === 'persona' ? 'Personasmith' : 'Analyst',
        message: fact.statement,
        factId: fact.id,
      },
    });
  }
  await postEvent({
    step: 'research',
    status: 'done',
    payload: {
      facts: facts.length,
      personas: facts.filter((f) => f.section === 'persona').length,
      sources: pages.length,
      droppedQuotes,
    },
  });
  return { factCount: facts.length, droppedQuotes, mode: 'live' };
}
