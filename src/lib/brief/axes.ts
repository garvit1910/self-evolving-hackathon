/**
 * Shared genome axis vocabulary — the ONE source. composeBriefs picks per-brief
 * values; expandGenomes fans out across the pools. Both must read from this
 * single list — angle/style strings are attribution keys, and two drifting
 * copies of the vocabulary would silently corrupt attribution.
 *
 * Values are Track G's originals: the fixtures, livesim, and learnings were
 * built on these exact strings (byte-equal attribution), so the merge kept
 * them and retired the branch's placeholder vocabulary.
 */

export const DEFAULT_ANGLES = [
  'problem-solution',
  'social-proof',
  'feature-flex',
  'lifestyle-aspiration',
];

export const DEFAULT_STYLES = ['retro-cartoon', 'clean-clinical'];

export const DEFAULT_PERSONAS = [
  'value-conscious shopper',
  'busy professional',
  'brand enthusiast',
];
