# WIRING.md — Track G × Track A reconciliation decisions

One line per decision. "G" = main's spine (Track G), "A" = PR #1's creative
engine (Track A, branch `creative-engine-phase2`, merged in `cf644cb`).

## Single generation pipeline

- `POST /api/brands/:id/generate` stays the HTTP surface; its implementation is
  A's engine: `expandGenomes → copywriter → complianceGate (drop/repair) →
  governance → images`, orchestrated by `runCreativeEngine`, fed by G's
  retrieval (`ContextStore.search` + facts) and priors.
- G's `composeBriefs` survives as the deterministic lead-brief composer; A's
  `src/lib/brief/composeBrief.ts` is DELETED (dead twin). The lead brief gains
  optional `hooks[]` (pool from G's hook templates) + `compliance[]` (compliance
  facts) consumed by the engine.
- Per-survivor `Brief` records are synthesized from genomes (axes byte-equal)
  and persisted via G's `LocalStore`, keeping briefs 1:1 with creatives,
  `publishedAdId = ad-<id>`, ids `<runId>-c<n>` contiguous.
- GOVERNANCE IS IN THE LIVE PATH: every engine feed post is mirrored into
  `AutopilotEvent`s (step `generate`) by a TeeFeed bridge — drops, repairs, and
  publish-deny are visible in the feed with `agent: 'Governance'`.
- Engine persistence seam (`CreativeStore.saveRun`) is bypassed in-app
  (`persist:false`); G's `LocalStore` is the storage authority. `creativeStore`
  remains ONLY for the standalone engine scripts (`npm run test:creative`).

## Genome compatibility

- `src/lib/contracts.ts` is the single type authority. A's
  `src/lib/contracts/index.ts` is DELETED; its `Persona`, `Prior`, and
  `FactSection` types move into contracts.ts; `Brief` gains optional
  `hooks?: string[]` and `compliance?: string[]` (deliberate reconciliation).
- `src/lib/brief/axes.ts` becomes the ONE vocabulary source holding G's strings
  (`problem-solution`, `social-proof`, `feature-flex`, `lifestyle-aspiration`;
  `retro-cartoon`, `clean-clinical`) — G's fixtures/livesim/learnings were built
  on these attribution keys, so A's axes values are replaced, not merged.
  `compose.ts` imports from axes.ts (local copies removed).
- Gen-2 priors: a prior-carrying ANGLE axis collapses to `[prior]` (every
  creative rides the winner verbatim — pinned by `tests/api-generate.test.ts`);
  persona/hook/style priors LEAD their axes (creative 1 gets them verbatim,
  rest explore). A's `narrow()` (winner+1) is replaced by this rule.

## Image provider (decision by evidence)

- PRIMARY: G's `GeminiImageGen` (`gemini-3.1-flash-image`, `x-goog-api-key`,
  product photo as `inline_data`, 4:5) — smoke-verified live in commit
  `c05edb3`. Fallback chain: OpenAI `/v1/images/edits` (also smoke-verified,
  `d2ee0c3`) → SVG. Cap 6 real images/run, one retry, pLimit(2).
- A's `adapters/real/gemini.ts` (default `gemini-2.5-flash-image`, `?key=`
  auth, UNVERIFIED) is rewritten as a thin shim over G's request shape so the
  script-side adapter set uses the verified path too.
- HARD REQUIREMENT satisfied: the uploaded product image
  (`store.productImagePathFor`) rides every live request as the reference.

## Ownership map (survivor ← deleted/demoted)

- contracts: `src/lib/contracts.ts` ← `src/lib/contracts/index.ts` (deleted).
- brief composer: `src/lib/creative/compose.ts` ← `src/lib/brief/composeBrief.ts` (deleted).
- axis vocabulary: `src/lib/brief/axes.ts` (values = G's) ← compose.ts local consts.
- LLM client: `src/lib/llm.ts` `HTTPLLMClient` (app path; Pioneer via env) —
  `adapters/real/pioneer.ts` stays as the script-side adapter of the same gateway.
- images: `src/lib/imagegen.ts` chain ← `adapters/real/gemini.ts` demoted to shim.
- context: `src/lib/context.ts` `SensoContextStore` (implements G's interface,
  speaks A's verified Senso REST shapes: `apiv2.senso.ai/api/v1`, `X-API-Key`,
  `POST /org/kb/raw`, `POST /org/search`); `LocalContextStore` = fallback + version/hash bookkeeping.
- vector: `src/lib/vector.ts` `MemoryVectorStore` default; `ActianVectorStore`
  implemented only if `ACTIAN_URL` is reachable (A's skeleton endpoints are
  explicitly unconfirmed — do not guess).
- agent feed: `adapters/real/band.ts` = the only Band client; TeeFeed bridge
  mirrors rooms → `POST /api/brands/:id/events` (+ `/facts`).
- research: live default = A's swarm (`scout/analyst/personasmith/researchSwarm`)
  run as a worker (`src/agents/`); G's interim researcher = kill-switch fallback.
  Both keep mechanical substring source-quote verification.
- storage: `src/lib/store.ts` `LocalStore` ← `store/creativeStore.ts` demoted to
  scripts-only.

## Kill switches (stage insurance — no code changes to flip)

Convention: `USE_REAL_<X>=1` enables a sponsor (A's `getAdapters()` convention,
already in `.env.local`); unset/`0` = kill switch → local/mock. `DISABLE_X=1`
from the session brief ≡ `USE_REAL_X=0`.

| Switch | ON | OFF (kill) |
|---|---|---|
| `USE_REAL_PIONEER` | all text LLM via `PIONEER_BASE_URL/API_KEY/MODEL` | `LLM_*`/OpenAI, else mock copy/panel |
| `USE_REAL_SENSO` | `SensoContextStore` (ingest/search/writeback) | `LocalContextStore` |
| `USE_REAL_ACTIAN` | `ActianVectorStore` @ `ACTIAN_URL` | `MemoryVectorStore` |
| `USE_REAL_BAND` | swarm posts to Band room; bridge mirrors | interim researcher, local events only |
| `USE_REAL_GEMINI` | Gemini primary in image chain | OpenAI edits → SVG |

Offline zero-env demo: all switches off + no keys → fixtures/mock/SVG — unchanged.
