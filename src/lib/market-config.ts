import type { Creative } from './contracts';
import { fnv1a } from './hash';
import { defaultMarketConfig, type DimensionEffect, type MarketConfig } from './sim';

// The simulator's effect tables are keyed by the fixture genome strings —
// unknown keys fall back to neutral 1.0, which would make any created brand's
// market flat (no winner, no learnings, no story). This plants a deterministic
// winner among the brand's own generated angle keys instead. Pure + client-safe.

const ANGLE_CYCLE: DimensionEffect[] = [
  { ctr: 1.1, cvr: 1.0 },
  { ctr: 0.95, cvr: 1.2 },
  { ctr: 1.0, cvr: 0.9 },
];
const STYLE_CYCLE: DimensionEffect[] = [
  { ctr: 1.15, cvr: 1.0 },
  { ctr: 0.95, cvr: 1.05 },
];
const PERSONA_CYCLE: DimensionEffect[] = [
  { ctr: 1.1, cvr: 1.0 },
  { ctr: 1.0, cvr: 1.1 },
  { ctr: 0.95, cvr: 1.0 },
];

// same string as server/brands FIXTURE_BRAND_ID — duplicated to keep this
// module free of server-only imports
const FIXTURE_BRAND = 'brand-magic-spoon';

export function marketConfigFor(brandId: string, creatives: Creative[]): MarketConfig {
  if (brandId === FIXTURE_BRAND || creatives.length === 0) return defaultMarketConfig;

  const angles = [...new Set(creatives.map((c) => c.genome.angle))];
  const styles = [...new Set(creatives.map((c) => c.genome.style))];
  const personas = [...new Set(creatives.map((c) => c.genome.persona))];
  const winner = angles[fnv1a(brandId) % angles.length];

  const config = structuredClone(defaultMarketConfig);
  config.angleEffect = {};
  angles.forEach((angle, i) => {
    config.angleEffect[angle] =
      angle === winner ? { ctr: 2.5, cvr: 1.15 } : ANGLE_CYCLE[i % ANGLE_CYCLE.length];
  });
  config.styleEffect = {};
  styles.forEach((style, i) => {
    config.styleEffect[style] = STYLE_CYCLE[i % STYLE_CYCLE.length];
  });
  config.personaEffect = {};
  personas.forEach((persona, i) => {
    config.personaEffect[persona] = PERSONA_CYCLE[i % PERSONA_CYCLE.length];
  });
  return config;
}
