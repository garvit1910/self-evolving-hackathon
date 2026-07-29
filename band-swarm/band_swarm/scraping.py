"""Scraping heart of the swarm — a faithful Python port of the essentials of
src/lib/agents/scout.ts (plain fetch + hand-rolled readability, no third-party
scraper). Extraction and quote verification both run against THIS module's
text output, so verbatim substring checks stay honest.
"""

from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

import httpx

MAX_PAGES = 8
FETCH_TIMEOUT_S = 8.0
UA = "Mozilla/5.0 (compatible; SelfEvolvingAdEngine-Scout/1.0)"

# Priority keywords for picking which internal links to follow — brand-story
# pages first; individual product/SKU variants add little beyond the first two.
PRIORITY = ["about", "faq", "ingredient", "story", "why", "quality", "value", "mission"]
LOW_PRIORITY = ["/products/", "/product/", "cart", "checkout", "account", "login"]

_ASSET_RE = re.compile(r"\.(png|jpe?g|svg|gif|pdf|zip|css|js|ico|webp)$", re.I)
_HREF_RE = re.compile(r"<a\s[^>]*href=[\"']([^\"']+)[\"']", re.I)


def fetch_html(url: str) -> str | None:
    try:
        with httpx.Client(
            timeout=FETCH_TIMEOUT_S, follow_redirects=True, headers={"user-agent": UA}
        ) as client:
            res = client.get(url)
            if not res.is_success:
                return None
            if "text/html" not in res.headers.get("content-type", ""):
                return None
            return res.text
    except Exception:
        return None


def html_to_text(html: str) -> str:
    """Strip <head> (title/meta duplicate onto every "first line"), <script>/
    <style>/<nav>/<footer>, decode entities, collapse whitespace."""
    s = re.sub(r"<head[\s\S]*?</head>", " ", html, count=1, flags=re.I)
    s = re.sub(r"<!--[\s\S]*?-->", " ", s)
    s = re.sub(r"<(script|style|nav|footer|noscript|svg)[\s\S]*?</\1>", " ", s, flags=re.I)
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</(p|div|li|h[1-6]|section|article)>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = (
        s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&quot;", '"')
    )
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in s.split("\n")]
    return "\n".join(line for line in lines if line)


def extract_title(html: str) -> str:
    m = re.search(r"<title[^>]*>([^<]*)</title>", html, re.I)
    return m.group(1).strip() if m else ""


def _origin(u) -> str:
    return f"{u.scheme}://{u.netloc}"


def _normalized_key(url: str) -> str:
    """Trailing-slash-insensitive identity so "/pages/faq" and "/pages/faq/" collapse."""
    u = urlparse(url)
    path = re.sub(r"/$", "", u.path) or "/"
    query = f"?{u.query}" if u.query else ""
    return f"{_origin(u)}{path}{query}"


def extract_internal_links(html: str, base_url: str) -> list[str]:
    """Same-origin nav/internal links, deduped (trailing-slash insensitive)."""
    base_origin = _origin(urlparse(base_url))
    seen = {_normalized_key(base_url)}
    links: list[str] = []
    for m in _HREF_RE.finditer(html):
        try:
            resolved = urljoin(base_url, m.group(1)).split("#", 1)[0]
            u = urlparse(resolved)
            if u.scheme not in ("http", "https") or _origin(u) != base_origin:
                continue
            if _ASSET_RE.search(u.path):
                continue
            key = _normalized_key(resolved)
            if key in seen:
                continue
            seen.add(key)
            links.append(resolved)
        except ValueError:
            continue
    return links


def rank_links(links: list[str]) -> list[str]:
    def score(url: str) -> int:
        low = url.lower()
        if any(k in low for k in PRIORITY):
            return 2
        if any(k in low for k in LOW_PRIORITY):
            return 0
        return 1

    return sorted(links, key=score, reverse=True)


def diversify(links: list[str], max_per_bucket: int = 2) -> list[str]:
    """Cap same-bucket pages (e.g. many /products/* SKU variants) so near-duplicate
    pages don't crowd out distinct brand-story content."""
    counts: dict[str, int] = {}
    out: list[str] = []
    for url in links:
        bucket = next((k for k in LOW_PRIORITY if k in url.lower()), "other")
        n = counts.get(bucket, 0)
        if bucket != "other" and n >= max_per_bucket:
            continue
        counts[bucket] = n + 1
        out.append(url)
    return out


def plan_crawl(html: str, base_url: str, cap: int = 12) -> list[str]:
    """Ranked, diversified same-origin candidates for the crawl plan."""
    base_key = _normalized_key(base_url)
    candidates = diversify(rank_links(extract_internal_links(html, base_url)))
    return [u for u in candidates if _normalized_key(u) != base_key][:cap]


def normalize(s: str) -> str:
    """The quote-verification normalization — MUST match src/lib/agents/analyst.ts."""
    return re.sub(r"\s+", " ", s).strip().lower()
