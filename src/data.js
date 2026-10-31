import { DEMO_DATE, expiryYears, optionPrice, impliedVolatility } from './engine.js';

// Illustrative market data, not exchange quotes or current contract specifications.
export const MARKETS = [
  { symbol: 'NIFTY', name: 'Nifty 50', spot: 24530.9, change: 132.65, changePercent: 0.54, lotSize: 65, step: 50, iv: 14.2 },
  { symbol: 'BANKNIFTY', name: 'Nifty Bank', spot: 56780.3, change: 218.4, changePercent: 0.39, lotSize: 30, step: 100, iv: 17.5 },
  { symbol: 'SENSEX', name: 'BSE Sensex', spot: 80312.5, change: 427.9, changePercent: 0.54, lotSize: 20, step: 100, iv: 13.8 },
];

export const DEMO_MARKETS = structuredClone(MARKETS);

export const EXPIRIES = [
  { value: '2026-10-30', label: '30 Oct 2026', short: '30 Oct' },
  { value: '2026-11-06', label: '06 Nov 2026', short: '06 Nov' },
  { value: '2026-11-27', label: '27 Nov 2026', short: '27 Nov' },
];

export const DEMO_EXPIRIES = structuredClone(EXPIRIES);
let mode = 'demo';
const contractCache = new Map();
const chainCache = new Map();

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
  if (mode === 'live') return makeMarketLeg(instrument, expiry, overrides);
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
    lotSize: instrument.lotSize,
    quantityUnits: (overrides.lots ?? 1) * instrument.lotSize,
    entryPriceSource: 'legacy-demo',
    ivSource: 'manual',
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

export function getChain(market = MARKETS[0], expiry = EXPIRIES[0]?.value) {
  const instrument = resolveMarket(market);
  if (mode === 'live') {
    const rows = chainCache.get(`${instrument.symbol}|${expiry}`)?.rows || [];
    const nearest = rows.reduce((best, row, i) => Math.abs(row.strike - instrument.spot) < Math.abs(rows[best].strike - instrument.spot) ? i : best, 0);
    return rows.slice(Math.max(0, nearest - 12), nearest + 13);
  }
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


/** Demo and authenticated market data are deliberately separate. */
export function getDataMode() { return mode; }
export function setDataMode(next) {
  if (!['demo', 'live'].includes(next)) throw new Error('Unknown data mode.');
  mode = next;
  MARKETS.splice(0, MARKETS.length, ...structuredClone(DEMO_MARKETS).map(m => next === 'demo' ? m : {...m, spot:null, change:null, changePercent:null, lotSize:null, iv:null, asOf:null, quoteAvailable:false}));
  EXPIRIES.splice(0, EXPIRIES.length, ...(next === 'demo' ? structuredClone(DEMO_EXPIRIES) : []));
  if (next === 'live') { contractCache.clear(); chainCache.clear(); }
}
export function applyIndexQuotes(indices) {
  for (const m of MARKETS) {
    const quote = indices[m.symbol];
    if (!quote || !Number.isFinite(quote.spot)) { m.quoteAvailable=false; continue; }
    Object.assign(m, quote, {quoteAvailable:true});
  }
}
export function setContracts(symbol, contracts) { contractCache.set(symbol, contracts); }
export function getContracts(symbol) { return contractCache.get(symbol) || []; }
export function selectMarketExpiries(symbol, now = new Date().toISOString()) {
  if (mode === 'demo') return;
  const dates = [...new Set(getContracts(symbol).filter(c => Date.parse(c.expiry+'T10:00:00Z') > Date.parse(now)).map(c => c.expiry))].sort();
  EXPIRIES.splice(0, EXPIRIES.length, ...dates.map(value => ({value, label:new Date(value+'T00:00:00Z').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}), short:new Date(value+'T00:00:00Z').toLocaleDateString('en-IN',{day:'2-digit',month:'short',timeZone:'Asia/Kolkata'})})));
}
export function setChain(snapshot) {
  chainCache.set(`${snapshot.symbol}|${snapshot.expiry}`, snapshot);
  const m = resolveMarket(snapshot.symbol);
  if (Number.isFinite(snapshot.spot)) m.spot = snapshot.spot;
  const contracts = getContracts(snapshot.symbol).filter(c => c.expiry === snapshot.expiry);
  const lotSizes = [...new Set(contracts.map(c => c.lotSize))];
  m.lotSize = lotSizes.length === 1 ? lotSizes[0] : null;
  const strikes = [...new Set(contracts.map(c => c.strike))].sort((a,b)=>a-b);
  if (strikes.length > 1) m.step = Math.min(...strikes.slice(1).map((v,i)=>v-strikes[i]));
  const ivs = [...snapshot.rows].sort((a,b)=>Math.abs(a.strike-m.spot)-Math.abs(b.strike-m.spot)).slice(0,5).flatMap(row => [row.call?.iv,row.put?.iv]).filter(v=>Number.isFinite(v)&&v>=.1&&v<=300);
  m.iv = ivs.length ? ivs.sort((a,b)=>a-b)[Math.floor(ivs.length/2)] : null;
}
export function getOptionQuote(symbol, expiry, strike, type) {
  const row = chainCache.get(`${symbol}|${expiry}`)?.rows.find(row => row.strike === strike);
  return row?.[type === 'CE' ? 'call' : 'put'] || null;
}
export function getStrikeOptions(symbol, expiry, type) {
  if (mode === 'live') return [...new Set(getContracts(symbol).filter(c=>c.expiry===expiry&&c.type===type).map(c=>c.strike))].sort((a,b)=>a-b);
  const m=resolveMarket(symbol), atm=Math.floor(m.spot/m.step)*m.step;
  return Array.from({length:61},(_,i)=>atm+(i-30)*m.step).filter(k=>k>0);
}
function makeMarketLeg(market, expiry, overrides) {
  const type = overrides.type || 'CE', selectedExpiry = overrides.expiry || expiry;
  const options=getContracts(market.symbol).filter(c=>c.expiry===selectedExpiry&&c.type===type);
  if (!options.length) throw new Error('No listed contracts are available for this index, expiry and type.');
  const target=overrides.strike??market.spot;
  const contract=overrides.strike===undefined?options.reduce((best,c)=>Math.abs(c.strike-target)<Math.abs(best.strike-target)?c:best,options[0]):options.find(c=>c.strike===overrides.strike);
  if(!contract)throw new Error('This strategy needs a strike that is not listed for the selected expiry. Choose listed contracts from the chain instead.');
  const quote=getOptionQuote(market.symbol,selectedExpiry,contract.strike,type);
  if (!quote || !Number.isFinite(quote.premium)) throw new Error('No market price is available for that contract. Refresh the chain or choose another strike.');
  const calibrated=Number.isFinite(quote.iv)&&quote.iv>0 ? null : impliedVolatility(quote.premium,market.spot,contract.strike,expiryYears(selectedExpiry,new Date().toISOString()),.06,type);
  const candidateIv=Number.isFinite(quote.iv)&&quote.iv>0 ? quote.iv : Number.isFinite(calibrated)&&calibrated>0 ? calibrated*100 : null;
  const iv=Number.isFinite(candidateIv)&&candidateIv>=.1&&candidateIv<=300?candidateIv:null;
  const lots=overrides.lots??1;
  return {
    id:overrides.id||`leg-${Date.now().toString(36)}-${(++nextId).toString(36)}`,
    side:overrides.side||'buy',type,strike:contract.strike,expiry:selectedExpiry,lots,
    premium:overrides.premium??quote.premium,iv,
    enabled:overrides.enabled??true,contractId:contract.contractId,
    lotSize:contract.lotSize,quantityUnits:lots*contract.lotSize,exchange:contract.exchange,expiresAt:selectedExpiry+'T10:00:00Z',
    entryPriceSource:'upstox',entryAt:new Date().toISOString(),
    ivSource:iv===null?'unavailable':Number.isFinite(quote.iv)&&quote.iv>0?'provider':'calibrated'
  };
}
