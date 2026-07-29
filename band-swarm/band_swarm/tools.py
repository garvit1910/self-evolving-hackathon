"""Custom Band tools for the swarm roles + the deterministic app bridge.

Every tool call mirrors one AutopilotEvent into the SwarmAds app
(POST {appBase}/api/brands/{id}/events, step 'research') so the in-app
/research feed animates from real tool activity — never from LLM cooperation.
Facts reach the app only through publish_facts, replicating the legacy
worker's payloads (src/agents/swarm.ts) against the frozen INTEGRATION.md
contract. Zero changes to src/lib/contracts.ts.
"""

from __future__ import annotations

import ast
import json
from typing import Annotated, Any, Callable, Literal, TypeVar

import httpx
from pydantic import BaseModel, BeforeValidator, Field

from . import runstate, scraping

T = TypeVar("T")


def _coerce_json_list(v: Any) -> Any:
    """Claude sometimes passes a nested list as a JSON-encoded string, a lone
    object instead of a one-item list, or Python-repr pseudo-JSON — normalize
    all of those so tool validation doesn't bounce the call back to the model."""
    if isinstance(v, dict):
        return [v]
    if isinstance(v, str):
        for parse in (json.loads, ast.literal_eval):
            try:
                parsed = parse(v)
            except Exception:
                continue
            return [parsed] if isinstance(parsed, dict) else parsed
    return v


JsonList = Annotated[list[T], BeforeValidator(_coerce_json_list)]

# Governance gate — mirrors the legacy mock-governance semantics the app expects.
MIN_FACTS = 3
MIN_AVG_CONFIDENCE = 0.5

READ_PAGE_MAX_CHARS = 10_000

ToolDef = tuple[type[BaseModel], Callable[..., Any]]


def _http_post_json(url: str, body: Any) -> dict[str, Any] | None:
    """Single HTTP seam (tests monkeypatch this)."""
    try:
        res = httpx.post(url, json=body, timeout=10.0)
        if not res.is_success:
            return None
        return res.json()
    except Exception:
        return None


def _mirror(label: str, message: str, status: str = "running", extra: dict[str, Any] | None = None) -> None:
    """Best-effort AutopilotEvent mirror into the app feed (like the legacy bridgeFeed)."""
    state = runstate.load()
    if state is None:
        return
    payload: dict[str, Any] = {"agent": label, "message": message}
    if extra:
        payload.update(extra)
    _http_post_json(
        f"{state['appBase']}/api/brands/{state['brandId']}/events",
        {"step": "research", "status": status, "payload": payload},
    )


def _result(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Page tools (Cartographer, Scout, Analyst)
# ---------------------------------------------------------------------------


class FetchPageInput(BaseModel):
    """Fetch a brand web page, strip it to readable text, and cache it in the
    shared run-state for the other agents. Returns title, char count, a text
    preview, and ranked internal-link candidates found on the page."""

    url: str = Field(description="Absolute http(s) URL of the page to fetch")


def make_fetch_page(label: str) -> ToolDef:
    def fetch_page(args: FetchPageInput) -> str:
        html = scraping.fetch_html(args.url)
        if html is None:
            _mirror(label, f"Could not fetch {args.url} — fetch failed or not HTML.")
            return _result({"ok": False, "error": "fetch failed, non-HTML, or timed out"})
        text = scraping.html_to_text(html)
        if len(text) < 80:
            _mirror(label, f"Skipped {args.url} — page is near-empty after cleanup.")
            return _result({"ok": False, "error": "page near-empty after cleanup"})
        title = scraping.extract_title(html)
        links = scraping.plan_crawl(html, args.url)
        runstate.add_page(args.url, title, text, links)
        _mirror(label, f"Fetched {args.url} ({len(text)} chars).")
        return _result(
            {
                "ok": True,
                "url": args.url,
                "title": title,
                "chars": len(text),
                "preview": text[:400],
                "internal_links": links,
            }
        )

    return (FetchPageInput, fetch_page)


class ExtractLinksInput(BaseModel):
    """Return the ranked, diversified internal-link candidates cached for an
    already-fetched page (brand-story pages first, SKU/cart pages capped)."""

    url: str = Field(description="URL of a page previously fetched with fetch_page")


def make_extract_links(label: str) -> ToolDef:
    def extract_links(args: ExtractLinksInput) -> str:
        page = runstate.get_page(args.url)
        if page is None:
            return _result({"ok": False, "error": "page not cached — call fetch_page first"})
        _mirror(label, f"Planned {len(page['links'])} crawl candidates from {args.url}.")
        return _result({"ok": True, "url": args.url, "candidates": page["links"]})

    return (ExtractLinksInput, extract_links)


class ListPagesInput(BaseModel):
    """List every page cached in this run (url, title, char count)."""


def make_list_pages(label: str) -> ToolDef:
    def list_pages(args: ListPagesInput) -> str:
        return _result({"pages": runstate.pages_summary()})

    return (ListPagesInput, list_pages)


class ReadPageInput(BaseModel):
    """Read the cleaned text of a cached page. Quotes for facts MUST be copied
    character-for-character from this text."""

    url: str = Field(description="URL of a page previously fetched with fetch_page")


def make_read_page(label: str) -> ToolDef:
    def read_page(args: ReadPageInput) -> str:
        page = runstate.get_page(args.url)
        if page is None:
            return _result({"ok": False, "error": "page not cached — ask Scout to fetch it"})
        text = page["text"]
        return _result(
            {
                "ok": True,
                "url": args.url,
                "title": page["title"],
                "text": text[:READ_PAGE_MAX_CHARS],
                "truncated": len(text) > READ_PAGE_MAX_CHARS,
            }
        )

    return (ReadPageInput, read_page)


# ---------------------------------------------------------------------------
# Fact tools (Analyst, Critic)
# ---------------------------------------------------------------------------


class StagedFactIn(BaseModel):
    section: Literal["positioning", "value_prop", "voice", "compliance"]
    statement: str = Field(description="The brand fact, in your own words")
    source_url: str = Field(description="URL of the cached page the quote comes from")
    source_quote: str = Field(
        description="VERBATIM character-for-character quote from the page text — no paraphrasing"
    )
    confidence: float = Field(ge=0, le=1)


class StageFactsInput(BaseModel):
    """Stage extracted brand facts for the Critic's verification. Ids (f1…fN)
    are assigned automatically; quotes travel through the run-state so they
    stay byte-exact."""

    facts: JsonList[StagedFactIn]


def make_stage_facts(label: str) -> ToolDef:
    def stage_facts(args: StageFactsInput) -> str:
        items = [
            {
                "section": f.section,
                "statement": f.statement,
                "sourceUrl": f.source_url,
                "sourceQuote": f.source_quote.strip(),
                "confidence": max(0.0, min(1.0, f.confidence)),
            }
            for f in args.facts
        ]
        staged = runstate.stage_facts(items, stream="brand")
        if staged is None:
            return _result({"ok": False, "error": "brand stream already settled — too late to stage"})
        for fact in staged:
            _mirror(label, f"Staged fact {fact['id']} [{fact['section']}] {fact['statement']}")
        return _result({"staged_ids": [f["id"] for f in staged], "count": len(staged)})

    return (StageFactsInput, stage_facts)


class CompetitorFactIn(BaseModel):
    competitor: str = Field(description="Competitor brand name, e.g. 'OffLimits'")
    statement: str = Field(description="The competitor insight, in your own words")
    source_url: str = Field(description="URL of the fetched competitor page the quote comes from")
    source_quote: str = Field(
        description="VERBATIM character-for-character quote from the competitor page text"
    )
    confidence: float = Field(ge=0, le=1)


class StageCompetitorFactsInput(BaseModel):
    """Stage competitor-insight facts for the Critic's verification. They are
    stored as section 'market_prior' with the statement prefixed by the
    competitor's name; ids are assigned automatically."""

    facts: JsonList[CompetitorFactIn]


def make_stage_competitor_facts(label: str) -> ToolDef:
    def stage_competitor_facts(args: StageCompetitorFactsInput) -> str:
        items = []
        for f in args.facts:
            statement = f.statement
            if not statement.lower().startswith(f"competitor ({f.competitor.lower()})"):
                statement = f"Competitor ({f.competitor}): {statement}"
            items.append(
                {
                    "section": "market_prior",
                    "statement": statement,
                    "sourceUrl": f.source_url,
                    "sourceQuote": f.source_quote.strip(),
                    "confidence": max(0.0, min(1.0, f.confidence)),
                }
            )
        staged = runstate.stage_facts(items, stream="competitor")
        if staged is None:
            return _result({"ok": False, "error": "competitor stream already settled — too late to stage"})
        for fact in staged:
            _mirror(label, f"Staged fact {fact['id']} [market_prior] {fact['statement']}")
        return _result({"staged_ids": [f["id"] for f in staged], "count": len(staged)})

    return (StageCompetitorFactsInput, stage_competitor_facts)


class MarkStreamSettledInput(BaseModel):
    """Mark the competitor stream settled (e.g. no competitors could be fetched,
    or it went silent). Convergence to the Personasmith requires both streams
    settled — this is the no-deadlock escape hatch."""

    stream: Literal["competitor"]
    reason: str


def make_mark_stream_settled(label: str) -> ToolDef:
    def mark_stream_settled(args: MarkStreamSettledInput) -> str:
        outcome = runstate.mark_stream_settled(args.stream, args.reason)
        _mirror(label, f"Competitor stream settled: {args.reason}")
        return _result(outcome)

    return (MarkStreamSettledInput, mark_stream_settled)


class GetStagedFactsInput(BaseModel):
    """List the facts currently staged and awaiting verification."""


def make_get_staged_facts(label: str) -> ToolDef:
    def get_staged_facts(args: GetStagedFactsInput) -> str:
        return _result({"staged": runstate.staged_facts()})

    return (GetStagedFactsInput, get_staged_facts)


class VerifyQuoteInput(BaseModel):
    """Mechanically check that a quote appears VERBATIM (whitespace/case
    normalized) in the cached text of its source page. This check is the
    credibility gate — trust its output over any argument in chat."""

    source_url: str = Field(description="URL of the cached source page")
    quote: str = Field(description="The exact quote to verify")


def _closest_hint(page_norm: str, quote_norm: str) -> str:
    words = quote_norm.split(" ")
    for n in range(len(words) - 1, 0, -1):
        prefix = " ".join(words[:n])
        idx = page_norm.find(prefix)
        if idx >= 0:
            return page_norm[max(0, idx - 60) : idx + len(prefix) + 120]
    return ""


def make_verify_quote(label: str) -> ToolDef:
    def verify_quote(args: VerifyQuoteInput) -> str:
        page = runstate.get_page(args.source_url)
        if page is None:
            return _result({"verified": False, "reason": "source page not cached in this run"})
        page_norm = scraping.normalize(page["text"])
        quote_norm = scraping.normalize(args.quote)
        if not quote_norm:
            return _result({"verified": False, "reason": "empty quote"})
        idx = page_norm.find(quote_norm)
        if idx >= 0:
            snippet = page_norm[max(0, idx - 80) : idx + len(quote_norm) + 80]
            return _result({"verified": True, "context": snippet})
        hint = _closest_hint(page_norm, quote_norm)
        return _result(
            {
                "verified": False,
                "reason": "quote not found verbatim in source page",
                "closest_fragment": hint or "no overlapping fragment found",
            }
        )

    return (VerifyQuoteInput, verify_quote)


class VerdictIn(BaseModel):
    fact_id: str
    verdict: Literal["approve", "reject"]
    reason: str | None = Field(default=None, description="Required for rejections")


class RecordVerdictsInput(BaseModel):
    """Record approve/reject verdicts for staged facts. Approvals become
    verified facts; rejections go back to the Analyst (any rejection advances
    the revision round counter)."""

    verdicts: JsonList[VerdictIn]


def make_record_verdicts(label: str) -> ToolDef:
    def record_verdicts(args: RecordVerdictsInput) -> str:
        outcome = runstate.apply_verdicts([v.model_dump() for v in args.verdicts])
        if "error" in outcome:
            return _result(outcome)
        for fact in outcome["approved"]:
            _mirror(
                label,
                f"Verified fact {fact['id']} [{fact['section']}] {fact['statement']}"
                f" — source: \"{fact['sourceQuote']}\"",
                extra={"factId": fact["id"], "section": fact["section"], "sourceQuote": fact["sourceQuote"]},
            )
        for fact in outcome["rejected"]:
            _mirror(label, f"Rejected {fact['id']} [{fact['section']}] — quote failed verification.")
        _mirror(
            label,
            f"Verification round {outcome['round']}: {len(outcome['approved'])} approved, "
            f"{len(outcome['rejected'])} rejected ({outcome['verified_total']} verified total).",
        )
        return _result(
            {
                "approved_ids": [f["id"] for f in outcome["approved"]],
                "rejected_ids": [f["id"] for f in outcome["rejected"]],
                "unknown_ids": outcome["unknown_ids"],
                "round": outcome["round"],
                "rounds": outcome["rounds"],
                "streams": outcome["streams"],
                "rejected_by_stream": outcome["rejected_by_stream"],
                "revision_allowed": outcome["revision_allowed"],
                "verified_total": outcome["verified_total"],
                "still_staged": outcome["still_staged"],
            }
        )

    return (RecordVerdictsInput, record_verdicts)


class GetVerifiedFactsInput(BaseModel):
    """List every verified fact in this run (id, section, statement, source),
    including competitor market_prior facts."""


def make_get_verified_facts(label: str) -> ToolDef:
    def get_verified_facts(args: GetVerifiedFactsInput) -> str:
        return _result({"verified": runstate.verified_facts()})

    return (GetVerifiedFactsInput, get_verified_facts)


class GetVerifiedBrandFactsInput(BaseModel):
    """List the verified BRAND facts (positioning/value_prop/voice/compliance —
    competitor market_prior facts excluded). Personas must be grounded in these."""


def make_get_verified_brand_facts(label: str) -> ToolDef:
    def get_verified_brand_facts(args: GetVerifiedBrandFactsInput) -> str:
        facts = [f for f in runstate.verified_facts() if f["section"] != "market_prior"]
        return _result({"verified": facts})

    return (GetVerifiedBrandFactsInput, get_verified_brand_facts)


# ---------------------------------------------------------------------------
# Persona tools (Personasmith, Conductor)
# ---------------------------------------------------------------------------


class PersonaIn(BaseModel):
    name: str
    summary: str
    pains: JsonList[str]
    desires: JsonList[str]
    objections: JsonList[str]
    fact_ids: JsonList[str] = Field(description="Verified fact ids that ground this persona")


class StagePersonasInput(BaseModel):
    """Store exactly 3 buyer personas grounded in verified facts. Unknown
    fact_ids are silently dropped; at most 3 personas are kept."""

    personas: JsonList[PersonaIn]


def make_stage_personas(label: str) -> ToolDef:
    def stage_personas(args: StagePersonasInput) -> str:
        valid_ids = {f["id"] for f in runstate.verified_facts() if f["section"] != "market_prior"}
        stored = runstate.set_personas(
            [
                {
                    "name": p.name,
                    "summary": p.summary,
                    "pains": p.pains,
                    "desires": p.desires,
                    "objections": p.objections,
                    "factIds": [i for i in p.fact_ids if i in valid_ids],
                }
                for p in args.personas
            ]
        )
        for p in stored:
            _mirror(label, f"Persona: {p['name']} — {p['summary']}")
        return _result({"stored": [{"id": p["id"], "name": p["name"], "factIds": p["factIds"]} for p in stored]})

    return (StagePersonasInput, stage_personas)


class GetPersonasInput(BaseModel):
    """List the staged buyer personas for this run."""


def make_get_personas(label: str) -> ToolDef:
    def get_personas(args: GetPersonasInput) -> str:
        return _result({"personas": runstate.personas()})

    return (GetPersonasInput, get_personas)


# ---------------------------------------------------------------------------
# Publish tools (Conductor)
# ---------------------------------------------------------------------------


def build_publish_payload(state: runstate.State) -> list[dict[str, Any]]:
    """The exact Fact[] shape the legacy worker POSTed (src/agents/swarm.ts):
    verified facts plus personas as persona-section facts."""
    brand_id = state["brandId"]
    facts = [
        {
            "id": f["id"],
            "brandId": brand_id,
            "section": f["section"],
            "statement": f["statement"],
            "sourceUrl": f["sourceUrl"],
            "sourceQuote": f["sourceQuote"],
            "confidence": f["confidence"],
            "origin": "research",
        }
        for f in state["verified"]
    ]
    persona_facts = [
        {
            "id": f"f-persona-{i + 1}",
            "brandId": brand_id,
            "section": "persona",
            "statement": f"{p['name']}: {p['summary']}",
            "confidence": 0.8,
            "origin": "research",
        }
        for i, p in enumerate(state["personas"])
    ]
    return facts + persona_facts


def governance_check(state: runstate.State) -> str | None:
    """Mechanical publish gate. Returns a denial reason, or None to approve."""
    verified = state["verified"]
    if len(verified) < MIN_FACTS:
        return f"only {len(verified)} verified facts (need ≥{MIN_FACTS})"
    avg = sum(f["confidence"] for f in verified) / len(verified)
    if avg < MIN_AVG_CONFIDENCE:
        return f"average confidence {avg:.2f} below {MIN_AVG_CONFIDENCE}"
    return None


class PublishFactsInput(BaseModel):
    """Governance-gate the run and publish verified facts + personas into the
    SwarmAds app. Denies mechanically if there are <3 verified facts or average
    confidence <0.5. Call once, at the end of the run."""


def make_publish_facts(label: str) -> ToolDef:
    def publish_facts(args: PublishFactsInput) -> str:
        state = runstate.load()
        if state is None:
            return _result({"ok": False, "error": "no active run"})
        reason = governance_check(state)
        if reason is not None:
            _mirror(label, f"Research publish DENIED: {reason}.", status="failed")
            return _result({"ok": False, "denied": reason})
        payload = build_publish_payload(state)
        ingest = _http_post_json(f"{state['appBase']}/api/brands/{state['brandId']}/facts", payload)
        if ingest is None:
            _mirror(label, "Publishing facts to the app failed (POST /facts).", status="failed")
            return _result({"ok": False, "error": "POST /facts failed — is the app running?"})
        _mirror(
            label,
            f"Research complete: {ingest.get('accepted')} facts ingested (context v{ingest.get('version')}).",
            status="done",
            extra={
                "facts": len(state["verified"]),
                "personas": len(state["personas"]),
                "version": ingest.get("version"),
                "hash": ingest.get("hash"),
                "mode": "band-swarm",
            },
        )
        return _result({"ok": True, **{k: ingest.get(k) for k in ("accepted", "dropped", "version", "hash")}})

    return (PublishFactsInput, publish_facts)


class PublishDenialInput(BaseModel):
    """Record that governance denied the publish (too few verified facts /
    low confidence) and end the run without publishing."""

    reason: str


def make_publish_denial(label: str) -> ToolDef:
    def publish_denial(args: PublishDenialInput) -> str:
        _mirror(label, f"Research publish DENIED: {args.reason}.", status="failed")
        return _result({"ok": True, "denied": args.reason})

    return (PublishDenialInput, publish_denial)


# ---------------------------------------------------------------------------
# Role toolsets
# ---------------------------------------------------------------------------

_FACTORIES: dict[str, list[Callable[[str], ToolDef]]] = {
    "conductor": [make_get_verified_facts, make_get_personas, make_publish_facts, make_publish_denial],
    "cartographer": [make_fetch_page, make_extract_links],
    "scout": [make_fetch_page, make_list_pages],
    "analyst": [make_list_pages, make_read_page, make_stage_facts],
    "critic": [
        make_get_staged_facts,
        make_verify_quote,
        make_record_verdicts,
        make_get_verified_facts,
        make_mark_stream_settled,
    ],
    "personasmith": [make_get_verified_brand_facts, make_stage_personas],
    "competitor": [
        make_fetch_page,
        make_list_pages,
        make_read_page,
        make_stage_competitor_facts,
        make_mark_stream_settled,
    ],
}


def toolset(role: str, label: str) -> list[ToolDef]:
    return [factory(label) for factory in _FACTORIES[role]]
