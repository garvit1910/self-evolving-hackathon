// Drizzle schema mirroring src/lib/contracts.ts 1:1, for Track A to wire to
// Supabase later. Nothing imports this at runtime; no migrations run in the
// fixture demo. TODO(track-a): indexes, RLS policies, drizzle-kit config.

import { pgTable, text, integer, real, jsonb, boolean, bigint } from 'drizzle-orm/pg-core';

export const brands = pgTable('brands', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  name: text('name').notNull(),
  productImageUrl: text('product_image_url').notNull(),
  contextVersion: integer('context_version').notNull(),
  contextHash: text('context_hash').notNull(),
  sensoSourceIds: jsonb('senso_source_ids').$type<string[]>().notNull(),
});

export const facts = pgTable('facts', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull(),
  section: text('section', {
    enum: ['positioning', 'value_prop', 'voice', 'compliance', 'persona', 'market_prior'],
  }).notNull(),
  statement: text('statement').notNull(),
  sourceUrl: text('source_url'),
  sourceQuote: text('source_quote'),
  confidence: real('confidence').notNull(),
  origin: text('origin', { enum: ['research', 'performance_loop'] }).notNull(),
});

export const creatives = pgTable('creatives', {
  id: text('id').primaryKey(),
  briefId: text('brief_id').notNull(),
  brandId: text('brand_id').notNull(),
  imageUrl: text('image_url').notNull(),
  copy: text('copy').notNull(),
  genome: jsonb('genome')
    .$type<{ angle: string; persona: string; hook: string; style: string; generation: 1 | 2 }>()
    .notNull(),
  status: text('status', { enum: ['live', 'retired'] }).notNull(),
  publishedAdId: text('published_ad_id').notNull(),
  arm: jsonb('arm').$type<{ alpha: number; beta: number; pulls: number }>().notNull(),
});

export const dailyMetrics = pgTable('daily_metrics', {
  adId: text('ad_id').notNull(),
  day: integer('day').notNull(),
  impressions: integer('impressions').notNull(),
  clicks: integer('clicks').notNull(),
  purchases: integer('purchases').notNull(),
  spend: real('spend').notNull(),
  purchaseValue: real('purchase_value').notNull(),
});

export const dimensionPosteriors = pgTable('dimension_posteriors', {
  dimension: text('dimension', { enum: ['angle', 'persona', 'hook', 'style'] }).notNull(),
  value: text('value').notNull(),
  alpha: real('alpha').notNull(),
  beta: real('beta').notNull(),
  spend: real('spend').notNull(),
  impressions: integer('impressions').notNull(),
});

export const learnings = pgTable('learnings', {
  id: text('id').primaryKey(),
  brandId: text('brand_id').notNull(),
  statement: text('statement').notNull(),
  stats: jsonb('stats')
    .$type<{ dimension: string; value: string; lift: number; n: number; ciLow: number; ciHigh: number }>()
    .notNull(),
  sensoIngested: boolean('senso_ingested').notNull(),
});

export const autopilotEvents = pgTable('autopilot_events', {
  step: text('step', {
    enum: ['research', 'context', 'generate', 'simulate', 'learn', 'writeback', 'regenerate', 'verdict'],
  }).notNull(),
  status: text('status', { enum: ['running', 'done', 'failed'] }).notNull(),
  payload: jsonb('payload'),
  ts: bigint('ts', { mode: 'number' }).notNull(),
});
