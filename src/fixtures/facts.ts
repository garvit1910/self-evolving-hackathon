import type { Fact } from '@/lib/contracts';

const brandId = 'brand-magic-spoon';

// Context v1: everything the research swarm extracted from the brand's site.
export const researchFacts: Fact[] = [
  {
    id: 'fact-01',
    brandId,
    section: 'positioning',
    statement:
      'Magic Spoon positions itself as a high-protein, zero-sugar remake of childhood cereals for health-conscious adults.',
    sourceUrl: 'https://magicspoon.com/',
    sourceQuote: 'Healthy, delicious cereal that tastes too good to be true.',
    confidence: 0.95,
    origin: 'research',
  },
  {
    id: 'fact-02',
    brandId,
    section: 'positioning',
    statement:
      'Premium-priced (~$10/box) and sold DTC-first through custom bundles and subscriptions, not the grocery aisle.',
    sourceUrl: 'https://magicspoon.com/collections/all',
    sourceQuote: 'Build your custom bundle — the more you add, the more you save.',
    confidence: 0.85,
    origin: 'research',
  },
  {
    id: 'fact-03',
    brandId,
    section: 'value_prop',
    statement: 'Every serving delivers 13g complete protein and 4g net carbs with 0g sugar.',
    sourceUrl: 'https://magicspoon.com/pages/ingredients',
    sourceQuote: '13g protein, 4g net carbs, 0g sugar in every bowl.',
    confidence: 0.92,
    origin: 'research',
  },
  {
    id: 'fact-04',
    brandId,
    section: 'value_prop',
    statement:
      'Keto-friendly, gluten-free, and grain-free — lets low-carb eaters keep cereal in their lives.',
    sourceUrl: 'https://magicspoon.com/pages/faq',
    sourceQuote: 'Keto-friendly. Gluten-free. Grain-free.',
    confidence: 0.9,
    origin: 'research',
  },
  {
    id: 'fact-05',
    brandId,
    section: 'voice',
    statement:
      'Playful, nostalgic tone that winks at Saturday-morning cartoons while staying adult and confident.',
    sourceUrl: 'https://magicspoon.com/pages/about',
    sourceQuote: 'We took everything you love about cereal and made it grown-up.',
    confidence: 0.8,
    origin: 'research',
  },
  {
    id: 'fact-06',
    brandId,
    section: 'voice',
    statement:
      "Copy favors short punchy claims and cheeky permission-giving — 'dessert for breakfast, minus the guilt'.",
    sourceUrl: 'https://magicspoon.com/',
    sourceQuote: 'Tastes like dessert. Built like a protein bar.',
    confidence: 0.72,
    origin: 'research',
  },
  {
    id: 'fact-07',
    brandId,
    section: 'compliance',
    statement:
      'No disease or weight-loss claims; protein and carb claims must match per-serving nutrition facts, which vary by flavor.',
    sourceUrl: 'https://magicspoon.com/pages/faq',
    sourceQuote: 'Nutrition facts vary slightly by flavor.',
    confidence: 0.88,
    origin: 'research',
  },
  {
    id: 'fact-08',
    brandId,
    section: 'market_prior',
    statement:
      "Adult 'better-for-you' cereal buyers respond to nostalgia cues well above the CPG average; category CTR baseline ~1.2%.",
    confidence: 0.7,
    origin: 'research',
  },
  {
    id: 'fact-09',
    brandId,
    section: 'persona',
    statement:
      "Nostalgic fitness enthusiast (25–38): lifts 4×/week and tracks macros, but misses Froot Loops. Pain: 'healthy' breakfasts are joyless. Desire: hit protein goals without eating another egg.",
    confidence: 0.82,
    origin: 'research',
  },
  {
    id: 'fact-10',
    brandId,
    section: 'persona',
    statement:
      'Keto parent (32–45): keeps the household low-carb and guards kids from sugar. Pain: the cereal aisle is a minefield. Desire: one box the whole family pours without a label fight.',
    confidence: 0.78,
    origin: 'research',
  },
  {
    id: 'fact-11',
    brandId,
    section: 'persona',
    statement:
      "Sugar-quitting cereal lover (28–50): quit sugar this year and cereal was the hardest goodbye. Pain: every 'healthy' cereal tastes like cardboard. Desire: the old ritual back, minus the crash.",
    confidence: 0.8,
    origin: 'research',
  },
];

// Written back after the first simulated flight; only present in context v2.
export const performanceLoopFacts: Fact[] = [
  {
    id: 'fact-pl-01',
    brandId,
    section: 'market_prior',
    statement:
      "The 'nostalgia-reboot' angle drives ~2.4× CTR vs portfolio average across all personas — prioritize it in gen-2 briefs.",
    confidence: 0.9,
    origin: 'performance_loop',
  },
  {
    id: 'fact-pl-02',
    brandId,
    section: 'market_prior',
    statement:
      "'retro-cartoon' style wins on CTR (+19%) but loses CVR with the keto parent persona — pair that persona with 'clean-clinical' + 'macro-math'.",
    confidence: 0.76,
    origin: 'performance_loop',
  },
];
