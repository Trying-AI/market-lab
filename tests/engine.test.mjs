import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStrategy, daysToExpiry, DEMO_DATE, expiryPayoff, impliedVolatility, legUnits, markToMarket, normalCDF, optionGreeks, optionPrice, scenarioPayoff } from '../src/engine.js';

const close = (actual, expected, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);
const leg = (overrides = {}) => ({ id: 'test', side: 'buy', type: 'CE', strike: 100, expiry: '2026-11-26', lots: 1, premium: 5, iv: 20, enabled: true, ...overrides });

test('normal CDF is symmetric and handles limits', () => {
  close(normalCDF(0), 0.5);
  close(normalCDF(1.96), 0.9750021, 1e-6);
  close(normalCDF(-1.96) + normalCDF(1.96), 1);
  assert.equal(normalCDF(Infinity), 1);
  assert.equal(normalCDF(-Infinity), 0);
});

test('Black–Scholes known price and put-call parity', () => {
  const call = optionPrice(100, 100, 1, 0.2, 0.05, 'CE');
  const put = optionPrice(100, 100, 1, 0.2, 0.05, 'PE');
  close(call, 10.45058, 2e-5);
  close(put, 5.57352, 2e-5);
  close(call - put, 100 - 100 * Math.exp(-0.05));
});

test('expiry, zero volatility and zero underlying have finite exact values', () => {
  assert.equal(optionPrice(120, 100, 0, 0.2, 0.05, 'CE'), 20);
  assert.equal(optionPrice(80, 100, -1, 0.2, 0.05, 'PE'), 20);
  close(optionPrice(100, 100, 1, 0, 0.05, 'CE'), 100 - 100 * Math.exp(-0.05));
  close(optionPrice(0, 100, 1, 0.2, 0.05, 'PE'), 100 * Math.exp(-0.05));
  assert.equal(optionPrice(100, 0, 1, 0.2, 0.05, 'CE'), 100);
  assert.throws(() => optionPrice(-1, 100, 1, 0.2, 0.05, 'CE'), RangeError);
});

test('Greeks match known values and finite difference sensitivities', () => {
  const g = optionGreeks(100, 100, 1, 0.2, 0.05, 'CE');
  close(g.delta, 0.63683065, 1e-6);
  close(g.gamma, 0.01876202, 1e-6);
  close(g.vega, 0.37524035, 1e-6);
  close(g.theta, -0.01757268, 1e-6);
  const price = (spot, years = 1, vol = 0.2) => optionPrice(spot, 100, years, vol, 0.05, 'CE');
  close(g.delta, (price(100.01) - price(99.99)) / 0.02, 1e-5);
  close(g.gamma, (price(100.01) - 2 * price(100) + price(99.99)) / 0.0001, 1e-5);
  close(g.vega, (price(100, 1, 0.20001) - price(100, 1, 0.19999)) / 0.002, 1e-5);
  close(g.theta, (price(100, 1 - 0.0001) - price(100, 1 + 0.0001)) / (0.0002 * 365), 1e-5);
  close(g.delta - optionGreeks(100, 100, 1, 0.2, 0.05, 'PE').delta, 1);
});

test('long call has finite debit risk and unbounded upside', () => {
  const result = analyzeStrategy([leg()], 100, 50, 20);
  assert.equal(result.maxProfit, Infinity);
  assert.equal(result.maxLoss, 250);
  assert.deepEqual(result.breakevens, [105]);
  assert.equal(result.netPremium, -250);
  assert.equal(expiryPayoff([leg()], 110, 50), 250);
  assert.ok(result.pop > 0 && result.pop < 100);
});

test('short call has unbounded loss and no false limited tail', () => {
  const result = analyzeStrategy([leg({ side: 'sell' })], 100, 50, 20);
  assert.equal(result.maxProfit, 250);
  assert.equal(result.maxLoss, Infinity);
  assert.deepEqual(result.breakevens, [105]);
  assert.equal(result.rewardRisk, 0);
});

test('long and short put risk is bounded at zero underlying', () => {
  const longPut = analyzeStrategy([leg({ type: 'PE' })], 100, 10, 20);
  assert.equal(longPut.maxProfit, 950);
  assert.equal(longPut.maxLoss, 50);
  assert.deepEqual(longPut.breakevens, [95]);
  const shortPut = analyzeStrategy([leg({ type: 'PE', side: 'sell' })], 100, 10, 20);
  assert.equal(shortPut.maxProfit, 50);
  assert.equal(shortPut.maxLoss, 950);
});

test('bull call spread and net premium incorporate lots and disabled legs', () => {
  const legs = [leg({ premium: 8, lots: 2 }), leg({ side: 'sell', strike: 110, premium: 3, lots: 2 }), leg({ premium: 999, enabled: false })];
  const result = analyzeStrategy(legs, 100, 50, 20);
  assert.equal(result.maxProfit, 500);
  assert.equal(result.maxLoss, 500);
  assert.equal(result.netPremium, -500);
  assert.deepEqual(result.breakevens, [105]);
  close(result.rewardRisk, 1);
});

test('iron condor produces both exact breakevens and correct bounded risk', () => {
  const legs = [
    leg({ type: 'PE', strike: 80, premium: 1 }),
    leg({ side: 'sell', type: 'PE', strike: 90, premium: 3 }),
    leg({ side: 'sell', strike: 110, premium: 3 }),
    leg({ strike: 120, premium: 1 }),
  ];
  const result = analyzeStrategy(legs, 100, 50, 20);
  assert.equal(result.maxProfit, 200);
  assert.equal(result.maxLoss, 300);
  assert.deepEqual(result.breakevens, [86, 114]);
  assert.equal(expiryPayoff(legs, 0, 50), -300);
  assert.equal(expiryPayoff(legs, 999, 50), -300);
  assert.ok(result.pop > 90 && result.pop < 100);
});

test('unequal call ratios detect unbounded tail despite finite sampled strikes', () => {
  const result = analyzeStrategy([leg({ premium: 8 }), leg({ side: 'sell', strike: 110, premium: 3, lots: 2 })], 100, 1, 20);
  assert.equal(result.maxLoss, Infinity);
  assert.equal(result.maxProfit, 8);
  assert.deepEqual(result.breakevens, [102, 118]);
});

test('scenarios respond to days and IV, and converge to exact expiry payoff', () => {
  const legs = [leg()];
  const today = scenarioPayoff(legs, 100, 0, 0, 50, 0.065, DEMO_DATE);
  assert.ok(scenarioPayoff(legs, 100, 0, 5, 50, 0.065, DEMO_DATE) > today);
  assert.ok(scenarioPayoff(legs, 100, 5, 0, 50, 0.065, DEMO_DATE) < today);
  close(scenarioPayoff(legs, 110, daysToExpiry(legs[0].expiry), 5, 50), expiryPayoff(legs, 110, 50));
  close(daysToExpiry('2026-10-26'), 3.5 / 24);
});

test('strategy Greeks aggregate option Greeks with contract quantities', () => {
  const legs = [leg({ lots: 2, side: 'sell' })];
  const result = analyzeStrategy(legs, 100, 50, 20);
  const individual = optionGreeks(100, 100, daysToExpiry('2026-11-26') / 365, 0.2, 0.06, 'CE');
  for (const key of ['delta', 'gamma', 'theta', 'vega', 'rho']) close(result[key], -100 * individual[key]);
});

test('calendar spread retains time value and discloses nearest expiry analysis', () => {
  const legs = [leg({ side: 'sell', expiry: '2026-10-27', premium: 2 }), leg({ expiry: '2026-11-26', premium: 4 })];
  const result = analyzeStrategy(legs, 100, 50, 20);
  assert.equal(result.mixedExpiry, true);
  assert.equal(result.analysisExpiry, '2026-10-27');
  assert.ok(Number.isFinite(result.maxProfit));
  assert.ok(result.maxProfit > 0);
  assert.ok(result.maxLoss > 0);
  assert.equal(expiryPayoff(legs, 100, 50), -100);
  assert.ok(scenarioPayoff(legs, 100, daysToExpiry('2026-10-27'), 0, 50) > -100);
});

test('mixed-expiry roots capture a narrow profit interval around a smooth turning point', () => {
  const legs = [
    leg({ type: 'PE', strike: 1, expiry: '2026-10-27', premium: 0 }),
    leg({ premium: 5.084674351843976 }),
    leg({ side: 'sell', strike: 110, lots: 2, premium: 0 }),
  ];
  const result = analyzeStrategy(legs, 100, 1, 20);
  assert.ok(result.maxProfit > 0);
  assert.equal(result.breakevens.length, 2);
  assert.ok(result.breakevens[1] - result.breakevens[0] < 0.1);
  for (const root of result.breakevens) {
    close(scenarioPayoff(legs, root, daysToExpiry('2026-10-27'), 0, 1), 0, 1e-6);
  }
  assert.ok(result.pop > 0 && result.pop < 0.1);
});

test('empty and fully disabled positions have zero exposure', () => {
  for (const legs of [[], [leg({ enabled: false })], [leg({ lots: 0 })]]) {
    const result = analyzeStrategy(legs, 100, 50, 20);
    assert.equal(result.maxProfit, 0);
    assert.equal(result.maxLoss, 0);
    assert.equal(result.pop, 0);
    assert.equal(result.delta, 0);
    assert.deepEqual(result.breakevens, []);
    assert.equal(scenarioPayoff(legs, 100, 0, 0, 50), 0);
  }
});

test('saved unit quantities keep payoff and Greeks stable after current lot-size changes', () => {
  const saved = leg({ lots: 2, lotSize: 65, quantityUnits: 130 });
  const before = analyzeStrategy([saved], 100, 65, 20);
  const after = analyzeStrategy([{ ...saved, lots: 99, lotSize: 30 }], 100, 30, 20);
  assert.equal(legUnits(saved), 130);
  assert.equal(legUnits({ ...saved, side: 'sell' }), -130);
  assert.equal(expiryPayoff([saved], 110, 30), 650);
  assert.equal(after.maxLoss, 650);
  for (const field of ['netPremium', 'delta', 'gamma', 'theta', 'vega', 'rho']) close(after[field], before[field]);
  close(scenarioPayoff([saved], 100, 2, 3, 30), scenarioPayoff([saved], 100, 2, 3, 65));
});

test('per-contract lot sizes prevent a false bounded spread when quantities differ', () => {
  const legs = [leg({ lotSize: 65 }), leg({ side: 'sell', strike: 110, premium: 2, lotSize: 30 })];
  assert.equal(legUnits(legs[0], 999), 65);
  assert.equal(legUnits(legs[1], 999), -30);
  assert.equal(analyzeStrategy(legs, 100, 999, 20).maxProfit, Infinity);
  assert.equal(expiryPayoff(legs, 120, 999), 735);
  assert.equal(legUnits(leg({ lots: 2 }), 50), 100);
});

test('LTP mark-to-market differs from modeled P&L without changing saved entries', () => {
  const saved = leg({ contractId: 'NSE:test', lotSize: 50, quantityUnits: 100 });
  const original = structuredClone(saved);
  const result = markToMarket([saved], { 'NSE:test': { ltp: 9, asOf: DEMO_DATE } }, { asOf: DEMO_DATE });
  assert.equal(result.total, 400);
  assert.equal(result.partialTotal, 400);
  assert.equal(result.complete, true);
  assert.equal(result.legs[0].status, 'available');
  assert.equal(result.oldestQuoteAt, '2026-10-26T06:30:00.000Z');
  assert.ok(Math.abs(scenarioPayoff([saved], 100) - result.total) > 100);
  assert.deepEqual(saved, original);
});

test('missing quotes keep totals unavailable while valid zero LTP and disabled legs behave correctly', () => {
  const legs = [
    leg({ id: 'zero', contractId: 'zero', quantityUnits: 100 }),
    leg({ id: 'missing', contractId: 'missing', quantityUnits: 50 }),
    leg({ id: 'disabled', enabled: false, contractId: 'disabled' }),
  ];
  const result = markToMarket(legs, { zero: { ltp: 0, asOf: DEMO_DATE } }, { asOf: DEMO_DATE });
  assert.equal(result.total, null);
  assert.equal(result.partialTotal, -500);
  assert.equal(result.complete, false);
  assert.equal(result.legs.length, 2);
  assert.deepEqual(result.legs.map(row => row.status), ['available', 'missing']);
  assert.equal(result.legs[0].price, 0);
  assert.equal(result.legs[1].pl, null);
  assert.equal(markToMarket([leg()], {}, { asOf: DEMO_DATE }).legs[0].status, 'missing');
  assert.equal(markToMarket([], {}, { asOf: DEMO_DATE }).total, 0);
});

test('freshness requires a recent feed timestamp and a recent actual trade when supplied', () => {
  const saved = leg({ contractId: 'test', quantityUnits: 50 });
  const options = { asOf: '2026-10-26T06:30:00Z', marketStatus: 'open' };
  const stale = markToMarket([saved], { test: { ltp: 7, asOf: '2026-10-26T06:28:29Z', receivedAt: options.asOf, lastTradedAt: options.asOf } }, options);
  assert.equal(stale.total, null);
  assert.equal(stale.partialTotal, 0);
  assert.equal(stale.legs[0].status, 'stale');
  assert.equal(stale.oldestQuoteAt, '2026-10-26T06:28:29.000Z');
  const oldTrade = markToMarket([saved], { test: { ltp: 7, asOf: options.asOf, lastTradedAt: '2026-10-20T06:30:00Z' } }, options);
  assert.equal(oldTrade.total, null);
  assert.equal(oldTrade.legs[0].status, 'stale');
  assert.equal(oldTrade.oldestQuoteAt, '2026-10-26T06:30:00.000Z');
  assert.equal(oldTrade.oldestLastTradedAt, '2026-10-20T06:30:00.000Z');
  const unknownTrade = markToMarket([saved], { test: { ltp: 7, asOf: options.asOf } }, options);
  assert.equal(unknownTrade.total, 100);
  assert.equal(unknownTrade.oldestLastTradedAt, null);
  const noFeedTimestamp = markToMarket([saved], { test: { ltp: 7, receivedAt: options.asOf, lastTradedAt: options.asOf } }, options);
  assert.equal(noFeedTimestamp.legs[0].status, 'missing');
});

test('closed-market valid quotes give a complete MTM explicitly labeled closed', () => {
  const saved = leg({ contractId: 'test', quantityUnits: 50, side: 'sell' });
  const result = markToMarket([saved], new Map([['test', { ltp: 7, asOf: '2026-10-30T10:00:00Z', lastTradedAt: '2026-10-29T09:00:00Z' }]]), { asOf: '2026-10-31T06:30:00Z', marketStatus: 'closed' });
  assert.equal(result.total, -100);
  assert.equal(result.complete, true);
  assert.equal(result.legs[0].status, 'closed');
  assert.equal(result.oldestQuoteAt, '2026-10-30T10:00:00.000Z');
  assert.equal(result.oldestLastTradedAt, '2026-10-29T09:00:00.000Z');
});

test('expired unresolved contracts cannot be marked with a later quote', () => {
  const expired = leg({ contractId: 'test', expiry: '2026-10-31', quantityUnits: 50 });
  const quotes = { test: { ltp: 99, asOf: '2026-10-31T10:00:00Z' } };
  const result = markToMarket([expired], quotes, { asOf: '2026-10-31T10:00:00Z', marketStatus: 'closed' });
  assert.equal(result.total, null);
  assert.equal(result.legs[0].status, 'expired');
  assert.equal(result.legs[0].price, null);
  const actualExpiry = { ...expired, expiresAt: '2026-10-31T09:00:00Z' };
  assert.equal(markToMarket([actualExpiry], quotes, { asOf: '2026-10-31T09:00:00Z' }).legs[0].status, 'expired');
});

test('expired settlement locks P&L and removes future spot, time and Greek exposure', () => {
  const settled = leg({ expiry: '2026-10-30', quantityUnits: 40, settlementPrice: 8 });
  const asOf = '2026-10-31T06:30:00Z';
  const marked = markToMarket([settled], {}, { asOf });
  assert.equal(marked.total, 120);
  assert.equal(marked.legs[0].status, 'available');
  assert.equal(marked.oldestQuoteAt, null);
  for (const spot of [0, 100, 1000]) {
    assert.equal(scenarioPayoff([settled], spot, 100, 20, 999, 0.06, asOf), 120);
    assert.equal(expiryPayoff([settled], spot, 999), 120);
    const result = analyzeStrategy([settled], spot, 999, 20, 0.06, asOf);
    for (const greek of ['delta', 'gamma', 'theta', 'vega', 'rho']) assert.equal(result[greek], 0);
    assert.equal(result.maxProfit, 120);
    assert.equal(result.maxLoss, 0);
    assert.deepEqual(result.breakevens, []);
  }
  assert.equal(markToMarket([{ ...settled, settlementPrice: 0 }], {}, { asOf }).total, -200);
});

test('settled legs become fixed cash alongside a later active contract', () => {
  const settled = leg({ expiry: '2026-10-30', quantityUnits: 40, settlementPrice: 8 });
  const open = leg({ id: 'open', quantityUnits: 30, expiry: '2026-11-26' });
  const asOf = '2026-10-31T06:30:00Z';
  const together = analyzeStrategy([settled, open], 100, 999, 20, 0.06, asOf);
  const activeOnly = analyzeStrategy([open], 100, 999, 20, 0.06, asOf);
  assert.equal(together.analysisExpiry, '2026-11-26');
  assert.equal(together.mixedExpiry, false);
  for (const greek of ['delta', 'gamma', 'theta', 'vega', 'rho']) close(together[greek], activeOnly[greek]);
  close(scenarioPayoff([settled, open], 110, 5, 2, 999, 0.06, asOf), scenarioPayoff([open], 110, 5, 2, 999, 0.06, asOf) + 120);
});

test('implied volatility recovers known call/put IV and rejects impossible or unidentifiable prices', () => {
  for (const type of ['CE', 'PE']) {
    const price = optionPrice(24_500, 24_600, 7 / 365, 0.142, 0.06, type);
    close(impliedVolatility(price, 24_500, 24_600, 7 / 365, 0.06, type), 0.142, 1e-7);
  }
  assert.equal(impliedVolatility(0, 100, 110, 1, 0), 0);
  for (const price of [-1, 100, 101, NaN]) assert.equal(impliedVolatility(price, 100, 100, 1, 0.06, 'CE'), null);
  assert.equal(impliedVolatility(1, 100, 100, 0, 0.06, 'CE'), null);
  assert.equal(impliedVolatility(1, 0, 100, 1, 0.06, 'CE'), null);
  assert.equal(impliedVolatility(1, 100, 100, 1, 0.06, 'unknown'), null);
});
