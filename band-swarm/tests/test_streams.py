import json

import pytest

from band_swarm import runstate, tools


@pytest.fixture()
def run(tmp_path, monkeypatch):
    monkeypatch.setattr(runstate, "RUNS_DIR", tmp_path)
    monkeypatch.setattr(runstate, "STATE_PATH", tmp_path / "current.json")
    monkeypatch.setattr(tools, "_http_post_json", lambda url, body: {"ok": True})
    runstate.init_run("brand-x", "https://x.com", "http://app.test")
    runstate.add_page("https://x.com/about", "About", "13g protein and 0g sugar. Loved by families.", [])
    runstate.add_page("https://rival.com", "Rival", "Rival cereal is packed with caffeine and zero sugar.", [])
    return None


def call(tool_def, **kwargs) -> dict:
    model, fn = tool_def
    return json.loads(fn(model(**kwargs)))


def brand_fact(quote="13g protein", statement="High protein"):
    return {
        "section": "value_prop",
        "statement": statement,
        "source_url": "https://x.com/about",
        "source_quote": quote,
        "confidence": 0.9,
    }


def competitor_fact(quote="packed with caffeine", statement="leads with caffeine"):
    return {
        "competitor": "Rival",
        "statement": statement,
        "source_url": "https://rival.com",
        "source_quote": quote,
        "confidence": 0.7,
    }


def test_competitor_staging_forces_market_prior_prefix_and_stream(run):
    staged = call(tools.make_stage_competitor_facts("Competitor"), facts=[competitor_fact()])
    assert staged["staged_ids"] == ["f1"]
    fact = runstate.staged_facts()[0]
    assert fact["section"] == "market_prior"
    assert fact["statement"].startswith("Competitor (Rival): ")
    assert fact["stream"] == "competitor"
    assert runstate.load()["streams"]["competitor"] == "staged"


def test_parallel_streams_settle_independently(run):
    call(tools.make_stage_facts("Analyst"), facts=[brand_fact()])
    call(tools.make_stage_competitor_facts("Competitor"), facts=[competitor_fact()])
    verdicts = tools.make_record_verdicts("Critic")

    out = call(verdicts, verdicts=[{"fact_id": "f1", "verdict": "approve"}])
    assert out["streams"] == {"brand": "settled", "competitor": "staged"}

    out = call(verdicts, verdicts=[{"fact_id": "f2", "verdict": "approve"}])
    assert out["streams"] == {"brand": "settled", "competitor": "settled"}
    assert out["verified_total"] == 2


def test_competitor_cap_one_revision_then_final(run):
    stage = tools.make_stage_competitor_facts("Competitor")
    verdicts = tools.make_record_verdicts("Critic")

    call(stage, facts=[competitor_fact(quote="made up quote")])
    out = call(verdicts, verdicts=[{"fact_id": "f1", "verdict": "reject", "reason": "not verbatim"}])
    assert out["rounds"]["competitor"] == 1
    assert out["revision_allowed"]["competitor"] is True  # one revision allowed
    assert out["streams"]["competitor"] == "staged"  # awaiting revision

    call(stage, facts=[competitor_fact(quote="still fabricated")])
    out = call(verdicts, verdicts=[{"fact_id": "f2", "verdict": "reject", "reason": "still not verbatim"}])
    assert out["rounds"]["competitor"] == 2
    assert out["revision_allowed"]["competitor"] is False  # past cap → final
    assert out["streams"]["competitor"] == "settled"


def test_brand_cap_two_revisions(run):
    stage = tools.make_stage_facts("Analyst")
    verdicts = tools.make_record_verdicts("Critic")
    for expected_round, allowed in ((1, True), (2, True), (3, False)):
        call(stage, facts=[brand_fact(quote=f"bogus {expected_round}")])
        out = call(verdicts, verdicts=[{"fact_id": f"f{expected_round}", "verdict": "reject", "reason": "no"}])
        assert out["rounds"]["brand"] == expected_round
        assert out["revision_allowed"]["brand"] is allowed
    assert out["streams"]["brand"] == "settled"


def test_cap_spent_drops_leftover_staged(run):
    stage = tools.make_stage_competitor_facts("Competitor")
    verdicts = tools.make_record_verdicts("Critic")
    call(stage, facts=[competitor_fact()])
    call(verdicts, verdicts=[{"fact_id": "f1", "verdict": "reject", "reason": "r1"}])
    # revision restages TWO facts; the Critic only verdicts one, rejecting past cap
    call(stage, facts=[competitor_fact(), competitor_fact(statement="second")])
    out = call(verdicts, verdicts=[{"fact_id": "f2", "verdict": "reject", "reason": "r2"}])
    # f3 was still staged when the cap spent — dropped mechanically
    assert out["still_staged"] == 0
    assert out["streams"]["competitor"] == "settled"
    reasons = {f["id"]: f["reason"] for f in runstate.load()["rejected"]}
    assert reasons["f3"] == "revision round cap reached"


def test_mark_stream_settled_and_late_staging_rejected(run):
    out = call(tools.make_mark_stream_settled("Competitor"), stream="competitor", reason="no competitors found")
    assert out["streams"]["competitor"] == "settled"
    late = call(tools.make_stage_competitor_facts("Competitor"), facts=[competitor_fact()])
    assert late["ok"] is False and "settled" in late["error"]


def test_personasmith_sees_only_brand_facts(run):
    call(tools.make_stage_facts("Analyst"), facts=[brand_fact()])
    call(tools.make_stage_competitor_facts("Competitor"), facts=[competitor_fact()])
    call(
        tools.make_record_verdicts("Critic"),
        verdicts=[{"fact_id": "f1", "verdict": "approve"}, {"fact_id": "f2", "verdict": "approve"}],
    )
    brand_view = call(tools.make_get_verified_brand_facts("Personasmith"))
    assert [f["id"] for f in brand_view["verified"]] == ["f1"]
    all_view = call(tools.make_get_verified_facts("Conductor"))
    assert [f["id"] for f in all_view["verified"]] == ["f1", "f2"]

    stored = call(
        tools.make_stage_personas("Personasmith"),
        personas=[
            {
                "name": "P",
                "summary": "s",
                "pains": [],
                "desires": [],
                "objections": [],
                "fact_ids": ["f1", "f2"],  # f2 is market_prior → dropped
            }
        ],
    )
    assert stored["stored"][0]["factIds"] == ["f1"]


def test_publish_payload_includes_market_prior(run):
    call(tools.make_stage_facts("Analyst"), facts=[brand_fact()])
    call(tools.make_stage_competitor_facts("Competitor"), facts=[competitor_fact()])
    call(
        tools.make_record_verdicts("Critic"),
        verdicts=[{"fact_id": "f1", "verdict": "approve"}, {"fact_id": "f2", "verdict": "approve"}],
    )
    payload = tools.build_publish_payload(runstate.load())
    sections = {f["id"]: f["section"] for f in payload}
    assert sections["f2"] == "market_prior"
