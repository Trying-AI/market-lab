import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpstoxClient, INDEX_KEYS } from '../src/market-data.js';

// Deliberately synthetic fixtures: these numbers are not live market quotes.
const TOKEN = 'test-only-personal-token';
const RECEIVED = '2026-10-31T10:00:00.000Z';
const QUOTED = '2026-10-30T09:59:59.000Z';
const TRADED = '2026-10-30T09:59:55.000Z';
const EXPIRY = '2026-11-03';
const call = 'NSE_FO|123';
const put = 'NSE_FO|124';

function response(data, status = 200, payloadStatus = 'success') {
  return { status, ok: status >= 200 && status < 300, json: async () => ({ status: payloadStatus, data }) };
}

function clientWith(data, status = 200) {
  const calls = [];
  const client = createUpstoxClient({ token: TOKEN, now: () => RECEIVED, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response(typeof data === 'function' ? data(url) : data, status);
  } });
  return { client, calls };
}

function contract(overrides = {}) {
  return { instrument_key: call, instrument_type: 'CE', expiry: EXPIRY, strike_price: 25000, lot_size: 65,
    exchange: 'NSE', underlying_key: INDEX_KEYS.NIFTY, tick_size: 5, ...overrides };
}

function quote(overrides = {}) {
  return { instrument_token: call, last_price: 105, prev_close_price: 100, timestamp: QUOTED,
    last_trade_time: String(Date.parse(TRADED)), depth: { buy: [{ price: 104, quantity: 10 }], sell: [{ price: 106, quantity: 20 }] }, ...overrides };
}

function chainRow(overrides = {}) {
  return { expiry: EXPIRY, underlying_key: INDEX_KEYS.NIFTY, strike_price: 25000, underlying_spot_price: 25050,
    call_options: { instrument_key: call, market_data: { ltp: 105, bid_price: 104, bid_qty: 10, ask_price: 106, ask_qty: 20, oi: 1200 }, option_greeks: { iv: 14.5 } },
    put_options: { instrument_key: put, market_data: { ltp: 50, bid_price: 49, bid_qty: 10, ask_price: 51, ask_qty: 10, oi: 800 }, option_greeks: { iv: 15.2 } }, ...overrides };
}

test('provider uses the documented instrument identifiers', () => {
  assert.deepEqual(INDEX_KEYS, { NIFTY: 'NSE_INDEX|Nifty 50', BANKNIFTY: 'NSE_INDEX|Nifty Bank', SENSEX: 'BSE_INDEX|SENSEX' });
  assert.ok(Object.isFrozen(INDEX_KEYS));
});

test('client keeps token in request headers and never in URL or public client fields', async () => {
  const { client, calls } = clientWith([]);
  await client.getContracts('NIFTY');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  assert.ok(!calls[0].url.includes(TOKEN));
  assert.ok(!JSON.stringify(client).includes(TOKEN));
  assert.equal(new URL(calls[0].url).searchParams.get('instrument_key'), INDEX_KEYS.NIFTY);
});

test('validates token and request inputs without sending a request', async () => {
  for (const token of ['', ' ', null, 42, 'bad\ntoken', 'x'.repeat(8193)]) {
    assert.throws(() => createUpstoxClient({ token }), /Analytics Token/);
  }
  const { client, calls } = clientWith([]);
  await assert.rejects(client.getContracts('__proto__'), /Choose NIFTY/);
  await assert.rejects(client.getChain('NIFTY', '2026-02-30'), /valid option expiry/);
  await assert.rejects(client.getQuotes(['https://attacker.example']), /valid option contracts/);
  await assert.rejects(client.getQuotes(Array(501).fill(call)), /valid option contracts/);
  await assert.rejects(client.getMarketStatus('OTHER'), /valid exchange/);
  assert.equal(calls.length, 0);
});

test('discovers and sorts actual contracts without generated strikes or lot sizes', async () => {
  const { client } = clientWith([contract({ instrument_key: put, instrument_type: 'PE', strike_price: 25100 }), contract()]);
  const contracts = await client.getContracts('NIFTY');
  assert.deepEqual(contracts.map(c => [c.contractId, c.strike, c.type]), [[call, 25000, 'CE'], [put, 25100, 'PE']]);
  assert.equal(contracts[0].lotSize, 65);
  assert.equal(contracts[0].tickSize, .05);
  assert.equal(contracts[0].tickSizePaise, 5);
});

test('rejects invalid or mismatched contract metadata atomically', async () => {
  const invalid = [
    { instrument_type: 'FUT' }, { expiry: '2026-02-30' }, { strike_price: null }, { lot_size: 0 },
    { lot_size: 1.5 }, { underlying_key: INDEX_KEYS.BANKNIFTY }, { exchange: 'BSE' }, { instrument_key: 'BSE_FO|123' },
  ];
  for (const bad of invalid) await assert.rejects(clientWith([contract(bad)]).client.getContracts('NIFTY'), /invalid option contract/);
  await assert.rejects(clientWith([contract(), contract()]).client.getContracts('NIFTY'), /invalid option contract/);
});

test('normalizes chain quotes without inventing quote timestamps', async () => {
  const { client, calls } = clientWith([chainRow()]);
  const result = await client.getChain('NIFTY', EXPIRY);
  assert.equal(result.spot, 25050);
  assert.equal(result.receivedAt, RECEIVED);
  assert.equal(result.rows[0].call.premium, 105);
  assert.equal(result.rows[0].put.iv, 15.2);
  assert.equal(result.rows[0].call.asOf, null);
  assert.equal(result.rows[0].call.lastTradedAt, null);
  assert.equal(result.rows[0].call.bid, 104);
  assert.equal(new URL(calls[0].url).searchParams.get('expiry_date'), EXPIRY);
});

test('missing values stay null, zero LTP is valid, and zero IV is unavailable', async () => {
  const row = chainRow();
  Object.assign(row.call_options.market_data, { ltp: 0, bid_price: 0, bid_qty: 0, ask_price: null, oi: 0 });
  row.call_options.option_greeks.iv = 0;
  row.put_options = null;
  const result = await clientWith([row]).client.getChain('NIFTY', EXPIRY);
  assert.equal(result.rows[0].call.premium, 0);
  assert.equal(result.rows[0].call.iv, null);
  assert.equal(result.rows[0].call.oi, 0);
  assert.equal(result.rows[0].call.bid, null);
  assert.equal(result.rows[0].call.ask, null);
  assert.equal(result.rows[0].put, null);
  row.call_options.market_data.ltp = '';
  assert.equal((await clientWith([row]).client.getChain('NIFTY', EXPIRY)).rows[0].call.premium, null);
});

test('mismatched expiries, exchanges and duplicate chain strikes are rejected', async () => {
  await assert.rejects(clientWith([chainRow({ expiry: '2026-11-10' })]).client.getChain('NIFTY', EXPIRY), /mismatched option chain/);
  await assert.rejects(clientWith([chainRow(), chainRow()]).client.getChain('NIFTY', EXPIRY), /mismatched option chain/);
  const wrong = chainRow(); wrong.call_options.instrument_key = 'BSE_FO|123';
  await assert.rejects(clientWith([wrong]).client.getChain('NIFTY', EXPIRY), /mismatched option exchange/);
});

test('full quotes map by instrument token and preserve last-trade and response timestamps separately', async () => {
  const { client, calls } = clientWith({ 'NSE_FO:EXAMPLE CALL': quote() });
  const values = await client.getQuotes([call, put, call]);
  assert.deepEqual(values[call], { ltp: 105, bid: 104, ask: 106, asOf: QUOTED, lastTradedAt: TRADED, receivedAt: RECEIVED });
  assert.equal(values[put].ltp, null);
  assert.equal(values[put].asOf, null);
  assert.equal(values[put].receivedAt, RECEIVED);
  assert.equal(new URL(calls[0].url).pathname, '/v3/market-quote/quotes');
  assert.equal(new URL(calls[0].url).searchParams.get('instrument_key'), `${call},${put}`);
});

test('uses v3 previous close rather than current candle close for index changes', async () => {
  const data = Object.fromEntries(Object.values(INDEX_KEYS).map((id, index) => [id.replace('|', ':'), quote({ instrument_token: id, last_price: 1000 + index, prev_close_price: 900, ohlc: { close: 9999 } })]));
  const indices = await clientWith(data).client.getIndices();
  assert.equal(indices.NIFTY.previousClose, 900);
  assert.equal(indices.NIFTY.change, 100);
  assert.equal(indices.NIFTY.changePercent, 100 / 9);
  assert.equal(indices.SENSEX.spot, 1002);
});

test('missing index prices and timestamp fields cannot become zero or now', async () => {
  const indices = await clientWith({}).client.getIndices();
  for (const value of Object.values(indices)) {
    assert.equal(value.spot, null);
    assert.equal(value.previousClose, null);
    assert.equal(value.change, null);
    assert.equal(value.changePercent, null);
    assert.equal(value.asOf, null);
    assert.equal(value.lastTradedAt, null);
    assert.equal(value.receivedAt, RECEIVED);
  }
});

test('accepts provider unix seconds or milliseconds and explicit timezone timestamps only', async () => {
  const { client } = clientWith({ x: quote({ timestamp: Date.parse(QUOTED), last_trade_time: Date.parse(TRADED) / 1000 }) });
  const values = await client.getQuotes([call]);
  assert.equal(values[call].asOf, QUOTED);
  assert.equal(values[call].lastTradedAt, TRADED);
  const invalid = await clientWith({ x: quote({ timestamp: '2026-10-30 15:30:00', last_trade_time: 'not-a-date' }) }).client.getQuotes([call]);
  assert.equal(invalid[call].asOf, null);
  assert.equal(invalid[call].lastTradedAt, null);
});

test('market status reflects provider sessions, with no guessed clock-based open state', async () => {
  for (const [status, expected] of [['NORMAL_OPEN', 'open'], ['NORMAL_CLOSE', 'closed'], ['PRE_OPEN_START', 'closed'], ['CAS_STOP', 'closed'], ['UNRECOGNIZED', 'unknown']]) {
    assert.equal(await clientWith({ exchange: 'NSE', status }).client.getMarketStatus('NSE'), expected);
  }
});

test('HTTP authentication and rate-limit failures are actionable and contain no credential or upstream body', async () => {
  for (const [status, code, pattern] of [[401, 'AUTH', /Analytics Token/], [403, 'AUTH', /Analytics Token/], [429, 'RATE_LIMIT', /limiting requests/], [500, 'HTTP', /temporarily unavailable/]]) {
    const { client } = clientWith({ token: TOKEN, malicious: `echo ${TOKEN}` }, status);
    await assert.rejects(client.getContracts('NIFTY'), error => error.code === code && pattern.test(error.message) && !JSON.stringify(error).includes(TOKEN) && !error.message.includes(TOKEN));
  }
});

test('network and malformed responses are sanitized, with no automatic retries', async () => {
  let count = 0;
  const client = createUpstoxClient({ token: TOKEN, fetchImpl: async () => { count++; throw new Error(`request leaked ${TOKEN}`); } });
  await assert.rejects(client.getContracts('NIFTY'), error => error.code === 'NETWORK' && !error.message.includes(TOKEN) && error.cause === undefined);
  assert.equal(count, 1);
  const malformed = createUpstoxClient({ token: TOKEN, fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error(TOKEN); } }) });
  await assert.rejects(malformed.getContracts('NIFTY'), /unreadable/);
  const unsuccessful = createUpstoxClient({ token: TOKEN, fetchImpl: async () => response([], 200, 'error') });
  await assert.rejects(unsuccessful.getContracts('NIFTY'), /unsuccessful/);
});

test('a caller can cancel a pending request without leaking its abort reason', async () => {
  const controller = new AbortController();
  let called = false;
  const client = createUpstoxClient({ token: TOKEN, fetchImpl: async (_url, options) => {
    called = true;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error(TOKEN)), { once: true }));
  } });
  const pending = client.getContracts('NIFTY', { signal: controller.signal });
  controller.abort(TOKEN);
  await assert.rejects(pending, error => error.name === 'AbortError' && error.code === 'ABORTED' && !error.message.includes(TOKEN));
  assert.ok(called);
  const before = new AbortController(); before.abort();
  await assert.rejects(client.getContracts('NIFTY', { signal: before.signal }), error => error.name === 'AbortError');
});

test('empty contract quote requests do not call the provider', async () => {
  const { client, calls } = clientWith({});
  assert.deepEqual(await client.getQuotes([]), {});
  assert.equal(calls.length, 0);
});
