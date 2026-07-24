import type { Creative } from '@/lib/contracts';

const brandId = 'brand-magic-spoon';

// 4 gen-2 creatives — the offline regeneration path. All ride the learned
// winning angle 'nostalgia-reboot' (what samplePriors returns from the gen-1
// posteriors); count matches the fixture autopilot regenerate event
// ({creatives: 4}). Angle strings are attribution keys — never rephrase them.
export const gen2Creatives: Creative[] = [
  {
    id: 'cr-g2-01',
    briefId: 'brief-g2-01',
    brandId,
    imageUrl: '/creatives/cr-g2-01.svg',
    copy: 'Your Saturday-morning self called — the bowl is back, now with 13g protein and zero crash. Pour the rerun.',
    genome: {
      angle: 'nostalgia-reboot',
      persona: 'nostalgic fitness enthusiast',
      hook: 'Your Saturday-morning self called.',
      style: 'retro-cartoon',
      generation: 2,
    },
    status: 'live',
    publishedAdId: 'ad-mk-2001',
    arm: { alpha: 1, beta: 1, pulls: 0 },
  },
  {
    id: 'cr-g2-02',
    briefId: 'brief-g2-02',
    brandId,
    imageUrl: '/creatives/cr-g2-02.svg',
    copy: 'All the memory, none of the sugar. The cereal you gave up finally grew up with you.',
    genome: {
      angle: 'nostalgia-reboot',
      persona: 'sugar-quitting cereal lover',
      hook: 'All the memory, none of the sugar.',
      style: 'retro-cartoon',
      generation: 2,
    },
    status: 'live',
    publishedAdId: 'ad-mk-2002',
    arm: { alpha: 1, beta: 1, pulls: 0 },
  },
  {
    id: 'cr-g2-03',
    briefId: 'brief-g2-03',
    brandId,
    imageUrl: '/creatives/cr-g2-03.svg',
    copy: 'Cartoons on the box, macros on the label: 13g protein, 0g sugar, zero morning negotiations.',
    genome: {
      angle: 'nostalgia-reboot',
      persona: 'keto parent',
      hook: 'Cartoons for you. Macros for them.',
      style: 'clean-clinical',
      generation: 2,
    },
    status: 'live',
    publishedAdId: 'ad-mk-2003',
    arm: { alpha: 1, beta: 1, pulls: 0 },
  },
  {
    id: 'cr-g2-04',
    briefId: 'brief-g2-04',
    brandId,
    imageUrl: '/creatives/cr-g2-04.svg',
    copy: 'The rerun tastes better: childhood flavor, adult macros. Saturday mornings are back on the menu.',
    genome: {
      angle: 'nostalgia-reboot',
      persona: 'nostalgic fitness enthusiast',
      hook: 'The rerun tastes better.',
      style: 'retro-cartoon',
      generation: 2,
    },
    status: 'live',
    publishedAdId: 'ad-mk-2004',
    arm: { alpha: 1, beta: 1, pulls: 0 },
  },
];
