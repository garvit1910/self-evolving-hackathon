import { describe, expect, it } from 'vitest';
import { gen1Creatives } from '@/fixtures/creatives';
import { gen2Creatives } from '@/fixtures/creatives-gen2';
import { panelScores } from '@/fixtures/panel-scores';
import { gen2PanelScores } from '@/fixtures/panel-scores-gen2';
import {
  DEMO_LEARNING_OPTS,
  DEMO_RETIREMENT_OPTS,
  createLiveSim,
  type LiveSimEvent,
} from './livesim';
import { defaultMarketConfig } from './sim';

// The offline acceptance path: seed 42, Thompson, demo pacing → learnings fire,
// regeneration triggers, gen-2 fixtures join, gen2_wins verdict within 40 days.
describe('full loop offline integration (seed 42)', () => {
  it('learning → trigger → gen-2 entry → gen2_wins within 40 days', () => {
    const sim = createLiveSim({
      config: defaultMarketConfig,
      creatives: gen1Creatives,
      panelScores,
      seed: 42,
      allocator: 'thompson',
      learningOpts: DEMO_LEARNING_OPTS,
      retirementOpts: DEMO_RETIREMENT_OPTS,
    });

    let firstLearningDay = 0;
    let triggerDay = 0;
    let verdictEvent: Extract<LiveSimEvent, { type: 'verdict' }> | null = null;

    // run the full 40 days — the sim keeps going after the verdict in the UI,
    // and later learnings (the angle learning) fire past the verdict day
    for (let d = 1; d <= 40; d++) {
      const { events } = sim.stepDay();
      for (const e of events) {
        if (e.type === 'learning' && firstLearningDay === 0) firstLearningDay = e.day;
        if (e.type === 'trigger_regeneration' && triggerDay === 0) {
          triggerDay = e.day;
          // priors carry the learned winner verbatim
          expect(e.priors.angle).toBe('nostalgia-reboot');
          sim.addCreatives(gen2Creatives, gen2PanelScores);
        }
        if (e.type === 'verdict' && !verdictEvent) verdictEvent = e;
      }
    }

    // ≥1 learning fired, before (or with) the trigger, inside the demo window
    expect(firstLearningDay).toBeGreaterThanOrEqual(5);
    expect(firstLearningDay).toBeLessThanOrEqual(20);
    expect(triggerDay).toBeGreaterThanOrEqual(firstLearningDay);
    expect(triggerDay).toBeLessThanOrEqual(25);

    // gen-2 entered and won within the 40-day ceiling
    expect(verdictEvent).not.toBeNull();
    expect(verdictEvent!.comparison.verdict).toBe('gen2_wins');
    expect(verdictEvent!.day).toBeLessThanOrEqual(40);
    expect(verdictEvent!.comparison.gen2Ctr).toBeGreaterThan(verdictEvent!.comparison.gen1Ctr);

    const state = sim.getState();
    expect(state.learnings.length).toBeGreaterThanOrEqual(1);
    expect(state.creatives.some((c) => c.genome.generation === 2)).toBe(true);
    expect(state.retiredAdIds.length).toBeGreaterThanOrEqual(1);
    expect(state.regenerationTriggered).toBe(true);
    // the planted winner angle earns a learning (style/persona may fire too)
    expect(state.learnings.map((l) => l.stats.value)).toContain('nostalgia-reboot');
    expect(state.learnings.every((l) => !l.sensoIngested)).toBe(true);
  });
});
