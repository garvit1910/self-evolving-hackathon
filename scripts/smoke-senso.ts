/**
 * Senso live smoke — the app-path proof (SensoContextStore in src/lib/context.ts).
 *   npx tsx --env-file=.env.local scripts/smoke-senso.ts
 *
 * Ingest 2 facts → search returns them → write back 1 learning → contextVersion
 * and contextHash change (what GET /api/brands/:id/context serves) and the
 * brand accumulates Senso source ids. Uses a throwaway DATA_DIR. Prints no env
 * values. Reports per-call latency.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Fact, Learning } from '../src/lib/contracts';

process.env.USE_REAL_SENSO = '1';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'senso-smoke-'));

const { getContextStore, SensoContextStore } = await import('../src/lib/context');
const { getStore } = await import('../src/lib/store');

const BRAND = 'brand-senso-smoke';

const facts: Fact[] = [
  {
    id: 'ss-f1',
    brandId: BRAND,
    section: 'value_prop',
    statement: 'Zero-sugar cereal with 13g complete protein per bowl',
    sourceUrl: 'https://magicspoon.com',
    sourceQuote: '0g sugar, 13g protein',
    confidence: 0.9,
    origin: 'research',
  },
  {
    id: 'ss-f2',
    brandId: BRAND,
    section: 'positioning',
    statement: 'Childhood cereal nostalgia rebuilt for health-conscious adults',
    sourceUrl: 'https://magicspoon.com',
    confidence: 0.85,
    origin: 'research',
  },
];

const learning: Learning = {
  id: 'ss-l1',
  brandId: BRAND,
  statement: 'problem-solution angle lifts CTR ~18% over the field',
  stats: { dimension: 'angle', value: 'problem-solution', lift: 0.18, n: 5200, ciLow: 0.09, ciHigh: 0.27 },
  sensoIngested: false,
};

async function main() {
  const store = getStore();
  store.putBrand({
    id: BRAND,
    url: 'https://magicspoon.com',
    name: 'Senso Smoke',
    productImageUrl: '',
    contextVersion: 0,
    contextHash: '',
    sensoSourceIds: [],
  });

  const ctx = getContextStore();
  if (!(ctx instanceof SensoContextStore)) {
    console.error('❌ SENSO SMOKE FAILED: USE_REAL_SENSO=1 did not resolve SensoContextStore (check SENSO_API_KEY).');
    process.exit(1);
  }

  let t = Date.now();
  const v1 = await ctx.ingestFacts(BRAND, facts);
  const ingestMs = Date.now() - t;
  console.log(`ingest → v${v1.version} hash=${v1.hash} (${ingestMs}ms)`);

  t = Date.now();
  const hits = await ctx.search(BRAND, 'protein sugar cereal', 5);
  const searchMs = Date.now() - t;
  console.log(`search → ${hits.length} facts: ${hits.map((f) => f.id).join(',')} (${searchMs}ms)`);
  if (!hits.some((f) => f.id === 'ss-f1' || f.id === 'ss-f2')) {
    console.error('❌ SENSO SMOKE FAILED: search did not return the ingested facts.');
    process.exit(1);
  }

  t = Date.now();
  const v2 = await ctx.writeBackLearnings(BRAND, [learning]);
  const wbMs = Date.now() - t;
  console.log(`writeback → v${v2.version} hash=${v2.hash} factIds=${v2.factIds.join(',')} (${wbMs}ms)`);

  const brand = store.getBrand(BRAND)!;
  console.log(`brand: contextVersion=${brand.contextVersion} sensoSourceIds=${brand.sensoSourceIds.length}`);

  if (!(v2.version > v1.version) || v2.hash === v1.hash) {
    console.error('❌ SENSO SMOKE FAILED: writeback did not bump version/hash.');
    process.exit(1);
  }
  if (brand.sensoSourceIds.length < 2) {
    console.error(`❌ SENSO SMOKE FAILED: expected ≥2 Senso source ids on the brand (facts + learnings), got ${brand.sensoSourceIds.length} — Senso writes fell back to local.`);
    process.exit(1);
  }
  console.log(
    `✅ SENSO SMOKE OK — ingest ${ingestMs}ms, search ${searchMs}ms, writeback ${wbMs}ms; v${v1.version}→v${v2.version}, hash flipped, ${brand.sensoSourceIds.length} Senso sources.`,
  );
}

main().catch((e) => {
  console.error('❌ SENSO SMOKE FAILED:', (e as Error).message);
  process.exit(1);
});
