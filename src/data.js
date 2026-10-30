import { DEMO_DATE, expiryYears, optionPrice } from './engine.js';

// Illustrative market data, not exchange quotes or current contract specifications.
export const MARKETS = [
  { symbol: 'NIFTY', name: 'Nifty 50', spot: 24530.9, change: 132.65, changePercent: 0.54, lotSize: 65, step: 50, iv: 14.2 },
  { symbol: 'BANKNIFTY', name: 'Nifty Bank', spot: 56780.3, change: 218.4, changePercent: 0.39, lotSize: 30, step: 100, iv: 17.5 },
  { symbol: 'SENSEX', name: 'BSE Sensex', spot: 80312.5, change: 427.9, changePercent: 0.54, lotSize: 20, step: 100, iv: 13.8 },
];

export const EXPIRIES = [
  { value: '2026-10-30', label: '30 Oct 2026', short: '30 Oct' },
  { value: '2026-11-06', label: '06 Nov 2026', short: '06 Nov' },
  { value: '2026-11-27', label: '27 Nov 2026', short: '27 Nov' },
];

export const STRATEGIES = [
  { id: 'bull-call', name: 'Bull call spread', outlook: 'Bullish', level: 'Beginner', kind: 'bull-call', description: 'A measured rise, with a defined cost and reward.', points: '2,34 24,34 48,10 70,10' },
  { id: 'bull-put', name: 'Bull put spread', outlook: 'Bullish', level: 'Intermediate', kind: 'bull-put', description: 'Collect a credit when the market holds its ground.', points: '2,34 22,34 46,10 70,10' },
  { id: 'bear-put', name: 'Bear put spread', outlook: 'Bearish', level: 'Beginner', kind: 'bear-put', description: 'Express a downside view with a defined risk.', points: '2,10 24,10 48,34 70,34' },
  { id: 'bear-call', name: 'Bear call spread', outlook: 'Bearish', level: 'Intermediate', kind: 'bear-call', description: 'Collect a credit if the market stays below your strikes.', points: '2,10 24,10 48,34 70,34' },
  { id: 'long-call', name: 'Long call', outlook: 'Bullish', level: 'Beginner', kind: 'long-call', description: 'Explore an upside move with a premium you control.', points: '2,34 30,34 70,4' },
  { id: 'long-put', name: 'Long put', outlook: 'Bearish', level: 'Beginner', kind: 'long-put', description: 'Explore a downside move with a fixed premium risk.', points: '2,4 42,34 70,34' },
  { id: 'iron-condor', name: 'Iron condor', outlook: 'Neutral', level: 'Intermediate', kind: 'iron-condor', description: 'Build a defined-risk range around the market.', points: '2,34 14,34 25,10 47,10 58,34 70,34' },
  { id: 'butterfly', name: 'Call butterfly', outlook: 'Neutral', level: 'Intermediate', kind: 'butterfly', description: 'Target an expiry close to your chosen middle strike.', points: '2,34 14,34 36,7 58,34 70,34' },
  { id: 'long-straddle', name: 'Long straddle', outlook: 'Volatile', level: 'Intermediate', kind: 'long-straddle', description: 'Explore a large move in either direction.', points: '2,5 36,35 70,5' },
  { id: 'long-strangle', name: 'Long strangle', outlook: 'Volatile', level: 'Intermediate', kind: 'long-strangle', description: 'Use wider strikes to explore a bigger breakout.', points: '2,5 24,35 48,35 70,5' },
];

const round = (value, precision = 2) => Number(value.toFixed(precision));
let nextId = 0;

function resolveMarket(market) {
  if (typeof market === 'string') return MARKETS.find((entry) => entry.symbol === market) || MARKETS[0];
  return market || MARKETS[0];
}

function atTheMoney(market) {
  return Math.floor(market.spot / market.step) * market.step;
}

function strikeIv(market, strike, type) {
  const distance = (strike - market.spot) / market.spot;
  // A gentle, deterministic volatility smile makes the sample chain useful to explore.
  return round(Math.max(5, market.iv + Math.abs(distance) * 28 - distance * (type === 'PE' ? 18 : 10)));
}

function premiumFor(market, strike, expiry, iv, type) {
  return round(Math.max(0.05, optionPrice(market.spot, strike, expiryYears(expiry, DEMO_DATE), iv / 100, 0.06, type)));
}

export function makeLeg(market = MARKETS[0], expiry = EXPIRIES[0].value, overrides = {}) {
  const instrument = resolveMarket(market);
  const strike = overrides.strike ?? atTheMoney(instrument);
  const type = overrides.type ?? 'CE';
  const legExpiry = overrides.expiry ?? expiry;
  const iv = overrides.iv ?? strikeIv(instrument, strike, type);
  return {
    id: `leg-${Date.now().toString(36)}-${(++nextId).toString(36)}`,
    side: 'buy',
    lots: 1,
    enabled: true,
    ...overrides,
    type,
    strike,
    expiry: legExpiry,
    iv,
    premium: overrides.premium ?? premiumFor(instrument, strike, legExpiry, iv, type),
  };
}

export function makeStrategy(presetId = 'bull-call', market = MARKETS[0], expiry = EXPIRIES[0].value) {
  const instrument = resolveMarket(market);
  const atm = atTheMoney(instrument);
  const wing = instrument.step * 6;
  const leg = (side, type, strike, lots = 1) => makeLeg(instrument, expiry, { side, type, strike, lots });
  switch (presetId) {
    case 'bull-put':
      return [leg('sell', 'PE', atm), leg('buy', 'PE', atm - wing)];
    case 'bear-put':
      return [leg('buy', 'PE', atm), leg('sell', 'PE', atm - wing)];
    case 'bear-call':
      return [leg('sell', 'CE', atm), leg('buy', 'CE', atm + wing)];
    case 'long-call':
      return [leg('buy', 'CE', atm)];
    case 'long-put':
      return [leg('buy', 'PE', atm)];
    case 'iron-condor':
      return [
        leg('buy', 'PE', atm - instrument.step * 8),
        leg('sell', 'PE', atm - instrument.step * 4),
        leg('sell', 'CE', atm + instrument.step * 4),
        leg('buy', 'CE', atm + instrument.step * 8),
      ];
    case 'butterfly':
      return [leg('buy', 'CE', atm - wing), leg('sell', 'CE', atm, 2), leg('buy', 'CE', atm + wing)];
    case 'long-straddle':
      return [leg('buy', 'CE', atm), leg('buy', 'PE', atm)];
    case 'long-strangle':
      return [leg('buy', 'PE', atm - instrument.step * 4), leg('buy', 'CE', atm + instrument.step * 4)];
    case 'bull-call':
    default:
      return [leg('buy', 'CE', atm), leg('sell', 'CE', atm + wing)];
  }
}

export function getChain(market = MARKETS[0], expiry = EXPIRIES[0].value) {
  const instrument = resolveMarket(market);
  const atm = atTheMoney(instrument);
  return Array.from({ length: 17 }, (_, index) => {
    const distance = index - 8;
    const strike = atm + distance * instrument.step;
    const quote = (type) => {
      const isCall = type === 'CE';
      const iv = strikeIv(instrument, strike, type);
      const directional = isCall ? distance : -distance;
      return {
        premium: premiumFor(instrument, strike, expiry, iv, type),
        iv,
        oi: Math.round((18 + (8 - Math.abs(distance)) * 3.2 + ((index * (isCall ? 7 : 11)) % 13) + Math.max(0, directional) * 1.6) * 100000),
        change: round((isCall ? 1 : -1) * (1.4 + index * 0.47) + Math.sin(index * 1.8) * 2.1),
      };
    };
    return { strike, call: quote('CE'), put: quote('PE') };
  });
}
