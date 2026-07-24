// Display formatters. Locale is pinned to en-US so server and client render
// identical strings (hydration safety).

export const fmtInt = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 0 });

export const fmtMoney = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtPct = (x: number, digits = 2) => (x * 100).toFixed(digits) + '%';

/** Signed percent for lifts: 1.42 → "+142%", -0.11 → "−11%". */
export const fmtLift = (x: number) =>
  (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(0) + '%';

export const fmtRoas = (x: number) => x.toFixed(2) + '×';

export const shortHash = (hash: string) => '#' + hash.slice(0, 4) + '…';
