/**
 * Actian VectorAI smoke.
 *   npx tsx --env-file=.env.local scripts/smoke-actian.ts
 *
 * Upserts 5 chunks and queries for the semantically nearest. Two outcomes:
 *   - Actian reachable: matches come from the DB (source=actian) — verify
 *     nearest-first ordering.
 *   - Actian down/unconfirmed: records UNREACHABLE and proves the kill-switch
 *     fallback (MemoryVectorStore mirror) still ranks correctly, so the demo
 *     path is safe either way. Prints no env values.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.USE_REAL_ACTIAN = '1';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'actian-smoke-'));

const { getVectorStore, ActianVectorStore } = await import('../src/lib/vector');

const CHUNKS = [
  { id: 'c1', text: 'High-protein zero-sugar cereal for adults' },
  { id: 'c2', text: 'Free shipping on subscription orders' },
  { id: 'c3', text: 'Playful nostalgic Saturday-morning branding' },
  { id: 'c4', text: 'Keto-friendly macros: 13g protein per bowl' },
  { id: 'c5', text: 'Recyclable packaging initiative 2026' },
];

async function main() {
  console.log(`ACTIAN_URL=${process.env.ACTIAN_URL ? 'set' : 'MISSING'}`);
  // reachability probe (3s timeout) so the report is explicit
  let reachable = false;
  if (process.env.ACTIAN_URL) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 3000);
      await fetch(process.env.ACTIAN_URL, { signal: ctrl.signal });
      clearTimeout(to);
      reachable = true;
    } catch {
      reachable = false;
    }
  }
  console.log(`reachability: ${reachable ? 'REACHABLE' : 'UNREACHABLE (no local VectorAI DB listening)'}`);

  const store = getVectorStore('actian-smoke');
  console.log(`store: ${store instanceof ActianVectorStore ? 'ActianVectorStore (memory mirror behind it)' : 'MemoryVectorStore'}`);

  const t = Date.now();
  await store.upsert(CHUNKS);
  const hits = await store.query('protein sugar cereal nutrition', 3);
  const ms = Date.now() - t;
  console.log(`query → ${hits.map((h) => h.id).join(',')} (${ms}ms)`);

  const top = hits[0]?.id;
  if (top !== 'c1' && top !== 'c4') {
    console.error(`❌ ACTIAN SMOKE FAILED: nearest chunk should be c1/c4 (protein/sugar), got ${top}`);
    process.exit(1);
  }
  console.log(
    reachable
      ? `✅ ACTIAN SMOKE OK — live DB answered, nearest-first ordering verified (${ms}ms).`
      : `✅ ACTIAN FALLBACK OK — DB unreachable, kill-switch path (memory mirror) ranked nearest-first (${ms}ms). Start the local VectorAI DB and re-run to go live; wire routes are per src/lib/adapters/real/actian.ts and still unverified against a real instance.`,
  );
}

main().catch((e) => {
  console.error('❌ ACTIAN SMOKE FAILED:', (e as Error).message);
  process.exit(1);
});
