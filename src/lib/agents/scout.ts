/**
 * Scout — fetches the brand's own pages and strips them to readable text.
 * Plain fetch + hand-rolled readability. No Apify, no third-party scraper API —
 * "the swarm does its own research."
 */

import type { Feed } from '../adapters/interfaces';

export type ScoutPage = { url: string; title: string; text: string };

const MAX_PAGES = 8;
const FETCH_TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (compatible; SelfEvolvingAdEngine-Scout/1.0)';

async function fetchText(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Strip <head> (title/meta duplicate onto every "first line"), <script>/<style>/
 *  <nav>/<footer>, decode entities, collapse whitespace. */
function htmlToText(html: string): string {
  let s = html
    .replace(/<head[\s\S]*?<\/head>/i, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|nav|footer|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : '';
}

/** Trailing-slash-insensitive identity so "/pages/faq" and "/pages/faq/" collapse. */
function normalizedKey(u: URL): string {
  const path = u.pathname.replace(/\/$/, '') || '/';
  return `${u.origin}${path}${u.search}`;
}

/** Same-origin nav/internal links, deduped (trailing-slash insensitive), homepage first. */
function extractInternalLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const baseKey = normalizedKey(base);
  const seen = new Set<string>([baseKey]);
  const links: string[] = [];
  const re = /<a\s[^>]*href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base);
      if (u.origin !== base.origin) continue;
      u.hash = '';
      if (/\.(png|jpe?g|svg|gif|pdf|zip|css|js|ico|webp)$/i.test(u.pathname)) continue;
      const key = normalizedKey(u);
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(u.toString());
    } catch {
      // ignore malformed hrefs
    }
  }
  return links;
}

/** Priority keywords for picking which internal links to follow — brand-story pages
 *  first; individual product/SKU variants add little beyond the first one or two. */
const PRIORITY = ['about', 'faq', 'ingredient', 'story', 'why', 'quality', 'value', 'mission'];
const LOW_PRIORITY = ['/products/', '/product/', 'cart', 'checkout', 'account', 'login'];

function rankLinks(links: string[]): string[] {
  return [...links].sort((a, b) => {
    const score = (u: string) => {
      const low = u.toLowerCase();
      if (PRIORITY.some((k) => low.includes(k))) return 2;
      if (LOW_PRIORITY.some((k) => low.includes(k))) return 0;
      return 1;
    };
    return score(b) - score(a);
  });
}

/** Cap same-bucket pages (e.g. many /products/* SKU variants) so a handful of
 *  near-duplicate pages don't crowd out distinct brand-story content. */
function diversify(links: string[], maxPerBucket = 2): string[] {
  const counts = new Map<string, number>();
  const out: string[] = [];
  for (const u of links) {
    const bucket = LOW_PRIORITY.find((k) => u.toLowerCase().includes(k)) ?? 'other';
    const n = counts.get(bucket) ?? 0;
    if (bucket !== 'other' && n >= maxPerBucket) continue;
    counts.set(bucket, n + 1);
    out.push(u);
  }
  return out;
}

export async function scoutBrand(
  brandUrl: string,
  feed: Feed,
  room: string,
  maxPages = MAX_PAGES,
): Promise<ScoutPage[]> {
  const pages: ScoutPage[] = [];
  const homeHtml = await fetchText(brandUrl);
  if (!homeHtml) {
    await feed.post(room, { agent: 'scout', kind: 'error', payload: { url: brandUrl, error: 'homepage fetch failed' } });
    return pages;
  }

  pages.push({ url: brandUrl, title: extractTitle(homeHtml), text: htmlToText(homeHtml) });
  await feed.post(room, {
    agent: 'scout',
    kind: 'tool_result',
    payload: { url: brandUrl, chars: pages[0].text.length },
  });

  const candidates = diversify(rankLinks(extractInternalLinks(homeHtml, brandUrl))).filter((u) => u !== brandUrl);

  for (const url of candidates) {
    if (pages.length >= maxPages) break;
    const html = await fetchText(url);
    if (!html) continue;
    const text = htmlToText(html);
    if (text.length < 80) continue; // skip near-empty pages
    pages.push({ url, title: extractTitle(html), text });
    await feed.post(room, { agent: 'scout', kind: 'tool_result', payload: { url, chars: text.length } });
  }

  await feed.post(room, {
    agent: 'scout',
    kind: 'thought',
    payload: { summary: `fetched ${pages.length} page(s) from ${new URL(brandUrl).hostname}` },
  });

  return pages;
}
