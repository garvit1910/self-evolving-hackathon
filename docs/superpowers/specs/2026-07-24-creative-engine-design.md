# Phase 2 — Creative Engine (Track A)

Status: approved design, not yet implemented
Date: 2026-07-24

## Goal

Turn one `Brief` into 6–8 persisted `Creative`s whose genomes vary across
`angle` / `persona` / `hook` / `style`, with generated copy and Gemini imagery, screened
by a prohibited-claims gate and published behind a Guild governance check.

Covers these PROGRESS.md Phase 2 items:

- Gemini image generation (product image as reference) → 6–8 candidates
- Copy generation via Pioneer
- Genome stamping on every creative
- Creative persistence (unblocked via a store seam, not the missing DB)
- Prohibited-claims gate + repair pass

## Motivating problem

`composeBrief` emits a **single** `Brief` with one angle, one persona, one style. Phase 2
needs 6–8 creatives whose genomes differ, or Track G's `DimensionPosterior` bandit has
nothing to compare and the "self-evolving" story is unprovable. The missing piece is an
explicit fan-out layer between brief and creatives.

## Architecture

New orchestrator `src/lib/agents/creativeEngine.ts`, mirroring `researchSwarm.ts`:
adapters injected, progress posted to a Band room, Guild gates publish.

| Unit | File | Deps | Purpose |
|---|---|---|---|
| `expandGenomes` | `src/lib/brief/expandGenomes.ts` | none — pure | Brief + personas → N distinct `Genome[]` |
| `distillBannedTerms` | `src/lib/creative/bannedTerms.ts` | `LLM` | Compliance prose → term list, ∪ floor list, cached by `contextHash` |
| `writeCopy` | `src/lib/agents/copywriter.ts` | `LLM`, `Feed` | One batched `extract` call → copy per genome |
| `renderImages` | `src/lib/agents/imagesmith.ts` | `ImageGen`, `Feed`, `CreativeStore` | Genome → prompt → Gemini w/ product ref → persisted PNG |
| `screenCreatives` | `src/lib/creative/complianceGate.ts` | none — pure | Copy vs banned terms → violations |
| `CreativeStore` | `src/lib/store/creativeStore.ts` | fs | Persist creatives + images behind a swappable seam |

### Flow

```
composeBrief(input) ──► brief
        │
        ├─► distillBannedTerms(brief.compliance, llm)   [cached by contextHash]
        │
        └─► expandGenomes(brief, personas, 8) ──► genomes[8]
                    │
                    ├─► writeCopy(brief, genomes, llm)   1 batched LLM call
                    │        │
                    │        └─► screenCreatives(copy, bannedTerms)
                    │                 violations? ─► repair pass (1 retry, avoid-list in prompt)
                    │                 still failing? ─► drop + post veto to Band
                    │
                    └─► renderImages(brief, survivors, imageGen, store)   concurrency 3
                              │
                              └─► Guild.approve('creative_publish', {generated, dropped, violations})
                                        │
                                        └─► store.saveRun(runId, creatives[])
```

Two deliberate ordering choices:

1. Copy is screened **before** images, so no Gemini quota is spent on a creative about to
   be dropped.
2. `renderImages` uses bounded concurrency (3), not all 8 at once — Gemini is the slowest
   and most quota-limited call in the system.

## expandGenomes

### Shared axes

`DEFAULT_ANGLES` and `DEFAULT_STYLES` are currently private to `composeBrief.ts`. Lift both
to `src/lib/brief/axes.ts`; `composeBrief.ts` and `expandGenomes.ts` both import them.
Without this the vocabulary is duplicated and can drift, corrupting `angle` attribution
keys. Behavior-neutral refactor.

### Indexing rule

Naive round-robin (`axis[i % len]`) perfectly confounds any two axes of equal length: with
4 angles and 4 styles across 8 creatives, `angle` and `style` move in lockstep and no
downstream math can attribute performance to either. Per-dimension posteriors would be
measuring a ghost.

Each axis therefore uses a **shifted round-robin**:

```
axis[(i + Math.floor(i / len)) % len]
```

```
i        0   1   2   3   4   5   6   7
angle    0   1   2   3   0   1   2   3     (len 4)
style    0   1   2   3   1   2   3   0     (len 4, shifted on wrap)
persona  0   1   2   1   2   0   2   0     (len 3)
hook     0   1   2   1   2   0   2   0     (len 3)
```

Every angle co-occurs with two different styles, so dimensions are separable at n = 8.

### Axis contents

- `angle` — `brief.angle` first, then the remainder of `DEFAULT_ANGLES`
- `persona` — `personas.map(p => p.name)`, verbatim
- `hook` — `brief.hooks`, deduped defensively (`composeBrief` can emit repeats — see
  `fixtures/brief.g1.json`, which contains a duplicated hook)
- `style` — `brief.style` first, then the remainder of `DEFAULT_STYLES`

All values are copied verbatim. `angle` and `persona` are attribution keys and must never
be rephrased (see `contracts/index.ts` header).

### Gen-2 narrowing

For each dimension that has a `Prior`, the axis truncates to 2 values: the highest-weight
prior's `value` first, then the axis's own position-0 value from the gen-1 ordering (i.e.
what the brief would have led with absent priors). If those two are identical, the next
unused axis value fills slot 2, so the axis never degenerates to length 1. Dimensions
without priors keep exploring at full width. This
concentrates the set on winners without collapsing to 8 identical genomes, and makes the
gen-1 → gen-2 diff legible in the UI.

`expandGenomes` supports this now; nothing calls it with real priors until Track G's
posteriors exist.

### Output stamping

- `Creative.id` = `` `${runId}-c${n}` `` (n from 1, per contract)
- `briefId` = `brief.id`
- `publishedAdId` = `` `sim-${id}` ``
- `arm` = `{ alpha: 1, beta: 1, pulls: 0 }` — uniform prior, unbiased bandit start
- `status` = `'live'`
- `genome.generation` = `brief.generation`

Deterministic: identical input produces byte-identical output.

## Copy generation

One batched `llm.extract` over all genomes rather than 8 separate calls — one tape entry,
one failure mode, ~8× cheaper.

Schema hint: `{ copies: { index: number, copy: string }[] }`

Prompt includes: brief core message, CTA, compliance statements, the matched persona's
pains/desires/objections, and per-genome `angle` + `hook`. The banned-term avoid-list is
stated up front so most violations never occur.

If the response has fewer entries than genomes, missing indices fall back deterministically
to `brief.coreMessage` + the genome's hook.

## Prohibited-claims gate

### Term sourcing

One `llm.extract` call distills `brief.compliance` prose into a term list, cached per
`contextHash` (compliance facts only change when context does). The check itself stays
mechanical — case-insensitive, whitespace-normalized substring matching, reusing the
`normalize()` approach from `analyst.ts`.

The distilled list is **unioned with a non-negotiable floor list** of universally
prohibited ad claims (`cure`, `cures`, `guaranteed`, `clinically proven`, `FDA approved`,
`miracle`, `100% safe`, and similar). This is the mitigation for the distillation's main
failure mode: an empty or errored response would otherwise silently turn the gate into a
no-op, and a gate that appears to pass while checking nothing is worse than no gate.

### Repair pass

A creative with violations gets exactly one repair retry — copy regenerated with an
explicit avoid-list naming the terms it hit. Still failing → dropped, with the veto posted
to the Band feed so the block is observable rather than silent.

### Guild

`governance.approve('creative_publish', { generated, dropped, violations })` runs before
persistence. If drops leave fewer than 4 survivors, Guild denies and the orchestrator
surfaces the denial rather than shipping a threadbare set. This gives Guild a second
observable block, which is the stated bar for it counting as integrated
(`interfaces.ts`: "Real only if it can OBSERVABLY block something").

## Persistence

```ts
interface CreativeStore {
  saveRun(runId: string, creatives: Creative[]): Promise<void>;
  getRun(runId: string): Promise<Creative[] | null>;
  saveImage(runId: string, id: string, data: Buffer): Promise<string>; // returns imageUrl
}
```

Filesystem implementation:

- `saveImage` → writes `public/runs/<runId>/<id>.png`, returns `/runs/<runId>/<id>.png`
- `saveRun` → writes `.runs/<runId>/creatives.json`

A Supabase implementation slots in behind the same three methods once the shared schema
lands. This is the seam that unblocks Phase 2 without pre-empting the schema design, which
is shared scope with Track G.

`.runs/` is added to `.gitignore`; `public/runs/` is not (golden-run assets get committed
deliberately — see Known limitations).

## Image generation

Prompt template:

```
${style} advertising image for ${brand.name}. ${hook}. Angle: ${angle}. Audience: ${persona summary}.
```

`brand.productImageUrl` is passed as the reference image. This requires implementing the
outstanding TODO in `src/lib/adapters/real/gemini.ts` — fetch `refImageUrl`, base64-encode
it, and include it as `inlineData` for image conditioning. Currently the parameter is
accepted and discarded.

`renderImages` decodes Gemini's base64 response to a Buffer and hands it to
`store.saveImage`.

## Failure handling

The existing `withFallback` proxy in `adapters/index.ts` already swaps a throwing real
adapter for the mock per-method. That covers total failure; it does not cover partial
failure, which is what actually happens here.

| Failure | Behavior |
|---|---|
| Gemini fails for one genome | Creative keeps genome + copy, gets mock placeholder image, marked in Band feed. One missing image must not kill the other 7. |
| Gemini fails for all | Full set renders on placeholders; run completes. Demo degrades, never dies. |
| `distillBannedTerms` empty or throws | Floor list still applies — gate cannot no-op. |
| Copy response short | Missing indices fall back to `coreMessage` + hook, deterministically. |
| Creative fails repair | Dropped, veto posted to Band. Fewer than 4 survivors → Guild denies publish. |
| `saveImage` write fails | Falls back to inline data URL; run completes. |

## Testing

Follows the existing `scripts/*.ts` + `tsx` convention; no test runner introduced
mid-hackathon.

- `scripts/test-expand-genomes.ts` — the load-bearing pure unit. Asserts N distinct
  genomes; no two axes of length ≥ 2 perfectly correlated across the set (axes of length 1
  are constant by definition and exempt — a brand yielding only one persona is a valid
  degenerate case, not a bug); every `angle`/`persona` string verbatim from source; gen-2
  narrowing concentrates on priors; identical input → byte-identical output.
- `scripts/test-compliance-gate.ts` — copy containing "cures" is caught; floor list fires
  when distillation returns `[]`; repair pass path exercised.
- `scripts/test-creative-engine.ts` — full engine in mock mode, mirroring
  `test-research-swarm.ts`. Asserts 8 creatives, all contract fields populated, files
  written to disk.
- Regression: `npm run freeze`, `npm run smoke`, `tsc` clean.

## Housekeeping

`createMockImageGen` returns `/fixtures/ad-1.png` … `/fixtures/ad-4.png`, but
`public/fixtures/` does not exist — every mock-mode image is currently a broken link.
Commit four placeholder PNGs there as part of this work.

## Out of scope

- **Drizzle/Supabase schema** — shared with Track G. `CreativeStore` is the seam that lets
  it land later without touching the engine.
- **Phase 3 writeback** — learnings → Senso/Actian, gen-2 brief composition.
- **Band UUID room fix** — inherited Phase 1 blocker; degrades safely to mock as today.
- **Gen-2 execution** — `expandGenomes` supports narrowing, but no caller supplies real
  priors until Track G's posteriors exist.

## Known limitations

1. `GEMINI_API_KEY` is still empty. The image path ships built-but-unverified against the
   real API; everything else is verifiable offline today.
2. Railway's filesystem is ephemeral, so runtime-written images under `public/runs/` vanish
   on redeploy. Acceptable for the golden replay run only if the golden run's PNGs are
   committed to the repo rather than generated on the box. Flagged as a Phase 4 follow-up,
   not solved here.
