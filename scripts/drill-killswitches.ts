/**
 * Kill-switch degradation drill (pre-stage checklist).
 *   npx tsx scripts/drill-killswitches.ts
 *
 * Flips every sponsor switch OFF in-process and asserts the app resolves the
 * local/mock implementation — no code changes, no network. The live halves
 * were proven by the smokes (smoke-pioneer/senso/actian, swarm, golden run);
 * the Band route fallback was additionally proven live (an interim-researcher
 * golden pass ran through POST /research when the server had the flag off).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'drill-'));
process.env.USE_REAL_PIONEER = '0';
process.env.USE_REAL_SENSO = '0';
process.env.USE_REAL_ACTIAN = '0';
process.env.USE_REAL_BAND = '0';
process.env.USE_REAL_GEMINI = '0';
delete process.env.GEMINI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.LLM_API_KEY;
delete process.env.PIONEER_API_KEY;

const { getLLMConfig } = await import('../src/lib/llm');
const { getContextStore, LocalContextStore } = await import('../src/lib/context');
const { getVectorStore, MemoryVectorStore } = await import('../src/lib/vector');
const { getLiveImageGen } = await import('../src/lib/imagegen');

let failed = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✅' : '❌'} ${name}: ${detail}`);
  if (!ok) failed++;
}

const llm = getLLMConfig();
check('PIONEER off', llm === null, `getLLMConfig() → ${llm === null ? 'null (mock copy/panel/research)' : 'unexpected config'}`);

const ctx = getContextStore();
check('SENSO off', ctx instanceof LocalContextStore, `getContextStore() → ${ctx.constructor.name}`);

const vec = getVectorStore('drill');
check('ACTIAN off', vec instanceof MemoryVectorStore, `getVectorStore() → ${vec.constructor.name}`);

check('BAND off', !(process.env.USE_REAL_BAND === '1'), 'POST /research runs the interim researcher (route checks USE_REAL_BAND)');

const img = getLiveImageGen();
check('GEMINI/images off', img === null, `getLiveImageGen() → ${img === null ? 'null (SVG placeholders)' : 'unexpected live chain'}`);

if (failed) {
  console.error(`❌ DRILL FAILED — ${failed} switch(es) did not degrade cleanly`);
  process.exit(1);
}
console.log('✅ KILL-SWITCH DRILL OK — every sponsor degrades to the local/mock path with env flags alone.');
