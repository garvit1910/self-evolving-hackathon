/**
 * Shared genome axis vocabulary. composeBrief picks ONE value per axis;
 * expandGenomes fans out across all of them. Both must read from this single
 * list — `angle` and `style` are attribution keys, and two drifting copies of
 * the vocabulary would silently corrupt attribution.
 */

export const DEFAULT_ANGLES = ['Comparison', 'Nostalgia', 'Health', 'Convenience'];
export const DEFAULT_STYLES = ['bold-flatlay', 'lifestyle', 'macro-texture', 'retro-pop'];
