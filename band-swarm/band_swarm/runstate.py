"""On-disk run-state shared by all six agents (band-swarm/.runs/current.json).

Structured data — cached page text, staged/verified facts, verdicts, personas —
travels between agents through this file via their tools, never re-typed
through chat, so source quotes stay byte-exact for verbatim verification.
All agents run in one asyncio process and tool callables are synchronous, so
plain load-modify-save is race-free.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .scraping import _normalized_key

RUNS_DIR = Path(__file__).resolve().parent.parent / ".runs"
STATE_PATH = RUNS_DIR / "current.json"

# Max rejection batches the Critic may send back for revision, per stream.
# Rejections beyond the cap are final and settle the stream.
ROUND_CAPS = {"brand": 2, "competitor": 1}

State = dict[str, Any]


def init_run(brand_id: str, brand_url: str, app_base: str) -> State:
    state: State = {
        "brandId": brand_id,
        "brandUrl": brand_url,
        "appBase": app_base,
        "pages": {},
        "factSeq": 0,
        "staged": [],
        "verified": [],
        "rejected": [],
        "streams": {stream: "pending" for stream in ROUND_CAPS},  # pending|staged|settled
        "rounds": {stream: 0 for stream in ROUND_CAPS},
        "settleReasons": {},
        "personas": [],
    }
    save(state)
    return state


def load() -> State | None:
    try:
        return json.loads(STATE_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def save(state: State) -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2))


def add_page(url: str, title: str, text: str, links: list[str]) -> None:
    state = load()
    if state is None:
        return
    state["pages"][url] = {"title": title, "text": text, "links": links}
    save(state)


def get_page(url: str) -> dict[str, Any] | None:
    state = load()
    if state is None:
        return None
    page = state["pages"].get(url)
    if page is not None:
        return page
    # tolerate trailing-slash / fragment variance between what was fetched
    # and what the model echoes back
    try:
        key = _normalized_key(url)
        for cached_url, cached in state["pages"].items():
            if _normalized_key(cached_url) == key:
                return cached
    except ValueError:
        pass
    return None


def pages_summary() -> list[dict[str, Any]]:
    state = load()
    if state is None:
        return []
    return [
        {"url": url, "title": page["title"], "chars": len(page["text"])}
        for url, page in state["pages"].items()
    ]


def stage_facts(items: list[dict[str, Any]], stream: str) -> list[dict[str, Any]] | None:
    """Assign ids f1…fN (monotonic across revision rounds), tag with the stream,
    and stage for review. Returns None if the stream already settled (a zombie
    branch can't reopen a closing run)."""
    state = load()
    if state is None:
        return []
    if state["streams"].get(stream) == "settled":
        return None
    staged = []
    for item in items:
        state["factSeq"] += 1
        fact = {"id": f"f{state['factSeq']}", "stream": stream, **item}
        state["staged"].append(fact)
        staged.append(fact)
    if staged:
        state["streams"][stream] = "staged"
    save(state)
    return staged


def staged_facts() -> list[dict[str, Any]]:
    state = load()
    return list(state["staged"]) if state else []


def apply_verdicts(verdicts: list[dict[str, Any]]) -> dict[str, Any]:
    """Move staged facts to verified/rejected, advance per-stream rounds, and
    recompute stream settlement. A stream settles when nothing of it remains
    staged AND (this call rejected nothing from it, or its round cap is spent —
    rejections past the cap are final; leftovers past the cap are dropped)."""
    state = load()
    if state is None:
        return {"error": "no active run"}
    by_id = {f["id"]: f for f in state["staged"]}
    approved, rejected, unknown = [], [], []
    touched: set[str] = set()
    rejected_by_stream: dict[str, list[str]] = {}
    for v in verdicts:
        fact = by_id.get(v.get("fact_id", ""))
        if fact is None:
            unknown.append(v.get("fact_id", "?"))
            continue
        state["staged"].remove(fact)
        del by_id[fact["id"]]
        stream = fact.get("stream", "brand")
        touched.add(stream)
        if v.get("verdict") == "approve":
            state["verified"].append(fact)
            approved.append(fact)
        else:
            state["rejected"].append({**fact, "reason": v.get("reason") or "rejected"})
            rejected.append(fact)
            rejected_by_stream.setdefault(stream, []).append(fact["id"])

    revision_allowed: dict[str, bool] = {}
    for stream in rejected_by_stream:
        state["rounds"][stream] = state["rounds"].get(stream, 0) + 1
    for stream, cap in ROUND_CAPS.items():
        rounds = state["rounds"].get(stream, 0)
        if rounds > cap:
            # cap spent — drop whatever is still staged for this stream
            leftovers = [f for f in state["staged"] if f.get("stream", "brand") == stream]
            for f in leftovers:
                state["staged"].remove(f)
                state["rejected"].append({**f, "reason": "revision round cap reached"})
        if stream in rejected_by_stream:
            revision_allowed[stream] = rounds <= cap
        if state["streams"].get(stream) == "settled" or stream not in touched:
            continue
        still_staged = any(f.get("stream", "brand") == stream for f in state["staged"])
        if not still_staged and (stream not in rejected_by_stream or rounds > cap):
            state["streams"][stream] = "settled"
    save(state)
    return {
        "approved": approved,
        "rejected": rejected,
        "unknown_ids": unknown,
        "round": state["rounds"].get("brand", 0),
        "rounds": dict(state["rounds"]),
        "streams": dict(state["streams"]),
        "rejected_by_stream": rejected_by_stream,
        "revision_allowed": revision_allowed,
        "verified_total": len(state["verified"]),
        "still_staged": len(state["staged"]),
    }


def mark_stream_settled(stream: str, reason: str) -> dict[str, Any]:
    state = load()
    if state is None:
        return {"error": "no active run"}
    state["streams"][stream] = "settled"
    state["settleReasons"][stream] = reason
    save(state)
    return {"streams": dict(state["streams"]), "reason": reason}


def verified_facts() -> list[dict[str, Any]]:
    state = load()
    return list(state["verified"]) if state else []


def set_personas(personas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    state = load()
    if state is None:
        return []
    stored = [{"id": f"p{i + 1}", **p} for i, p in enumerate(personas[:3])]
    state["personas"] = stored
    save(state)
    return stored


def personas() -> list[dict[str, Any]]:
    state = load()
    return list(state["personas"]) if state else []
