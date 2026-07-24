// Categorical series colors for the 8 ads, stepped for the dark surface and
// validated (lightness band, chroma, CVD separation, ≥3:1 contrast on #101412).
// Fixed slot order is the colorblind-safety mechanism — never re-sort.
export const AD_SERIES_COLORS = [
  '#3987e5', // blue
  '#d95926', // orange
  '#199e70', // aqua
  '#c98500', // yellow
  '#d55181', // magenta
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
] as const;

export const adColor = (index: number) => AD_SERIES_COLORS[index % AD_SERIES_COLORS.length];

// Recessive chart chrome on the dark surface.
export const CHART_CHROME = {
  grid: '#242b28',
  axisLine: '#383835',
  label: '#8a938e',
  tooltipBg: '#171c1a',
  tooltipBorder: '#242b28',
} as const;
