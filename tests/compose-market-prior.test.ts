import { describe, expect, it } from 'vitest';
import { composeBriefs } from '@/lib/creative/compose';
import type { Brand, Fact } from '@/lib/contracts';

const brand: Brand = {
  id: 'brand-x',
  url: 'https://x.test',
  name: 'X Cereal',
  productImageUrl: '',
  contextVersion: 1,
  contextHash: 'abc',
  sensoSourceIds: [],
};

const marketPriorFact: Fact = {
  id: 'f-comp-1',
  brandId: 'brand-x',
  section: 'market_prior',
  statement: 'Competitor (OffLimits): leads with zero-sugar caffeine cereal positioning',
  confidence: 0.8,
  origin: 'research',
};

function compose(facts: Fact[]) {
  return composeBriefs({
    brand,
    facts,
    rankedFacts: [],
    count: 4,
    generation: 1,
    runId: 'r1',
    contextVersion: 1,
    contextHash: 'abc',
  });
}

describe('composeBriefs market_prior fallback', () => {
  it('derives the competitive angle from a market_prior fact when positioning/value_prop are absent', () => {
    const briefs = compose([marketPriorFact]);
    expect(briefs[0].priorSource).toBe('competitive_fact');
    // slug of the first 3 words of the statement
    expect(briefs[0].angle).toContain('competitor');
    expect(briefs[0].sourceFactIds).toContain('f-comp-1');
  });

  it('still prefers positioning over market_prior when both exist', () => {
    const positioningFact: Fact = {
      id: 'f-pos',
      brandId: 'brand-x',
      section: 'positioning',
      statement: 'Subscription-first DTC cereal for adults',
      confidence: 0.9,
      origin: 'research',
    };
    const briefs = compose([positioningFact, marketPriorFact]);
    expect(briefs[0].priorSource).toBe('competitive_fact');
    expect(briefs[0].angle).not.toContain('competitor');
    expect(briefs[0].sourceFactIds).toContain('f-pos');
  });
});
