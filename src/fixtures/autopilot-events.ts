import type { AutopilotEvent } from '@/lib/contracts';

// One full autopilot run, replayed client-side with 300–1200ms delays.
// `agent` in research payloads names the swarm member for the /research feed;
// `factId` links the event to a fixture fact so it can slide into the panel.
const t0 = 1784851200000;

export const autopilotEvents: AutopilotEvent[] = [
  { step: 'research', status: 'running', ts: t0, payload: { agent: 'Scout', message: 'Crawling magicspoon.com — sitemap resolved, 14 pages queued.' } },
  { step: 'research', status: 'running', ts: t0 + 1, payload: { agent: 'Scout', message: 'Landing page + ingredients + FAQ fetched. Handing off to Analyst.', pages: 14 } },
  { step: 'research', status: 'running', ts: t0 + 2, payload: { agent: 'Analyst', message: 'Positioning locked: zero-sugar remake of childhood cereal for adults.', factId: 'fact-01' } },
  { step: 'research', status: 'running', ts: t0 + 3, payload: { agent: 'Analyst', message: 'Pricing model extracted: ~$10/box, DTC bundles + subscription.', factId: 'fact-02' } },
  { step: 'research', status: 'running', ts: t0 + 4, payload: { agent: 'Analyst', message: 'Core claim verified on ingredients page: 13g protein / 4g net carbs / 0g sugar.', factId: 'fact-03' } },
  { step: 'research', status: 'running', ts: t0 + 5, payload: { agent: 'Analyst', message: 'Diet coverage: keto-friendly, gluten-free, grain-free.', factId: 'fact-04' } },
  { step: 'research', status: 'running', ts: t0 + 6, payload: { agent: 'Analyst', message: 'Voice profile: playful nostalgia, adult confidence, short punchy claims.', factId: 'fact-05' } },
  { step: 'research', status: 'running', ts: t0 + 7, payload: { agent: 'Analyst', message: 'Compliance guardrail: no disease/weight-loss claims; cite per-serving facts.', factId: 'fact-07' } },
  { step: 'research', status: 'running', ts: t0 + 8, payload: { agent: 'Personasmith', message: 'Persona 1 drafted: nostalgic fitness enthusiast — misses Froot Loops, tracks macros.', factId: 'fact-09' } },
  { step: 'research', status: 'running', ts: t0 + 9, payload: { agent: 'Personasmith', message: 'Persona 2 drafted: keto parent — wants one box without a label fight.', factId: 'fact-10' } },
  { step: 'research', status: 'running', ts: t0 + 10, payload: { agent: 'Personasmith', message: 'Persona 3 drafted: sugar-quitting cereal lover — cereal was the hardest goodbye.', factId: 'fact-11' } },
  { step: 'research', status: 'done', ts: t0 + 11, payload: { facts: 11, personas: 3, sources: 5 } },

  { step: 'context', status: 'running', ts: t0 + 12, payload: { message: 'Compiling 11 facts into context v1, deduping against Senso sources.' } },
  { step: 'context', status: 'done', ts: t0 + 13, payload: { version: 1, hash: 'a3f91c7e2b445d10', facts: 11 } },

  { step: 'generate', status: 'running', ts: t0 + 14, payload: { message: 'Genome matrix: 4 angles × 2 styles × 3 personas → 8 briefs selected.' } },
  { step: 'generate', status: 'running', ts: t0 + 15, payload: { message: 'Creatives rendered and panel-scored (3-persona panel, 24 scores).', creativeIds: ['cr-g1-01', 'cr-g1-02', 'cr-g1-03', 'cr-g1-04'] } },
  { step: 'generate', status: 'done', ts: t0 + 16, payload: { creatives: 8, generation: 1 } },

  { step: 'simulate', status: 'running', ts: t0 + 17, payload: { day: 1, message: 'Flight started: 10,000 impressions/day, uniform allocation.' } },
  { step: 'simulate', status: 'running', ts: t0 + 18, payload: { day: 5, message: 'Day 5: nostalgia-reboot creatives pulling ahead on CTR.' } },
  { step: 'simulate', status: 'running', ts: t0 + 19, payload: { day: 12, message: 'Day 12: gap widening; fatigue nibbling at top performer.' } },
  { step: 'simulate', status: 'done', ts: t0 + 20, payload: { days: 20, impressions: 200000, message: 'Flight complete.' } },

  { step: 'learn', status: 'running', ts: t0 + 21, payload: { message: 'Rolling up per-dimension posteriors; testing lifts.' } },
  { step: 'learn', status: 'done', ts: t0 + 22, payload: { learnings: 3, significant: 1, headline: "'nostalgia-reboot' +142% CTR (Wilson-significant)" } },

  { step: 'writeback', status: 'running', ts: t0 + 23, payload: { factIds: ['fact-pl-01', 'fact-pl-02'], message: 'Writing 2 performance facts back into brand context.' } },
  { step: 'writeback', status: 'done', ts: t0 + 24, payload: { version: 2, hash: 'b7c42d918e6f3a05' } },

  { step: 'regenerate', status: 'running', ts: t0 + 25, payload: { message: 'Breeding gen-2 briefs from winning genomes (nostalgia-reboot forward).' } },
  { step: 'regenerate', status: 'done', ts: t0 + 26, payload: { creatives: 4, generation: 2 } },

  { step: 'verdict', status: 'done', ts: t0 + 27, payload: { winner: 'cr-g1-01', message: "Winner: 'nostalgia-reboot' × 'retro-cartoon' — +142% CTR vs portfolio. Context evolved v1 → v2." } },
];
