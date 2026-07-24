// Regenerates src/fixtures/metrics.json by running the simulator once with a
// fixed seed. Deterministic: rerunning always produces the same file.
//   npm run gen:fixtures
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { defaultMarketConfig, runSim } from '../src/lib/sim';
import { gen1Creatives } from '../src/fixtures/creatives';
import { panelScores } from '../src/fixtures/panel-scores';

const SEED = 42;
const DAYS = 20;

const { metrics } = runSim(defaultMarketConfig, gen1Creatives, panelScores, DAYS, SEED);
const outPath = path.resolve(import.meta.dirname, '../src/fixtures/metrics.json');
writeFileSync(outPath, JSON.stringify(metrics, null, 2) + '\n');

const impressions = metrics.reduce((s, m) => s + m.impressions, 0);
const clicks = metrics.reduce((s, m) => s + m.clicks, 0);
console.log(
  `wrote ${metrics.length} rows (${DAYS} days × ${gen1Creatives.length} ads, seed ${SEED}) → ${outPath}`,
);
console.log(`totals: ${impressions} impressions, ${clicks} clicks, blended CTR ${(clicks / impressions * 100).toFixed(2)}%`);
