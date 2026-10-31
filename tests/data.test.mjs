import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKETS, DEMO_MARKETS, EXPIRIES, DEMO_EXPIRIES, makeLeg, makeStrategy,
  getChain, getDataMode, setDataMode, applyIndexQuotes, setContracts,
  getContracts, selectMarketExpiries, setChain, getOptionQuote, getStrikeOptions,
} from '../src/data.js';
import { optionPrice, expiryYears } from '../src/engine.js';

// Synthetic fixtures only: none of the numbers or contracts below are exchange data.
const BASE_DATE = '2030-01-02T06:30:00.000Z';
const EXPIRY = '2030-01-31';
const NEXT_EXPIRY = '2030-02-28';
const SPOT = 25030.5;
const STRIKES = [24925, 25025, 25125, 25225, 25425];

function contracts(expiry = EXPIRY) {
  return STRIKES.flatMap((strike, index) => ['CE', 'PE'].map(type => ({
    contractId: `NSE_FO|${type === 'CE' ? 70000 + index : 80000 + index}`,
    strike, type, expiry, lotSize: 75, exchange: 'NSE',
  })));
}

function snapshot(expiry = EXPIRY) {
  return {
    symbol: 'NIFTY', expiry, spot: SPOT, asOf: BASE_DATE,
    rows: STRIKES.map((strike, index) => ({
      strike,
      call: { contractId: `NSE_FO|${70000 + index}`, premium: 170 - index * 20, iv: 18, oi: 1000, change: 1 },
      put: { contractId: `NSE_FO|${80000 + index}`, premium: 160 + index * 20, iv: 19, oi: 2000, change: -1 },
    })),
  };
}

function loadLive() {
  setDataMode('live');
  applyIndexQuotes({ NIFTY: { spot: SPOT, change: -15, changePercent: -.06, asOf: BASE_DATE } });
  setContracts('NIFTY', contracts());
  setChain(snapshot());
  selectMarketExpiries('NIFTY', BASE_DATE);
}

test.beforeEach(() => setDataMode('demo'));
test.afterEach(() => setDataMode('demo'));

test('entering live mode removes all demo quotes, expiries and generated chains', () => {
  assert.equal(getDataMode(), 'demo');
  assert.equal(getChain().length, 17);
  setDataMode('live');
  assert.equal(getDataMode(), 'live');
  assert.deepEqual(EXPIRIES, []);
  assert.ok(MARKETS.every(market => ['spot', 'change', 'changePercent', 'lotSize', 'iv'].every(key => market[key] === null)));
  assert.deepEqual(getChain('NIFTY', EXPIRY), []);
  assert.deepEqual(getStrikeOptions('NIFTY', EXPIRY, 'CE'), []);
  assert.throws(() => makeLeg('NIFTY', EXPIRY), /No listed contracts/);
});

test('live expiry selection uses listed dates, removes duplicates and excludes settled expiries', () => {
  setDataMode('live');
  setContracts('NIFTY', [...contracts(NEXT_EXPIRY), ...contracts(EXPIRY), ...contracts('2029-12-31'), ...contracts('2030-01-02')]);
  selectMarketExpiries('NIFTY', BASE_DATE);
  assert.deepEqual(EXPIRIES.map(expiry => expiry.value), ['2030-01-02', EXPIRY, NEXT_EXPIRY]);
  selectMarketExpiries('NIFTY', '2030-01-02T10:00:00.000Z');
  assert.deepEqual(EXPIRIES.map(expiry => expiry.value), [EXPIRY, NEXT_EXPIRY]);
  selectMarketExpiries('SENSEX', BASE_DATE);
  assert.deepEqual(EXPIRIES, []);
});

test('live strike selection returns only the listed contracts for the selected expiry and type', () => {
  loadLive();
  setContracts('NIFTY', [...contracts(), { contractId: 'NSE_FO|90000', expiry: NEXT_EXPIRY, strike: 26075, type: 'CE', lotSize: 40, exchange: 'NSE' }]);
  assert.deepEqual(getStrikeOptions('NIFTY', EXPIRY, 'CE'), STRIKES);
  assert.deepEqual(getStrikeOptions('NIFTY', NEXT_EXPIRY, 'CE'), [26075]);
  assert.deepEqual(getStrikeOptions('NIFTY', NEXT_EXPIRY, 'PE'), []);
  assert.equal(getChain('NIFTY', EXPIRY).length, STRIKES.length);
  assert.deepEqual(getChain('BANKNIFTY', EXPIRY), []);
});

test('default live legs choose the nearest strike while explicit selections require an exact listed strike', () => {
  loadLive();
  assert.equal(makeLeg('NIFTY', EXPIRY).strike, 25025);
  assert.throws(() => makeLeg('NIFTY', EXPIRY, { strike: 25010 }), /not listed/);
  const leg = makeLeg('NIFTY', EXPIRY, { strike: 25025, type: 'CE', side: 'sell', lots: 3, enabled: false });
  assert.equal(leg.strike, 25025);
  assert.equal(leg.contractId, 'NSE_FO|70001');
  assert.equal(leg.premium, 150);
  assert.equal(leg.iv, 18);
  assert.equal(leg.ivSource, 'provider');
  assert.equal(leg.lotSize, 75);
  assert.equal(leg.quantityUnits, 225);
  assert.equal(leg.side, 'sell');
  assert.equal(leg.enabled, false);
  assert.equal(leg.exchange, 'NSE');
  assert.equal(leg.entryPriceSource, 'upstox');
  assert.ok(Number.isFinite(Date.parse(leg.entryAt)));
});

test('a preset with a missing listed wing fails instead of collapsing to a repeated strike', () => {
  setDataMode('live');
  applyIndexQuotes({ NIFTY: { spot: SPOT, change: 0, changePercent: 0, asOf: BASE_DATE } });
  setContracts('NIFTY', [{ contractId: 'NSE_FO|70000', strike: 25000, type: 'CE', expiry: EXPIRY, lotSize: 75, exchange: 'NSE' }]);
  setChain({ symbol: 'NIFTY', expiry: EXPIRY, spot: SPOT, asOf: BASE_DATE, rows: [{ strike: 25000, call: { premium: 200, iv: 18 }, put: null }] });
  assert.equal(makeLeg('NIFTY', EXPIRY).strike, 25000);
  assert.throws(() => makeStrategy('bull-call', 'NIFTY', EXPIRY), /not listed/);
  assert.deepEqual(getStrikeOptions('NIFTY', EXPIRY, 'CE'), [25000]);
});

test('missing and nonfinite live quotes never fall back to a theoretical or demo premium', () => {
  loadLive();
  const missing = snapshot();
  missing.rows[1].call = null;
  setChain(missing);
  assert.equal(getOptionQuote('NIFTY', EXPIRY, 25025, 'CE'), null);
  assert.throws(() => makeLeg('NIFTY', EXPIRY, { strike: 25025 }), /No market price/);
  missing.rows[1].call = { premium: NaN, iv: 18 };
  setChain(missing);
  assert.throws(() => makeLeg('NIFTY', EXPIRY, { strike: 25025, premium: 123 }), /No market price/);
  assert.throws(() => makeLeg('NIFTY', NEXT_EXPIRY), /No listed contracts/);
});

test('a real zero premium remains zero instead of receiving the demo premium floor', () => {
  loadLive();
  const zero = snapshot(); zero.rows[1].call.premium = 0;
  setChain(zero);
  assert.equal(makeLeg('NIFTY', EXPIRY, { strike: 25025 }).premium, 0);
});

test('missing provider IV is calibrated to the actual premium at the current valuation time', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(BASE_DATE) });
  loadLive();
  const calibrated = snapshot();
  calibrated.rows[1].call.iv = null;
  calibrated.rows[1].call.premium = optionPrice(SPOT, 25025, expiryYears(EXPIRY, BASE_DATE), .245, .06, 'CE');
  setChain(calibrated);
  const leg = makeLeg('NIFTY', EXPIRY, { strike: 25025 });
  assert.equal(leg.ivSource, 'calibrated');
  assert.ok(Math.abs(leg.iv - 24.5) < .001);
  assert.equal(leg.premium, calibrated.rows[1].call.premium);
  assert.equal(leg.entryAt, BASE_DATE);
});

test('an impossible market premium preserves the actual entry and marks IV unavailable', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(BASE_DATE) });
  loadLive();
  const impossible = snapshot();
  impossible.rows[1].call.iv = null;
  impossible.rows[1].call.premium = SPOT + 100;
  setChain(impossible);
  const leg = makeLeg('NIFTY', EXPIRY, { strike: 25025 });
  assert.equal(leg.premium, SPOT + 100);
  assert.equal(leg.iv, null);
  assert.equal(leg.ivSource, 'unavailable');
  assert.equal(leg.entryPriceSource, 'upstox');
});

test('out-of-range provider IV becomes unavailable without changing the actual quote', () => {
  loadLive();
  for (const iv of [.05, 300.01, 400]) {
    const invalidIv = snapshot(); invalidIv.rows[1].call.iv = iv;
    setChain(invalidIv);
    const leg = makeLeg('NIFTY', EXPIRY, { strike: 25025 });
    assert.equal(leg.premium, 150);
    assert.equal(leg.iv, null);
    assert.equal(leg.ivSource, 'unavailable');
  }
  for (const iv of [.1, 300]) {
    const validIv = snapshot(); validIv.rows[1].call.iv = iv;
    setChain(validIv);
    const leg = makeLeg('NIFTY', EXPIRY, { strike: 25025 });
    assert.equal(leg.iv, iv);
    assert.equal(leg.ivSource, 'provider');
  }
});

test('switching to demo restores every frozen example and re-entering live discards old caches', () => {
  const original = structuredClone(MARKETS);
  const oldPremium = makeLeg().premium;
  loadLive();
  assert.equal(MARKETS[0].lotSize, 75);
  assert.equal(MARKETS[0].spot, SPOT);
  setDataMode('demo');
  assert.deepEqual(MARKETS, original);
  assert.deepEqual(MARKETS, DEMO_MARKETS);
  assert.deepEqual(EXPIRIES, DEMO_EXPIRIES);
  assert.equal(makeLeg().premium, oldPremium);
  assert.equal(makeLeg().entryPriceSource, 'legacy-demo');
  assert.equal(getChain().length, 17);
  setDataMode('live');
  assert.deepEqual(getContracts('NIFTY'), []);
  assert.deepEqual(getChain('NIFTY', EXPIRY), []);
  assert.equal(getOptionQuote('NIFTY', EXPIRY, 25025, 'CE'), null);
  assert.deepEqual(getStrikeOptions('NIFTY', EXPIRY, 'CE'), []);
  assert.throws(() => setDataMode('hybrid'), /Unknown data mode/);
});
