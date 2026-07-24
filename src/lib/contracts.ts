// Shared contracts — Track A (agents/integrations) and Track G (UI/simulator)
// both build against these. DO NOT add fields to the core types; if something
// is missing, leave a TODO comment instead.

export type Brand = {
  id: string;
  url: string;
  name: string;
  productImageUrl: string;
  contextVersion: number;
  contextHash: string;
  sensoSourceIds: string[];
};

export type Fact = {
  id: string;
  brandId: string;
  section: 'positioning' | 'value_prop' | 'voice' | 'compliance' | 'persona' | 'market_prior';
  statement: string;
  sourceUrl?: string;
  sourceQuote?: string;
  confidence: number;
  origin: 'research' | 'performance_loop';
};

export type Genome = {
  angle: string;
  persona: string;
  hook: string;
  style: string;
  generation: 1 | 2;
}; // angle strings are attribution keys — never rephrase them

export type Creative = {
  id: string;
  briefId: string;
  brandId: string;
  imageUrl: string;
  copy: string;
  genome: Genome;
  status: 'live' | 'retired';
  publishedAdId: string;
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

// Fixture stand-in for the LLM persona panel; a real panel replaces the
// fixture file later, this shape stays.
export type PanelScore = {
  creativeId: string;
  persona: string;
  appealScore: number; // 0–100
  reason: string;
};

// Every page reads through this interface only. FixtureDataSource backs the
// offline demo; Track A adds a DB-backed implementation without touching UI.
export interface DataSource {
  getBrand(): Promise<Brand>;
  /** contextVersion 2 includes origin:'performance_loop' facts (v1→v2 diff). */
  getFacts(contextVersion?: number): Promise<Fact[]>;
  getCreatives(): Promise<Creative[]>;
  getMetrics(): Promise<DailyMetrics[]>;
  getLearnings(): Promise<Learning[]>;
  getPanelScores(): Promise<PanelScore[]>;
  /** Full event stream for a run; UI replays it client-side with delays. */
  getAutopilotEvents(): Promise<AutopilotEvent[]>;
}
