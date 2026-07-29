# band-swarm — seven real Band agents doing brand research

The live Band integration for SwarmAds: seven remote agents on
[Band](https://app.band.ai) — **Conductor, Cartographer, Scout, Analyst,
Critic, Personasmith, Competitor** — each with its own Band identity and
Claude brain, conversing in one room via @mentions. Two branches run in
parallel and converge at the Critic: the brand branch (Scout → Analyst) and
the competitor branch (the Competitor names 2-3 rival brands from its own
knowledge, scrapes their sites, and stages `market_prior` insights). The
Critic adversarially verifies every fact's quote against the fetched page and
rejects bad ones back to their author (brand: 2 revision rounds; competitor:
1). Agents narrate their reasoning as mention-free `thought` events, and the
run ends with the Conductor reporting RUN COMPLETE to the human owner. The
Conductor governance-gates the run and publishes verified facts + personas
into the app's existing `/facts` + `/events` contract (docs/INTEGRATION.md),
so the `/research` feed and the rest of the loop (generate → simulate →
learn) work unchanged.

**Talk to the swarm**: kickoff adds you (the Band account owner) to the room —
open `swarm:<brandId>` at app.band.ai mid-run and @mention any agent ("why did
you reject f4?"); it answers you directly without disturbing the pipeline.

Replaces the legacy single-identity TS client (`src/agents/swarm.ts`,
`src/lib/adapters/real/band.ts`), which had no inbound path — Band peers got
mentioned but nothing ever listened. Here every agent holds its own WebSocket
and wakes when mentioned.

## Setup (once)

1. Sign in at [app.band.ai](https://app.band.ai) and create **six remote
   agents** ([guide](https://docs.band.ai/getting-started/connect-remote-agent)):
   - `Conductor` — coordinates the brand-research swarm and publishes verified results
   - `Cartographer` — plans which brand pages to crawl
   - `Scout` — fetches and cleans brand web pages
   - `Analyst` — extracts brand facts with verbatim source quotes
   - `Critic` — adversarially verifies every quoted fact
   - `Personasmith` — synthesizes buyer personas from verified facts
2. `cp .env.example .env` and fill in each agent's **UUID + API key** plus an
   **ANTHROPIC_API_KEY** (the agents' LLM brain).
3. `uv sync`

## Run

```bash
# terminal 1 — the six agents (leave running; Ctrl-C is the emergency stop)
uv run python run_swarm.py            # or --only scout for a smoke test

# terminal 2 — the app
npm run dev                            # port 3002; USE_REAL_BAND=1 in .env.local

# start a research run — either click Research in the app, or by hand:
uv run python kickoff.py brand-magicspoon-com https://magicspoon.com
```

Watch the conversation live in the Band dashboard (room `swarm:<brandId>`;
tool calls stream as execution telemetry) and in the app's `/research` feed
(mirrored deterministically from every tool call). `BAND_ROOM_ID` in `.env`
pins the run to a specific chat UUID instead.

## Layout

- `run_swarm.py` — starts all six agents in one asyncio process
- `kickoff.py` — resolves/creates the room, adds participants, posts the
  kickoff mention as the Conductor, waits for facts to land in the app
- `band_swarm/prompts.py` — the conversation protocol + anti-loop rules
- `band_swarm/tools.py` — per-role custom tools; every call mirrors an event
  into the app; `publish_facts` carries the governance gate (≥3 verified
  facts, avg confidence ≥0.5)
- `band_swarm/scraping.py` — Python port of the TS scout (fetch, readability,
  link ranking); quote verification runs against this text only
- `band_swarm/runstate.py` — shared on-disk run-state (`.runs/current.json`);
  quotes travel between agents through tools, never re-typed through chat

`uv run python -m pytest tests -q` runs the unit tests.
