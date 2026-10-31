/**
 * Personal, read-only Upstox market-data adapter.
 * A token belongs to one visitor and exists only in this client's closure.
 * This module never writes credentials or quotes to browser storage.
 *
 * Official API references:
 * https://upstox.com/developer/api-documentation/analytics-token/
 * https://upstox.com/developer/api-documentation/get-option-contracts/
 * https://upstox.com/developer/api-documentation/get-pc-option-chain/
 * https://upstox.com/developer/api-documentation/get-full-market-quote-v3/
 * https://upstox.com/developer/api-documentation/get-market-status/
 */

export const INDEX_KEYS = Object.freeze({
  NIFTY: 'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  SENSEX: 'BSE_INDEX|SENSEX',
});

const ORIGIN = 'https://api.upstox.com';
const REQUEST_TIMEOUT_MS = 15_000;
const OPTION_ID = /^(?:NSE_FO|BSE_FO)\|[A-Za-z0-9_-]+$/;
const INDEX_IDS = new Set(Object.values(INDEX_KEYS));
const CLOSED_STATUSES = new Set([
  'NORMAL_CLOSE', 'PRE_OPEN_START', 'PRE_OPEN_END', 'PRE_OPEN_M_END',
  'CLOSING_START', 'CLOSING_END', 'CTS_CLOSE', 'CAS_LM_START',
  'CAS_M_STOP', 'CAS_STOP',
]);

function fail(message, code = 'RESPONSE', name = 'Error') {
  const error = new Error(message);
  error.code = code;
  error.name = name;
  throw error;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function numeric(value, { positive = false } = {}) {
  // Do not coerce null, empty strings, or booleans to fictitious zero prices.
  return typeof value === 'number' && Number.isFinite(value) && (positive ? value > 0 : value >= 0) ? value : null;
}

function signedNumeric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  let milliseconds;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,16}$/.test(value))) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    milliseconds = number < 100_000_000_000 ? number * 1000 : number;
  } else if (typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    milliseconds = Date.parse(value);
  } else return null;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? value : null;
}

function requireSymbol(symbol) {
  if (typeof symbol !== 'string' || !Object.hasOwn(INDEX_KEYS, symbol)) fail('Choose NIFTY, BANKNIFTY, or SENSEX.', 'INPUT');
  return INDEX_KEYS[symbol];
}

function requireContractId(value) {
  return typeof value === 'string' && value.length <= 160 && OPTION_ID.test(value);
}

function emptyQuote(receivedAt) {
  return { ltp: null, bid: null, ask: null, asOf: null, lastTradedAt: null, receivedAt };
}

function depthPrice(levels) {
  if (!Array.isArray(levels)) return null;
  const level = levels.find(item => isRecord(item) && numeric(item.quantity, { positive: true }) !== null && numeric(item.price) !== null);
  return level ? numeric(level.price) : null;
}

function normalizeQuote(input, receivedAt) {
  if (!isRecord(input)) fail('Upstox returned an invalid quote response. Try refreshing the connection.');
  return {
    ltp: numeric(input.last_price),
    bid: depthPrice(input.depth?.buy),
    ask: depthPrice(input.depth?.sell),
    // The provider's response time and last actual trade time are distinct.
    asOf: timestamp(input.timestamp),
    lastTradedAt: timestamp(input.last_trade_time),
    receivedAt,
  };
}

function normalizeChainSide(input) {
  if (input === null || input === undefined) return null;
  if (!isRecord(input) || !requireContractId(input.instrument_key) || !isRecord(input.market_data)) {
    fail('Upstox returned an invalid option-chain contract. Try refreshing the selected expiry.');
  }
  const data = input.market_data;
  const quantityPrice = (price, quantity) => numeric(quantity, { positive: true }) === null ? null : numeric(price);
  return {
    contractId: input.instrument_key,
    premium: numeric(data.ltp),
    iv: numeric(input.option_greeks?.iv, { positive: true }),
    oi: numeric(data.oi),
    bid: quantityPrice(data.bid_price, data.bid_qty),
    ask: quantityPrice(data.ask_price, data.ask_qty),
    // The documented option-chain payload has no timestamps. Do not stamp it
    // with receivedAt and mistake a successful request for a recent trade.
    asOf: timestamp(data.timestamp ?? input.timestamp),
    lastTradedAt: timestamp(data.last_trade_time ?? input.last_trade_time),
  };
}

export function createUpstoxClient({ token, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  if (typeof token !== 'string' || !token.trim() || token.trim().length > 8192 || /[\r\n]/.test(token)) {
    fail('Enter your personal Upstox Analytics Token.', 'INPUT');
  }
  if (typeof fetchImpl !== 'function' || typeof now !== 'function') fail('Market data is unavailable in this browser.', 'INPUT');
  const privateToken = token.trim();

  function receivedTime() {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) fail('The market-data clock is unavailable.', 'INPUT');
    return date.toISOString();
  }

  async function request(version, path, params, signal) {
    if (signal?.aborted) fail('Market-data request cancelled.', 'ABORTED', 'AbortError');
    const url = new URL(`/${version}${path}`, ORIGIN);
    for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      let response;
      try {
        response = await fetchImpl(url.href, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${privateToken}` },
          mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error',
          referrerPolicy: 'no-referrer', signal: controller.signal,
        });
      } catch {
        if (signal?.aborted) fail('Market-data request cancelled.', 'ABORTED', 'AbortError');
        if (timedOut) fail('Upstox did not respond within 15 seconds. Try refreshing.', 'TIMEOUT');
        fail('Could not reach Upstox. Check your connection and whether this browser permits the market-data request.', 'NETWORK');
      }
      if (!response || !Number.isInteger(response.status) || typeof response.ok !== 'boolean' || typeof response.json !== 'function') {
        fail('Upstox returned an invalid market-data response. Try again later.');
      }
      if (response.status === 401 || response.status === 403) {
        fail('Upstox rejected this connection. Check or renew your personal Analytics Token and reconnect.', 'AUTH');
      }
      if (response.status === 429) fail('Upstox is limiting requests. Wait a moment before refreshing.', 'RATE_LIMIT');
      if (!response.ok) fail('Upstox market data is temporarily unavailable. Try again later.', 'HTTP');
      let payload;
      try { payload = await response.json(); } catch {
        if (signal?.aborted) fail('Market-data request cancelled.', 'ABORTED', 'AbortError');
        if (timedOut) fail('Upstox did not respond within 15 seconds. Try refreshing.', 'TIMEOUT');
        fail('Upstox returned an unreadable market-data response. Try again later.');
      }
      if (!isRecord(payload) || payload.status !== 'success' || !Object.hasOwn(payload, 'data')) {
        fail('Upstox returned an unsuccessful market-data response. Check your connection and try again.');
      }
      return { data: payload.data, receivedAt: receivedTime() };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async function fullQuotes(ids, signal) {
    const { data, receivedAt } = await request('v3', '/market-quote/quotes', { instrument_key: ids.join(',') }, signal);
    if (!isRecord(data)) fail('Upstox returned an invalid full-quote response.');
    const requested = new Set(ids);
    const result = Object.fromEntries(ids.map(id => [id, { quote: emptyQuote(receivedAt), raw: null }]));
    for (const [key, value] of Object.entries(data)) {
      if (!isRecord(value)) fail('Upstox returned an invalid full-quote response.');
      const keyFallback = ids.find(id => id === key || id.replace('|', ':') === key);
      const id = typeof value.instrument_token === 'string' ? value.instrument_token : keyFallback;
      if (!requested.has(id)) continue;
      result[id] = { quote: normalizeQuote(value, receivedAt), raw: value };
    }
    return result;
  }

  return Object.freeze({
    async getIndices({ signal } = {}) {
      const values = await fullQuotes(Object.values(INDEX_KEYS), signal);
      return Object.fromEntries(Object.entries(INDEX_KEYS).map(([symbol, id]) => {
        const { quote, raw } = values[id];
        const previousClose = numeric(raw?.prev_close_price, { positive: true });
        const change = quote.ltp !== null && previousClose !== null ? quote.ltp - previousClose : signedNumeric(raw?.net_change);
        return [symbol, {
          spot: quote.ltp, previousClose, change,
          changePercent: change !== null && previousClose !== null ? change / previousClose * 100 : null,
          asOf: quote.asOf, lastTradedAt: quote.lastTradedAt, receivedAt: quote.receivedAt,
        }];
      }));
    },

    async getContracts(symbol, { signal } = {}) {
      const instrumentKey = requireSymbol(symbol);
      const { data } = await request('v2', '/option/contract', { instrument_key: instrumentKey }, signal);
      if (!Array.isArray(data) || data.length > 20_000) fail('Upstox returned an invalid option-contract list.');
      const ids = new Set();
      return data.map(input => {
        const expectedExchange = symbol === 'SENSEX' ? 'BSE' : 'NSE';
        if (!isRecord(input) || !requireContractId(input.instrument_key) ||
            !['CE', 'PE'].includes(input.instrument_type) || !dateOnly(input.expiry) ||
            numeric(input.strike_price, { positive: true }) === null ||
            !Number.isInteger(input.lot_size) || input.lot_size < 1 || input.lot_size > 100_000 ||
            (input.underlying_key !== undefined && input.underlying_key !== instrumentKey) ||
            input.exchange !== expectedExchange || !input.instrument_key.startsWith(`${expectedExchange}_FO|`) ||
            ids.has(input.instrument_key)) {
          fail('Upstox returned an invalid option contract. Refresh the contract list before building a position.');
        }
        ids.add(input.instrument_key);
        const rawTick = numeric(input.tick_size, { positive: true });
        return {
          contractId: input.instrument_key, symbol, type: input.instrument_type,
          strike: input.strike_price, expiry: input.expiry, lotSize: input.lot_size,
          exchange: input.exchange,
          // Upstox's Indian instrument tick sizes are expressed in paise.
          tickSize: rawTick === null ? null : rawTick / 100,
          tickSizePaise: rawTick,
        };
      }).sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike || a.type.localeCompare(b.type));
    },

    async getChain(symbol, expiry, { signal } = {}) {
      const instrumentKey = requireSymbol(symbol);
      if (!dateOnly(expiry)) fail('Choose a valid option expiry date.', 'INPUT');
      const { data, receivedAt } = await request('v2', '/option/chain', { instrument_key: instrumentKey, expiry_date: expiry }, signal);
      if (!Array.isArray(data) || data.length > 10_000) fail('Upstox returned an invalid option chain.');
      const seenStrikes = new Set();
      let spot = null;
      const rows = data.map(input => {
        if (!isRecord(input) || input.expiry !== expiry ||
            (input.underlying_key !== undefined && input.underlying_key !== instrumentKey) ||
            numeric(input.strike_price, { positive: true }) === null || seenStrikes.has(input.strike_price)) {
          fail('Upstox returned a mismatched option chain. Refresh the selected market and expiry.');
        }
        seenStrikes.add(input.strike_price);
        const suppliedSpot = numeric(input.underlying_spot_price, { positive: true });
        if (spot === null && suppliedSpot !== null) spot = suppliedSpot;
        const call = normalizeChainSide(input.call_options);
        const put = normalizeChainSide(input.put_options);
        const prefix = symbol === 'SENSEX' ? 'BSE_FO|' : 'NSE_FO|';
        if ((call && !call.contractId.startsWith(prefix)) || (put && !put.contractId.startsWith(prefix))) {
          fail('Upstox returned a mismatched option exchange. Refresh the selected market.');
        }
        return { strike: input.strike_price, call, put };
      }).sort((a, b) => a.strike - b.strike);
      return { symbol, expiry, spot, receivedAt, rows };
    },

    async getQuotes(contractIds, { signal } = {}) {
      if (!Array.isArray(contractIds) || contractIds.length > 500 || contractIds.some(id => !requireContractId(id) && !INDEX_IDS.has(id))) {
        fail('Choose valid option contracts before requesting quotes.', 'INPUT');
      }
      const ids = [...new Set(contractIds)];
      if (!ids.length) return {};
      const values = await fullQuotes(ids, signal);
      return Object.fromEntries(ids.map(id => [id, values[id].quote]));
    },

    async getMarketStatus(exchange, { signal } = {}) {
      if (!['NSE', 'BSE', 'NSE_FO', 'BSE_FO'].includes(exchange)) fail('Choose a valid exchange.', 'INPUT');
      const { data } = await request('v2', `/market/status/${exchange}`, {}, signal);
      if (!isRecord(data) || typeof data.status !== 'string' || (data.exchange && data.exchange !== exchange)) {
        fail('Upstox returned an invalid exchange status.');
      }
      if (data.status === 'NORMAL_OPEN') return 'open';
      return CLOSED_STATUSES.has(data.status) ? 'closed' : 'unknown';
    },
  });
}
