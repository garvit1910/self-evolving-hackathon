import json

import pytest

from band_swarm import runstate, tools


@pytest.fixture()
def run(tmp_path, monkeypatch):
    monkeypatch.setattr(runstate, "RUNS_DIR", tmp_path)
    monkeypatch.setattr(runstate, "STATE_PATH", tmp_path / "current.json")
    posts = []
    monkeypatch.setattr(tools, "_http_post_json", lambda url, body: posts.append((url, body)) or {
        "accepted": 99, "dropped": 0, "version": 7, "hash": "abc123"
    })
    runstate.init_run("brand-x", "https://x.com", "http://app.test")
    runstate.add_page(
        "https://x.com/about",
        "About",
        "Our cereal has 13g protein and\n0g sugar per bowl. Loved by families.",
        [],
    )
    return posts


def call(tool_def, **kwargs) -> dict:
    model, fn = tool_def
    return json.loads(fn(model(**kwargs)))


def test_stage_verify_verdict_cycle(run):
    stage = tools.make_stage_facts("Analyst")
    staged = call(
        stage,
        facts=[
            {
                "section": "value_prop",
                "statement": "High protein, no sugar",
                "source_url": "https://x.com/about",
                "source_quote": "13G  Protein and 0g sugar",  # case/whitespace differs, still verbatim after normalize
                "confidence": 0.9,
            },
            {
                "section": "voice",
                "statement": "Fabricated claim",
                "source_url": "https://x.com/about",
                "source_quote": "the best cereal in the universe",
                "confidence": 0.8,
            },
        ],
    )
    assert staged["staged_ids"] == ["f1", "f2"]

    verify = tools.make_verify_quote("Critic")
    good = call(verify, source_url="https://x.com/about", quote="13G  Protein and 0g sugar")
    assert good["verified"] is True and "13g protein" in good["context"]
    # trailing-slash URL variance tolerated
    good_slash = call(verify, source_url="https://x.com/about/", quote="13g protein")
    assert good_slash["verified"] is True
    bad = call(verify, source_url="https://x.com/about", quote="the best cereal in the universe")
    assert bad["verified"] is False and bad["closest_fragment"]

    verdicts = tools.make_record_verdicts("Critic")
    outcome = call(
        verdicts,
        verdicts=[
            {"fact_id": "f1", "verdict": "approve"},
            {"fact_id": "f2", "verdict": "reject", "reason": "not verbatim"},
            {"fact_id": "f9", "verdict": "approve"},
        ],
    )
    assert outcome["approved_ids"] == ["f1"]
    assert outcome["rejected_ids"] == ["f2"]
    assert outcome["unknown_ids"] == ["f9"]
    assert outcome["round"] == 1 and outcome["verified_total"] == 1

    # replacements get fresh ids; a clean round does not advance the counter
    staged2 = call(
        stage,
        facts=[
            {
                "section": "voice",
                "statement": "Family-loved tone",
                "source_url": "https://x.com/about",
                "source_quote": "Loved by families",
                "confidence": 0.7,
            }
        ],
    )
    assert staged2["staged_ids"] == ["f3"]
    outcome2 = call(verdicts, verdicts=[{"fact_id": "f3", "verdict": "approve"}])
    assert outcome2["round"] == 1 and outcome2["verified_total"] == 2


def test_personas_and_publish_payload(run):
    call(
        tools.make_stage_facts("Analyst"),
        facts=[
            {
                "section": "value_prop",
                "statement": f"Fact {i}",
                "source_url": "https://x.com/about",
                "source_quote": "13g protein",
                "confidence": 0.9,
            }
            for i in range(3)
        ],
    )
    call(
        tools.make_record_verdicts("Critic"),
        verdicts=[{"fact_id": f"f{i}", "verdict": "approve"} for i in (1, 2, 3)],
    )
    stored = call(
        tools.make_stage_personas("Personasmith"),
        personas=[
            {
                "name": f"Persona {i}",
                "summary": "Busy parent",
                "pains": ["sugar"],
                "desires": ["protein"],
                "objections": ["price"],
                "fact_ids": ["f1", "f-bogus"],
            }
            for i in range(4)  # 4 in, only 3 kept
        ],
    )
    assert len(stored["stored"]) == 3
    assert stored["stored"][0]["factIds"] == ["f1"]  # bogus id dropped

    state = runstate.load()
    payload = tools.build_publish_payload(state)
    assert len(payload) == 6  # 3 facts + 3 persona facts
    fact = payload[0]
    assert fact["brandId"] == "brand-x" and fact["origin"] == "research"
    persona_fact = payload[3]
    assert persona_fact["id"] == "f-persona-1"
    assert persona_fact["section"] == "persona"
    assert persona_fact["statement"].startswith("Persona 0: ")
    assert persona_fact["confidence"] == 0.8

    posts_before = len(run)
    result = call(tools.make_publish_facts("Conductor"))
    assert result["ok"] is True and result["version"] == 7
    facts_posts = [(u, b) for u, b in run[posts_before:] if u.endswith("/facts")]
    assert len(facts_posts) == 1
    assert facts_posts[0][0] == "http://app.test/api/brands/brand-x/facts"
    done_events = [
        b for u, b in run if u.endswith("/events") and b.get("status") == "done"
    ]
    assert done_events and done_events[0]["payload"]["mode"] == "band-swarm"


def test_json_string_lists_are_coerced(run):
    # Claude sometimes sends nested lists as JSON-encoded strings
    stage = tools.make_stage_facts("Analyst")
    model, _ = stage
    parsed = model(
        facts=json.dumps(
            [
                {
                    "section": "voice",
                    "statement": "s",
                    "source_url": "https://x.com/about",
                    "source_quote": "Loved by families",
                    "confidence": 0.5,
                }
            ]
        )
    )
    assert parsed.facts[0].section == "voice"


def test_governance_denies_thin_runs(run):
    assert tools.governance_check(runstate.load()) is not None  # zero verified facts
    result = call(tools.make_publish_facts("Conductor"))
    assert result["ok"] is False and "denied" in result
    failed = [b for _, b in run if b.get("status") == "failed"]
    assert failed and "DENIED" in failed[0]["payload"]["message"]
