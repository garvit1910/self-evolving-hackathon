# Adcero — Self-Evolving Ad Engine (hackathon)

Brand URL + product image in → agent swarm researches the brand → context layer →
creative engine generates ads → ads run in a **simulated market** → a bandit learns →
learnings rewrite the context → better ads get regenerated.

Runs fully **offline on fixtures**: no env vars, no network calls, no DB.

```bash
npm i
npm run dev        # full clickable demo at localhost:3000
npm test           # simulator tests (vitest)
npm run typecheck  # tsc --noEmit
npm run gen:fixtures  # regenerate src/fixtures/metrics.json (seed 42)
```

## Layout

- `src/lib/contracts.ts` — shared types + `DataSource` interface (both tracks build against this)
- `src/lib/datasource.ts` — `FixtureDataSource`; Track A swaps in a DB-backed one later
- `src/lib/sim.ts` — pure, seeded market simulator (same seed → byte-identical output)
- `src/db/schema.ts` — Drizzle schema mirroring the contracts (no migrations needed)
- `src/fixtures/` — demo brand "Magic Spoon": facts, creatives, panel scores, metrics, events
- `src/agents/`, `src/integrations/` — **Track A territory**, Track G never touches these
- `scripts/gen-fixtures.ts` — runs the simulator once (seed 42) and writes `metrics.json`
