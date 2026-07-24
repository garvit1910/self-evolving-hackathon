import type { Learning } from '@/lib/contracts';

const brandId = 'brand-magic-spoon';

// lift is relative vs. the rest of the portfolio (0.19 = +19%); ci bounds are
// on the same scale. Values are display fixtures — real significance math
// arrives with the Thompson/analysis phase.
export const learnings: Learning[] = [
  {
    id: 'learn-01',
    brandId,
    statement:
      "'nostalgia-reboot' is the breakout angle: +142% CTR vs the rest of the portfolio, consistent across all three personas.",
    stats: { dimension: 'angle', value: 'nostalgia-reboot', lift: 1.42, n: 50000, ciLow: 1.18, ciHigh: 1.66 },
    sensoIngested: true,
  },
  {
    id: 'learn-02',
    brandId,
    statement:
      "'retro-cartoon' style edges out 'clean-clinical' on CTR (+19%), but the gap narrows for conversion — style is a click lever, not a buy lever.",
    stats: { dimension: 'style', value: 'retro-cartoon', lift: 0.19, n: 100000, ciLow: -0.02, ciHigh: 0.4 },
    sensoIngested: true,
  },
  {
    id: 'learn-03',
    brandId,
    statement:
      "'keto parent' persona underperforms on the 'macro-math' angle (−11% CTR) — signal is noisy, keep exploring before retiring the pairing.",
    stats: { dimension: 'persona', value: 'keto parent', lift: -0.11, n: 24000, ciLow: -0.29, ciHigh: 0.07 },
    sensoIngested: false,
  },
];
