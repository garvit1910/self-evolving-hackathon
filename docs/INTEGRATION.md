# Track A Integration Guide

The HTTP contract between the app (Track G) and the research swarm / sponsor
integrations (Track A). Everything the UI renders flows through these routes —
the research feed and context views render identically whether data arrives
from the interim researcher or the real Band swarm.

Base URL (dev): `http://localhost:3002`

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | Master switch for live mode: image gen, embeddings, default LLM key |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | **Pioneer plug point** — repoint at the gateway, nothing else changes |
| `LLM_API_KEY` | falls back to `OPENAI_API_KEY` | Gateway auth |
| `LLM_MODEL` | `gpt-4o-mini` | Copy / panel / research model |
| `GEMINI_API_KEY` | — | **Primary image provider** when set (needs a billed key — image models have zero free-tier quota). Per-candidate chain: Gemini → OpenAI → SVG |
| `GEMINI_IMAGE_MODEL` | `gemini-3.1-flash-image` | Gemini image model |
| `IMAGE_QUALITY` | `low` | gpt-image quality (low/medium/high) — OpenAI path only |
| `IMAGE_MODEL` | `gpt-image-1` | OpenAI image model (backup provider in the chain); auto-downgrades to `gpt-image-1-mini` when the org lacks access |
| `SENSO_API_KEY` | — | Declared by `SensoContextStore` stub (TODO(track-a)) |
| `ACTIAN_URL` | — | Declared by `ActianVectorStore` stub (TODO(track-a)) |
| `DATA_DIR` | `<cwd>/.data` | Server store root override (tests) |

## Sponsor seams (code-level)

- **Senso** → implement `SensoContextStore` in `src/lib/context.ts`
  (`ingestFacts`, `search`, `writeBackLearnings`, `getVersion`), then flip
  `getContextStore()` to return it. The local default (`LocalContextStore`)
  defines the behavior contract: hash = sha256 of canonically-sorted facts
  JSON (16 hex), version bumps whenever facts change.
- **Actian** → implement `ActianVectorStore` in `src/lib/vector.ts`
  (`upsert(chunks)`, `query(text, k)`), then flip `getVectorStore()`.
- **Pioneer** → no code: set `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`. The
  client (`src/lib/llm.ts`) speaks OpenAI-compatible chat completions.
- **Band swarm** → implemented in `band-swarm/` (six real Band agents; see
  band-swarm/README.md). It replaces the interim researcher by POSTing the
  same routes it uses: `/facts` for verified facts (Conductor's publish_facts
  tool), `/events` for feed progress (mirrored from every agent tool call).
  After a real Senso write, call `POST /api/learnings/:id/ingested`.

## Routes

### POST /api/brands — create/onboard a brand
Multipart form: `url` (required), `name?`, `productImage?` (PNG/JPG file — the
product photo real image generation composites into ads). Sets the app-level
brand cookie. Re-posting the same URL is idempotent (keeps facts/context).

```bash
curl -s -X POST http://localhost:3002/api/brands \
  -F url=https://magicspoon.com -F name="Magic Spoon" \
  -F productImage=@product.png
# → 201 {"brandId":"brand-magicspoon-com","brand":{...}}
```

### POST /api/brands/:id/facts — ingest research facts
Body: `Fact[]` or `{facts: Fact[]}`. Each fact: `{id?, section, statement,
sourceUrl?, sourceQuote?, confidence, origin?}` with `section` ∈ positioning |
value_prop | voice | compliance | persona | market_prior and `origin` ∈
research (default) | performance_loop. `brandId` is forced to the route's
brand. Malformed items are dropped (counted), valid ones persist + index.

```bash
curl -s -X POST http://localhost:3002/api/brands/brand-magicspoon-com/facts \
  -H 'content-type: application/json' \
  -d '[{"section":"value_prop","statement":"13g protein, 0g sugar per bowl","sourceUrl":"https://magicspoon.com","sourceQuote":"13g protein","confidence":0.95}]'
# → {"accepted":1,"dropped":0,"version":1,"hash":"9f2c..."}
```

### GET /api/brands/:id/context — context snapshot
```bash
curl -s http://localhost:3002/api/brands/brand-magicspoon-com/context
# → {"brandId":"...","version":1,"hash":"9f2c...","facts":[...]}
```

### POST /api/brands/:id/events — emit autopilot/feed events
Body: one `AutopilotEvent` or an array. `{step, status, payload?, ts?}` with
`step` ∈ research|context|generate|simulate|learn|writeback|regenerate|verdict,
`status` ∈ running|done|failed. `ts` defaults to server time. The research
feed shows `payload.agent` / `payload.message` / `payload.factId`.

```bash
curl -s -X POST http://localhost:3002/api/brands/brand-magicspoon-com/events \
  -H 'content-type: application/json' \
  -d '{"step":"research","status":"running","payload":{"agent":"Scout","message":"crawling homepage"}}'
```

### GET /api/brands/:id/events?since=ts — poll events
Returns events with `ts` strictly greater than `since` (omit for all).
```bash
curl -s 'http://localhost:3002/api/brands/brand-magicspoon-com/events?since=0'
```

### POST /api/brands/:id/generate — generate a creative batch
Body: `{generation: 1|2, priors?: {angle,persona,hook,style}, count?, runId?}`.
`count` clamps to 4–6 (default 6 for gen-1, 4 for gen-2). `priors.angle` is
inserted into briefs VERBATIM (attribution key). Pipeline: facts → deterministic
briefs → copy via LLM (mock fallback) → images via gpt-image edits with the
uploaded product photo (per-candidate SVG fallback, ≤6 real images/call) →
persisted creatives (genome stamped, arm {α:1,β:1,pulls:0}) → panel scores.
Returns `{creatives, briefs, panelScores, mode: {copy: 'live'|'mock', image:
'openai'|'svg'|'mixed'}}`. Briefs carry contextVersion/contextHash + priorSource
('sampled' | 'competitive_fact' | 'default_rotation') provenance.

```bash
curl -s -X POST http://localhost:3002/api/brands/brand-magicspoon-com/generate \
  -H 'content-type: application/json' \
  -d '{"generation":1,"count":4}'
```

### POST /api/panel — persona panel scores
Body: `{brandId, creativeIds?}`. Scores every persona (from persona-section
facts) × creative pair 0–100 with a one-line reason; persists them. Returns
`{scores: PanelScore[], mode: 'live'|'mock'}` — 'mock' is the deterministic
hash+affinity fallback.

```bash
curl -s -X POST http://localhost:3002/api/panel \
  -H 'content-type: application/json' -d '{"brandId":"brand-magicspoon-com"}'
```

### POST /api/learnings/:id/ingested — mark Senso write-back done
Body: `{brandId?}` (scans all brands when omitted). Sets `sensoIngested: true`
on the learning — flips the “pending write-back” badge on /learnings.
```bash
curl -s -X POST http://localhost:3002/api/learnings/learning-angle-nostalgia-reboot/ingested \
  -H 'content-type: application/json' -d '{"brandId":"brand-magicspoon-com"}'
```

### GET /api/files/... — serve stored binaries
Uploaded product photos (`/api/files/uploads/<brandId>/<file>`) and generated
creatives (`/api/files/creatives/<brandId>/<file>`).

### Internal routes (used by the app’s own client; stable but not the swarm contract)
- `GET /api/mode` → `{mode: 'live'|'offline'}` (key presence)
- `POST /api/active-brand` `{brandId|null}` → switch app brand / back to fixture demo
- `GET /api/brands/:id` → `{brand}`
- `GET /api/brands/:id/state` → `{creatives, metrics, learnings, panelScores}`
- `POST /api/brands/:id/metrics` `DailyMetrics[]` → live-sim persistence
- `POST /api/brands/:id/learnings` `Learning[]` → upsert
- `POST /api/brands/:id/writeback` `{learningIds?}` → learnings → performance_loop facts, `{version, hash, factIds}`
- `POST /api/brands/:id/research` `{}` → with `USE_REAL_BAND=1`, kicks off the
  six-agent Band swarm (`band-swarm/kickoff.py`; agents must be running via
  `run_swarm.py`) and waits for facts to land; otherwise (or on any swarm
  failure) runs the interim researcher (homepage + ≤2 same-origin pages → one
  LLM extraction → mechanical sourceQuote verification, fabricated quotes
  dropped) → `{factCount, droppedQuotes, mode}`. When facts already exist,
  Autopilot skips this route automatically.
