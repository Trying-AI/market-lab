// One-time closing levels, as reported on the corresponding Upstox index pages.
export const indexCloseDate = '2026-11-23';
export const indexCloses = {
  NIFTY: { spot: 25349.65, change: -450.95, changePercent: -1.75 },
  BANKNIFTY: { spot: 62585.35, change: -2049.85, changePercent: -3.17 },
  SENSEX: { spot: 82435.99, change: -1483.72, changePercent: -1.77 },
};
export const indexSources = {
  NIFTY: 'https://upstox.com/indices/nifty-50-share-price/',
  BANKNIFTY: 'https://upstox.com/indices/nifty-bank-share-price/',
  SENSEX: 'https://upstox.com/indices/sensex-share-price/',
};
