# Phase 3 — Evolution Loop (Track A)

Status: approved design, not yet implemented
Date: 2026-07-24
Branch: `phase3-evolution-loop`

## Goal

Close the self-evolving loop: gen-1 performance posteriors → learnings → evolved context
(v2) → gen-2 brief → gen-2 creatives.

Covers these PROGRESS.md Phase 3 items:

- Learnings → Senso as a new source (context v2)
- Learnings embedded into Actian
- Gen-2 `composeBrief` usage (priors already supported — this supplies the caller)
- "Post persona-panel/judge verdicts back to Pioneer as feedback traffic" — **retargeted**,
  see [Pioneer's role](#pioneers-role)

## Motivating problem

Every Phase 3 item hangs off performance data — `DailyMetrics`, `DimensionPosterior`, and
the persona panel are all Track G scope, and the shared Drizzle/Supabase schema does not
exist. Track A cannot build against real posteriors today, but the entire "self-evolving"
claim is unprovable without this phase.

The resolution is a seam, mirroring the `CreativeStore` precedent from Phase 2: Track A
defines a one-method `PosteriorSource` interface with a fixture implementation, builds the
whole loop behind it, and Garvit's rollup slots in later without touching the loop.

## Architecture

New orchestrator `src/lib/agents/evolutionLoop.ts`, mirroring `researchSwarm.ts` and
`creativeEngine.ts`: adapters injected, progress posted to a Band room, governance gates the
writeback.

| Unit | File | Deps | Purpose |
|---|---|---|---|
| `PosteriorSource` | `src/lib/learning/posteriors.ts` | fs | Seam for Track G's rollup + fixture impl |
| `synthesizeLearnings` | `src/lib/learning/synthesize.ts` | `LLM` | `DimensionPosterior[]` → `Learning[]` |
| `derivePriors` | `src/lib/learning/priors.ts` | none — pure | `DimensionPosterior[]` → `Prior[]` |
| `writeBackLearnings` | `src/lib/learning/writeback.ts` | `ContextStore`, `VectorStore`, `Governance`, `Feed` | Senso ingest + Actian embed + context v2 |
| `runEvolutionLoop` | `src/lib/agents/evolutionLoop.ts` | all of the above + `creativeEngine` | Orchestrator |

### Flow

```
gen-1 Creative[]  (Phase 2 output)
        │
posteriorSource.getPosteriors(runId) ──► DimensionPosterior[]
        │
        ├─► synthesizeLearnings(posteriors, brandId, llm)   1 batched Pioneer call
        │            │
        │            └─► Learning[]  (stats mechanical, statement prose)
        │
        └─► governance.approve('context_writeback', {...})
                     │
                     ├─ denied ─► evolved: false. No writeback, no priors, no gen-2.
                     │            Veto posted to feed. STOP.
                     │
                     └─ ok ─► writeBackLearnings(...)
                                ├─► senso.writeback(markdown) ──► { sourceId, contextHash }
                                ├─► actian.upsert(learning statements)
                                └─► best-effort senso.search() ──► Fact[]
                                       └─ empty/unusable ─► local Fact[] origin:'performance_loop'
                     │
                derivePriors(posteriors) ──► Prior[]
                     │
        brand2 = { ...brand, contextVersion: 2, contextHash: v2Hash,
                   sensoSourceIds: [...brand.sensoSourceIds, newSourceId] }
                     │
        composeBrief({ runId, brand: brand2, generation: 2, facts: factsV2,
                       personas, topKChunks, priors })
                     │
        runCreativeEngine(`${runId}-g2`, brand2, brief2, personas, adapters, store, 8, priors)
                     │
                     └─► gen-2 Creative[]  (genome.generation === 2)
```

## The seam

```ts
export interface PosteriorSource {
  getPosteriors(runId: string): Promise<DimensionPosterior[]>;
}

export function createFixturePosteriorSource(path?: string): PosteriorSource;
```

Backed by `fixtures/posteriors.g1.json`, hand-authored against the Magic Spoon gen-1 axis
vocabulary. Garvit's rollup implements the same single method later.

**The invariant that keeps this honest:** every `posterior.value` must appear **verbatim**
in some gen-1 `Creative.genome`. `scripts/test-evolution-loop.ts` asserts this. A fixture
that drifts from the axis vocabulary fails the build rather than silently producing priors
for values no creative ever carried — the same class of bug the `expandGenomes`
decorrelation test exists to catch. `angle` and `persona` are attribution keys and are never
rephrased anywhere in this phase.

## The math

One piece of math, two consumers. `betaCI(α, β)` — normal approximation on the Beta
posterior, no new npm dependencies:

```
μ  = α / (α + β)
σ² = αβ / ((α + β)² (α + β + 1))
ci = μ ± 1.96σ            (clamped to [0, 1])
```

Consumers:

- `Learning.stats` — `ciLow`, `ciHigh`, `n` (= `impressions`), and `lift` (the value's μ
  against that dimension's pooled baseline μ, as a ratio).
- `derivePriors` — per dimension, the winner is the value with the highest `ciLow`;
  `Prior.weight` is that value's μ.

Ranking by the lower credible bound rather than the mean is what stops a 1-impression arm at
100% CTR from beating a 10k-impression arm at 4%: the small-n arm's `ciLow` sits near zero.
This was chosen over Thompson sampling deliberately — the golden replay demo needs
byte-identical output across runs, and a seeded Beta sampler would have to be hand-rolled
under the no-new-dependencies rule for a winner that looks arbitrary on stage.

### Thresholds

A dimension emits a learning **and** a prior only when both hold:

- `n ≥ MIN_N` (30)
- `ciLow > ` that dimension's pooled baseline μ

Below the threshold the dimension is skipped entirely. `expandGenomes` narrows per
dimension, so a missing prior means gen-2 keeps exploring that axis at full width — the
degradation is "less confident narrowing", not a collapsed axis.

## Pioneer's role

`synthesizeLearnings` computes `stats` mechanically, then makes **one batched**
`llm.extract` call to write the `Learning.statement` prose for every learning at once —
the same batching pattern as `copywriter.ts`: one tape entry, one failure mode.

Schema hint: `{ statements: { index: number, statement: string }[] }`

A missing or malformed index falls back to a deterministic template
(`"{value} {dimension} outperformed baseline by {lift}× (n={n})"`), so a dead Pioneer
degrades the prose while `stats` and `Prior[]` — which never touch the LLM — are unaffected.

**Retargeting note.** PROGRESS.md's original item was "post persona-panel/judge verdicts
back to Pioneer as feedback traffic". That is dropped as vestigial: Pioneer is an
OpenAI-compatible inference endpoint with no feedback or eval API, it is currently 403'd on
billing, and the persona panel is Track G's. Writing the learnings that get written back to
Senso is real Pioneer traffic on the writeback path and fills a contract field, which is the
project's own bar for a sponsor counting as integrated.

## Governance

`governance.approve('context_writeback', { learnings, minCiLow, minN })` runs **before**
Senso ingest. This is the `Governance` interface's own documented example ("block a
low-confidence writeback").

Denied → no writeback, no context v2, empty priors; gen-2 is not composed and the veto is
posted to the Band feed.

Denial deliberately kills the priors too, not just the writeback. Both are derived from the
same posteriors, so a judgement that the learnings are too weak to write back is equally a
judgement that they are too weak to steer the next generation. Letting gen-2 narrow on
evidence that governance just rejected would make the block cosmetic.

That is the third observable block in the system, after the
research swarm's low-confidence veto and the creative engine's fewer-than-4-survivors
denial.

## Context v2

Four artifacts prove the context actually evolved, all assertable in the integration test:

1. `brand2.contextHash !== brand.contextHash`, and `contextVersion` goes 1 → 2
2. `brief2.contextHash === brand2.contextHash` — provenance carries through
3. `brief2.priorProvenance` is non-empty — `composeBrief` already populates it as
   `dimension:value`
4. `factsV2` contains at least one `Fact` with `origin: 'performance_loop'` — the contract's
   own comment says this field drives Track G's v1→v2 diff UI

### Fact sourcing after writeback

Best-effort round-trip. After `senso.writeback()`, attempt `senso.search()` and accept the
results **only if** at least one returned chunk contains a learning's `value` verbatim.
Otherwise fall back to locally-synthesized `Fact[]` tagged `origin: 'performance_loop'`.

The acceptance check exists to avoid a specific trap: Senso's index may lag the write, and
an unconditional accept would relabel stale gen-1 chunks as `performance_loop` facts. A
deterministic fallback is honest; a false-positive round-trip is not.

`senso.search()` currently maps every result to `section: 'positioning'` with
`brandId: 'unknown'` (an existing TODO in the adapter). This phase fixes that for the
accepted-results path only — learning-derived facts map to `section: 'market_prior'` and
carry the real `brandId`. The general-purpose classification TODO stays open.

## Failure handling

| Failure | Behavior |
|---|---|
| `getPosteriors` throws or returns `[]` | No learnings, no writeback, no priors. Loop reports `evolved: false` rather than fabricating a gen-2. |
| All dimensions below `MIN_N` | Same — `evolved: false`, with the reason posted to the feed. |
| Pioneer down or response short | Template statements. `stats` and `Prior[]` unaffected. |
| Senso `writeback` throws | Caught; Actian embed still attempted; brand stays v1 but priors still apply, so gen-2 is genome-evolved even when context is not. Partial degradation, not total. |
| Actian `upsert` throws | Caught and posted to feed. Senso writeback stands. Note: `actian.upsert` embeds via Pioneer (`real/embed.ts`), so a Pioneer outage takes this path down too — hence it is isolated from the Senso path. |
| Governance denies | No writeback, empty priors, veto on feed. Gen-2 not composed. |
| `runCreativeEngine` denies gen-2 publish | Surfaced in the result. Gen-1 creatives untouched. |

Every catch posts to the Band room `brand-evolution:{brandId}`.

## Testing

Standalone `tsx` scripts following the existing convention; no test runner introduced
mid-hackathon. Each ends by printing a line starting with `✅`.

- `scripts/test-learning-math.ts` — `betaCI` bounds and monotonicity (more data ⇒ tighter
  interval); LCB ranking beats a high-mean/low-n arm; `MIN_N` suppresses thin dimensions;
  `derivePriors` is deterministic and emits verbatim values.
- `scripts/test-evolution-loop.ts` — full loop in mock mode, mirroring
  `test-creative-engine.ts`. Asserts: every posterior value appears verbatim in a gen-1
  genome; `contextVersion` 1→2; `brief2.contextHash` matches `brand2`; `priorProvenance`
  non-empty; ≥1 `origin:'performance_loop'` fact; gen-2 creatives exist with
  `genome.generation === 2`; the gen-2 angle axis is narrower than gen-1's; byte-identical
  output on a second run.
- Fixture: `fixtures/posteriors.g1.json`.
- Regression: `npm run freeze`, `npm run smoke`, `tsc --noEmit`, `npm run lint`.

## Ordering dependency

`runEvolutionLoop` calls `runCreativeEngine`, so **Phase 2 Tasks 2–7 must land first**.

`posteriors.ts`, `synthesize.ts`, `priors.ts`, and `writeback.ts` have no Phase 2
dependency and can be built in parallel with it. Only the orchestrator and its integration
test block.

## Out of scope

- **Track G's metrics rollup** (`DailyMetrics` → `DimensionPosterior`) — that is precisely
  what `PosteriorSource` exists to defer.
- **Persona-panel / judge verdicts** — Track G.
- **Gen-3 and beyond** — the loop runs exactly once.
- **Drizzle/Supabase schema** — still shared scope with Track G, still missing.
- **Band UUID room fix** — inherited Phase 1 blocker; degrades safely to mock as today.

## Known limitations

1. `fixtures/posteriors.g1.json` is hand-authored, so the performance data driving the demo
   is invented rather than simulated. The verbatim-value assertion keeps it consistent with
   real genomes, but until Track G's rollup lands, "self-evolving" is proven against
   synthetic evidence. This is disclosed, not hidden.
2. The Senso round-trip is unverified against live indexing latency. The acceptance check
   means an unusable round-trip silently takes the fallback path — correct behavior, but it
   means a passing test does not prove the round-trip works. Verify manually once
   `SENSO_API_KEY` is exercised end-to-end.
3. The Actian embed path depends on Pioneer embeddings, which are 403'd on billing. It
   ships built-but-unverified alongside the rest of the Pioneer surface.
