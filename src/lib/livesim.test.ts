import { describe, expect, it } from 'vitest';
import { gen1Creatives } from '@/fixtures/creatives';
import { gen2Creatives } from '@/fixtures/creatives-gen2';
import { panelScores } from '@/fixtures/panel-scores';
import { gen2PanelScores } from '@/fixtures/panel-scores-gen2';
import {
  DEMO_LEARNING_OPTS,
  DEMO_RETIREMENT_OPTS,
  createLiveSim,
  type LiveSimOpts,
} from './livesim';
import { defaultMarketConfig } from './sim';

const SEED = 42;

const demoOpts = (allocator: 'uniform' | 'thompson'): LiveSimOpts => ({
  config: defaultMarketConfig,
  creatives: gen1Creatives,
  panelScores,
  seed: SEED,
  allocator,
  learningOpts: DEMO_LEARNING_OPTS,
  retirementOpts: DEMO_RETIREMENT_OPTS,
});

/** Steps 14 days, joins gen-2, continues to day 30. */
function runScript(allocator: 'uniform' | 'thompson') {
  const sim = createLiveSim(demoOpts(allocator));
  for (let d = 1; d <= 14; d++) sim.stepDay();
  sim.addCreatives(gen2Creatives, gen2PanelScores);
  for (let d = 15; d <= 30; d++) sim.stepDay();
  return sim.getState();
}

describe('createLiveSim', () => {
  it('same seed + same action script → deep-equal snapshots', () => {
    expect(runScript('thompson')).toEqual(runScript('thompson'));
  });

  it('different seeds diverge', () => {
    const a = createLiveSim(demoOpts('thompson'));
    const b = createLiveSim({ ...demoOpts('thompson'), seed: 43 });
    for (let d = 1; d <= 5; d++) {
      a.stepDay();
      b.stepDay();
    }
    expect(a.getState().metrics).not.toEqual(b.getState().metrics);
  });

  it('never mutates input creatives or fixtures', () => {
    runScript('thompson');
    for (const c of [...gen1Creatives, ...gen2Creatives]) {
      expect(c.arm).toEqual({ alpha: 1, beta: 1, pulls: 0 });
      expect(c.status).toBe('live');
    }
  });

  it('retired arms receive 0 impressions afterwards', () => {
    const sim = createLiveSim(demoOpts('thompson'));
    const retired = new Set<string>();
    let sawRetirement = false;
    for (let d = 1; d <= 30; d++) {
      const { dayMetrics, events } = sim.stepDay();
      // rows for this day must not include arms retired on a PREVIOUS day
      for (const row of dayMetrics) {
        expect(retired.has(row.adId)).toBe(false);
      }
      for (const e of events) {
        if (e.type === 'retire') {
          sawRetirement = true;
          for (const adId of e.adIds) retired.add(adId);
        }
      }
    }
    expect(sawRetirement).toBe(true);
    expect(sim.getState().retiredAdIds.length).toBeGreaterThan(0);
  });

  it('conserves clicks ≤ impressions and purchases ≤ clicks', () => {
    const state = runScript('thompson');
    for (const m of state.metrics) {
      expect(m.clicks).toBeGreaterThanOrEqual(0);
      expect(m.clicks).toBeLessThanOrEqual(m.impressions);
      expect(m.purchases).toBeLessThanOrEqual(m.clicks);
    }
  });

  it('uniform mode splits the budget evenly and skips arm refresh', () => {
    const sim = createLiveSim(demoOpts('uniform'));
    const { dayMetrics } = sim.stepDay();
    expect(dayMetrics).toHaveLength(gen1Creatives.length);
    const per = defaultMarketConfig.dailyImpressions / gen1Creatives.length;
    for (const row of dayMetrics) expect(row.impressions).toBe(per);
    for (const c of sim.getState().creatives.filter((x) => x.status === 'live')) {
      expect(c.arm.pulls).toBe(0);
    }
  });
});
