/**
 * Adapter interfaces — one per sponsor capability.
 * Rule: mock is the DEFAULT resting state; a real adapter is an opt-in upgrade
 * that must satisfy the SAME interface. A sponsor "counts as integrated" only
 * when composeBrief consumes its output (see BriefInput in contracts).
 *
 * Each real adapter should later be wrapped in a LIVE/RECORD/REPLAY shim so the
 * golden demo replays from tape. Mocks make that shim optional for the demo.
 */

import type { Fact, Persona } from '@/lib/contracts';

/** Senso — context layer: ingest sources → compiled KB → search + writeback. */
export interface ContextStore {
  ingest(sources: { title: string; text: string }[]): Promise<{ sourceIds: string[]; contextHash: string }>;
  search(query: string, k: number): Promise<Fact[]>;
  /** writeback of performance learnings = context evolution (v1 → v2). */
  writeback(learningMarkdown: string): Promise<{ sourceId: string; contextHash: string }>;
}

/** Pioneer/Fastino — OpenAI-compatible LLM. Prefer structured extraction over generic chat. */
export interface LLM {
  /** structured extraction — the credibility-critical path (typed output, not chat). */
  extract<T>(prompt: string, schemaHint: string): Promise<T>;
  complete(prompt: string): Promise<string>;
}

/** Actian VectorAI DB — local vector store, hot retrieval path. */
export interface VectorStore {
  upsert(items: { id: string; text: string; vector?: number[] }[]): Promise<void>;
  topK(query: string, k: number): Promise<{ id: string; text: string; score: number }[]>;
}

/** Band — real-time agent room feed. */
export interface Feed {
  join(room: string): Promise<void>;
  post(room: string, event: { agent: string; kind: string; payload: unknown }): Promise<void>;
}

/** Guild — governance decorator. Real only if it can OBSERVABLY block something. */
export interface Governance {
  /** returns false to deny; reason surfaces in the feed. */
  approve(action: string, ctx: Record<string, unknown>): Promise<{ ok: boolean; reason?: string }>;
}

/** Gemini — image generation with a product reference image. */
export interface ImageGen {
  generate(prompt: string, refImageUrl: string): Promise<{ imageUrl: string }>;
}

/** The research swarm depends on LLM + Feed; kept explicit for wiring clarity. */
export interface ResearchDeps {
  llm: LLM;
  feed: Feed;
  governance: Governance;
}

export type PersonaOutput = { personas: Persona[] };
