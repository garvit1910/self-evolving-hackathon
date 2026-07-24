/**
 * FROZEN CONTRACTS — the seam between Track A (backend) and Track G (frontend/sim).
 * Do NOT change a type here without both people at one keyboard.
 *
 * `angle` strings are attribution keys — NEVER rephrase them anywhere downstream.
 */

export type Brand = {
  id: string;
  url: string;
  name: string;
  productImageUrl: string;
  contextVersion: number;
  contextHash: string;
  sensoSourceIds: string[];
};

export type FactSection =
  | 'positioning'
  | 'value_prop'
  | 'voice'
  | 'compliance'
  | 'persona'
  | 'market_prior';

export type Fact = {
  id: string;
  brandId: string;
  section: FactSection;
  statement: string;
  sourceUrl?: string;
  sourceQuote?: string;
  confidence: number;
  origin: 'research' | 'performance_loop'; // origin drives the v1→v2 diff UI
};

export type Persona = {
  id: string;
  brandId: string;
  name: string;
  summary: string;
  pains: string[];
  desires: string[];
  objections: string[];
  factIds: string[]; // grounding: which facts this persona references
};

export type Genome = {
  angle: string; // attribution key — NEVER rephrase
  persona: string;
  hook: string;
  style: string;
  generation: 1 | 2;
};

export type Creative = {
  id: string; // `${runId}-c${n}` deterministic
  briefId: string;
  brandId: string;
  imageUrl: string;
  copy: string;
  genome: Genome;
  status: 'live' | 'retired';
  publishedAdId: string; // `sim-${id}`
  arm: { alpha: number; beta: number; pulls: number };
};

export type DailyMetrics = {
  adId: string;
  day: number;
  impressions: number;
  clicks: number;
  purchases: number;
  spend: number;
  purchaseValue: number;
};

export type DimensionPosterior = {
  dimension: 'angle' | 'persona' | 'hook' | 'style';
  value: string;
  alpha: number;
  beta: number;
  spend: number;
  impressions: number;
};

export type Learning = {
  id: string;
  brandId: string;
  statement: string;
  stats: {
    dimension: string;
    value: string;
    lift: number;
    n: number;
    ciLow: number;
    ciHigh: number;
  };
  sensoIngested: boolean;
};

export type AutopilotEvent = {
  step:
    | 'research'
    | 'context'
    | 'generate'
    | 'simulate'
    | 'learn'
    | 'writeback'
    | 'regenerate'
    | 'verdict';
  status: 'running' | 'done' | 'failed';
  payload?: unknown;
  ts: number;
};

/* ------------------------------------------------------------------ *
 * composeBrief I/O — this is the load-bearing contract.
 * Every adapter must return shapes that feed BriefInput.
 * ------------------------------------------------------------------ */

export type Brief = {
  id: string; // `${runId}-brief-g${generation}`
  brandId: string;
  contextHash: string; // provenance: which compiled context produced this
  generation: 1 | 2;
  angle: string;
  persona: string;
  coreMessage: string;
  hooks: string[];
  cta: string;
  style: string;
  compliance: string[];
  priorProvenance: string[]; // which learnings/priors shaped this brief (empty for gen-1)
};

/** A prior sampled from performance posteriors (empty for gen-1). */
export type Prior = {
  dimension: 'angle' | 'persona' | 'hook' | 'style';
  value: string; // VERBATIM genome value
  weight: number;
};

/** Everything composeBrief consumes. A sponsor "counts" only when it fills a field here. */
export type BriefInput = {
  runId: string;
  brand: Brand;
  generation: 1 | 2;
  facts: Fact[]; // from Senso search (context store)
  personas: Persona[]; // from research swarm
  topKChunks: string[]; // from Actian vector top-k retrieval
  priors: Prior[]; // sampled from posteriors (empty gen-1)
};
