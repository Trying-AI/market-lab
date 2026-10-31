/**
 * European option analytics, with no dividend yield or transaction charges.
 * Prices are points; leg premiums are points per unit. Strategy P&L and Greeks
 * include signed lots × lot size. IV on legs is a percentage, e.g. 14.2.
 * optionPrice / optionGreeks instead take decimal volatility and decimal rates.
 */
export const DEMO_DATE = '2026-10-26T06:30:00Z';
export const DEFAULT_RATE = 0.06;
export const DEFAULT_IV = 14.2;
export const DAY_MS = 86_400_000;
const YEAR_DAYS = 365;
const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);
const EPSILON = 1e-8;

export function normalCDF(value) {
  if (value === Infinity) return 1;
  if (value === -Infinity) return 0;
  if (value === 0) return 0.5;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * x);
  const polynomial = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const upper = Math.exp(-x * x / 2) / SQRT_TWO_PI * polynomial;
  return value < 0 ? upper : 1 - upper;
}

function isCall(type) {
  if (type === 'CE' || type === 'call') return true;
  if (type === 'PE' || type === 'put') return false;
  throw new TypeError('Option type must be CE or PE.');
}

function validateInputs(spot, strike, years, volatility, rate) {
  if (![spot, strike, years, volatility, rate].every(Number.isFinite)) {
    throw new TypeError('Option inputs must be finite numbers.');
  }
  if (spot < 0 || strike < 0 || volatility < 0) {
    throw new RangeError('Spot, strike and volatility cannot be negative.');
  }
}

export function optionPrice(spot, strike, years, volatility, rate = DEFAULT_RATE, type = 'CE') {
  validateInputs(spot, strike, years, volatility, rate);
  const call = isCall(type);
  if (years <= 0) return Math.max(call ? spot - strike : strike - spot, 0);
  const discountedStrike = strike * Math.exp(-rate * years);
  if (spot === 0) return call ? 0 : discountedStrike;
  if (strike === 0) return call ? spot : 0;
  if (volatility === 0) return Math.max(call ? spot - discountedStrike : discountedStrike - spot, 0);
  const sigmaRootTime = volatility * Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + volatility * volatility / 2) * years) / sigmaRootTime;
  const d2 = d1 - sigmaRootTime;
  return Math.max(0, call
    ? spot * normalCDF(d1) - discountedStrike * normalCDF(d2)
    : discountedStrike * normalCDF(-d2) - spot * normalCDF(-d1));
}

/** Calibrate decimal IV from a valid European option price; null means unavailable. */
export function impliedVolatility(price, spot, strike, years, rate = DEFAULT_RATE, type = 'CE') {
  if (![price, spot, strike, years, rate].every(Number.isFinite)
    || price < 0 || spot <= 0 || strike <= 0 || years <= 0) return null;
  let call;
  try { call = isCall(type); } catch { return null; }
  const discountedStrike = strike * Math.exp(-rate * years);
  const lower = Math.max(call ? spot - discountedStrike : discountedStrike - spot, 0);
  const upper = call ? spot : discountedStrike;
  const tolerance = Math.max(1, price) * 1e-9;
  if (!Number.isFinite(upper) || price < lower - tolerance || price >= upper - tolerance) return null;
  if (Math.abs(price - lower) <= tolerance) return 0;
  let low = 0;
  let high = 0.5;
  while (high < 16 && optionPrice(spot, strike, years, high, rate, type) < price) high *= 2;
  if (optionPrice(spot, strike, years, high, rate, type) < price - tolerance) return null;
  for (let step = 0; step < 80; step++) {
    const midpoint = (low + high) / 2;
    const modeled = optionPrice(spot, strike, years, midpoint, rate, type);
    if (Math.abs(modeled - price) <= tolerance) return midpoint;
    if (modeled < price) low = midpoint;
    else high = midpoint;
  }
  return (low + high) / 2;
}

/** Theta is per calendar day; vega / rho are per 1 percentage point. */
export function optionGreeks(spot, strike, years, volatility, rate = DEFAULT_RATE, type = 'CE') {
  validateInputs(spot, strike, years, volatility, rate);
  const call = isCall(type);
  const empty = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  if (years <= 0) {
    const callDelta = spot > strike ? 1 : spot < strike ? 0 : 0.5;
    return { ...empty, delta: call ? callDelta : callDelta - 1 };
  }
  const discountedStrike = strike * Math.exp(-rate * years);
  if (strike === 0) return { ...empty, delta: call ? 1 : 0 };
  if (spot === 0 || volatility === 0) {
    const callDelta = spot > discountedStrike ? 1 : spot < discountedStrike ? 0 : 0.5;
    const delta = call ? callDelta : callDelta - 1;
    const interest = rate * discountedStrike / YEAR_DAYS;
    return {
      ...empty,
      delta,
      theta: call ? -interest * callDelta : interest * (1 - callDelta),
      rho: (call ? callDelta : callDelta - 1) * discountedStrike * years / 100,
    };
  }
  const rootTime = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + volatility * volatility / 2) * years) / (volatility * rootTime);
  const d2 = d1 - volatility * rootTime;
  const density = Math.exp(-d1 * d1 / 2) / SQRT_TWO_PI;
  const timeDecay = -(spot * density * volatility) / (2 * rootTime);
  return {
    delta: call ? normalCDF(d1) : normalCDF(d1) - 1,
    gamma: density / (spot * volatility * rootTime),
    theta: (call ? timeDecay - rate * discountedStrike * normalCDF(d2) : timeDecay + rate * discountedStrike * normalCDF(-d2)) / YEAR_DAYS,
    vega: spot * rootTime * density / 100,
    rho: (call ? discountedStrike * years * normalCDF(d2) : -discountedStrike * years * normalCDF(-d2)) / 100,
  };
}

function dateValue(value = DEMO_DATE) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new TypeError('A valid valuation date is required.');
  return timestamp;
}

export function expiryTimestamp(expiry) {
  const timestamp = Date.parse(`${expiry}T10:00:00Z`);
  if (!Number.isFinite(timestamp)) throw new TypeError('Expiry must be a YYYY-MM-DD date.');
  return timestamp;
}

export function daysToExpiry(expiry, baseDate = DEMO_DATE) {
  return Math.max(0, (expiryTimestamp(expiry) - dateValue(baseDate)) / DAY_MS);
}

export function expiryYears(expiry, baseDate = DEMO_DATE) {
  return daysToExpiry(expiry, baseDate) / YEAR_DAYS;
}

function enabledLegs(legs) {
  return legs.filter(leg => leg.enabled !== false && (
    (Number.isFinite(leg.quantityUnits) && leg.quantityUnits > 0)
    || (Number.isFinite(leg.lots) && leg.lots > 0)
  ));
}

/** Saved absolute quantity takes priority over mutable current contract metadata. */
export function legUnits(leg, defaultLotSize = 1) {
  const lotSize = Number.isFinite(leg.lotSize) && leg.lotSize > 0 ? leg.lotSize : defaultLotSize;
  const quantity = Number.isFinite(leg.quantityUnits) && leg.quantityUnits > 0
    ? leg.quantityUnits
    : leg.lots * lotSize;
  return (leg.side === 'sell' ? -1 : 1) * quantity;
}

function legExpiryTime(leg) {
  return leg.expiresAt != null ? dateValue(leg.expiresAt) : expiryTimestamp(leg.expiry);
}

function settledOptionValue(leg, at = Infinity) {
  return Number.isFinite(leg.settlementPrice) && leg.settlementPrice >= 0 && legExpiryTime(leg) <= at
    ? leg.settlementPrice
    : null;
}

function payoffAtExpiry(legs, spot, lotSize, settlementAt = Infinity) {
  return legs.reduce((total, leg) => {
    const settled = settledOptionValue(leg, settlementAt);
    const value = settled ?? Math.max(isCall(leg.type) ? spot - leg.strike : leg.strike - spot, 0);
    return total + legUnits(leg, lotSize) * (value - leg.premium);
  }, 0);
}

export function expiryPayoff(legs, spot, lotSize = 1) {
  return payoffAtExpiry(enabledLegs(legs), spot, lotSize);
}

export function scenarioPayoff(legs, spot, daysForward = 0, ivShift = 0, lotSize = 1, rate = DEFAULT_RATE, baseDate = DEMO_DATE) {
  const valuationTime = dateValue(baseDate);
  const targetTime = valuationTime + Math.max(0, daysForward) * DAY_MS;
  return enabledLegs(legs).reduce((total, leg) => {
    const settled = settledOptionValue(leg, valuationTime);
    if (settled !== null) return total + legUnits(leg, lotSize) * (settled - leg.premium);
    const years = Math.max(0, (legExpiryTime(leg) - targetTime) / DAY_MS / YEAR_DAYS);
    const volatility = Math.max(0, (Number.isFinite(leg.iv) ? leg.iv : DEFAULT_IV) + ivShift) / 100;
    const value = optionPrice(spot, leg.strike, years, volatility, rate, leg.type);
    return total + legUnits(leg, lotSize) * (value - leg.premium);
  }, 0);
}

/**
 * LTP mark-to-market, independent of Black–Scholes. Missing or stale active legs
 * make total unavailable. Closed-market quotes retain their original timestamp.
 * settlementPrice is the option's per-unit cash value, not the underlying index.
 */
export function markToMarket(legs, quotesById, { asOf = new Date().toISOString(), maxAgeMs = 90_000, marketStatus = 'unknown' } = {}) {
  const valuationTime = dateValue(asOf);
  if (!(maxAgeMs >= 0)) throw new RangeError('Maximum quote age must be nonnegative.');
  const closed = String(marketStatus).toLowerCase() === 'closed';
  let partialTotal = 0;
  let complete = true;
  let oldestTimestamp = Infinity;
  let oldestTradeTimestamp = Infinity;
  const marked = enabledLegs(legs).map(leg => {
    const row = { id: leg.id, price: null, pl: null, status: 'missing', asOf: null, lastTradedAt: null };
    const expiresAt = legExpiryTime(leg);
    if (expiresAt <= valuationTime) {
      const settled = settledOptionValue(leg, valuationTime);
      if (settled === null) {
        complete = false;
        return { ...row, status: 'expired' };
      }
      const pl = legUnits(leg) * (settled - leg.premium);
      partialTotal += pl;
      return { ...row, price: settled, pl, status: 'available', asOf: new Date(expiresAt).toISOString() };
    }
    const quote = leg.contractId
      ? quotesById instanceof Map ? quotesById.get(leg.contractId) : quotesById?.[leg.contractId]
      : null;
    const quoteTime = quote?.asOf == null ? NaN : new Date(quote.asOf).getTime();
    if (!quote || !Number.isFinite(quote.ltp) || quote.ltp < 0 || !Number.isFinite(quoteTime)) {
      complete = false;
      return row;
    }
    oldestTimestamp = Math.min(oldestTimestamp, quoteTime);
    const timestamp = new Date(quoteTime).toISOString();
    const lastTradeTime = quote.lastTradedAt == null ? NaN : new Date(quote.lastTradedAt).getTime();
    const lastTradedAt = Number.isFinite(lastTradeTime) ? new Date(lastTradeTime).toISOString() : null;
    if (lastTradedAt !== null) oldestTradeTimestamp = Math.min(oldestTradeTimestamp, lastTradeTime);
    const age = valuationTime - quoteTime;
    const tradeAge = valuationTime - lastTradeTime;
    // A clock far ahead of the valuation snapshot is not evidence of freshness.
    // A recent feed snapshot can still carry an illiquid option's old LTP.
    if (age < -maxAgeMs || tradeAge < -maxAgeMs
      || (!closed && (age > maxAgeMs || tradeAge > maxAgeMs))) {
      complete = false;
      return { ...row, price: quote.ltp, status: 'stale', asOf: timestamp, lastTradedAt };
    }
    const pl = legUnits(leg) * (quote.ltp - leg.premium);
    partialTotal += pl;
    return { ...row, price: quote.ltp, pl, status: closed ? 'closed' : 'available', asOf: timestamp, lastTradedAt };
  });
  return {
    total: complete ? partialTotal : null,
    partialTotal,
    complete,
    legs: marked,
    oldestQuoteAt: oldestTimestamp === Infinity ? null : new Date(oldestTimestamp).toISOString(),
    oldestLastTradedAt: oldestTradeTimestamp === Infinity ? null : new Date(oldestTradeTimestamp).toISOString(),
  };
}

function deduplicate(values) {
  return values.sort((a, b) => a - b).filter((value, index, all) => index === 0 || Math.abs(value - all[index - 1]) > 1e-5);
}

function bisect(fn, left, right) {
  let leftValue = fn(left);
  for (let step = 0; step < 65; step++) {
    const midpoint = (left + right) / 2;
    const value = fn(midpoint);
    if (Math.abs(value) < 1e-8) return midpoint;
    if (Math.sign(value) === Math.sign(leftValue)) {
      left = midpoint;
      leftValue = value;
    } else right = midpoint;
  }
  return (left + right) / 2;
}

function exactExpiryProfile(legs, lotSize, valuationTime) {
  const knots = deduplicate([0, ...legs.map(leg => leg.strike)]);
  const payoff = spot => payoffAtExpiry(legs, spot, lotSize, valuationTime);
  const values = knots.map(payoff);
  const roots = [];
  for (let index = 0; index < knots.length - 1; index++) {
    const left = values[index];
    const right = values[index + 1];
    if (Math.abs(left) < EPSILON && Math.abs(right) >= EPSILON) roots.push(knots[index]);
    if (left * right < 0) roots.push(knots[index] - left * (knots[index + 1] - knots[index]) / (right - left));
    if (Math.abs(right) < EPSILON && Math.abs(left) >= EPSILON) roots.push(knots[index + 1]);
  }
  const tailSlope = legs.reduce((sum, leg) => sum + (settledOptionValue(leg, valuationTime) === null && isCall(leg.type) ? legUnits(leg, lotSize) : 0), 0);
  const tailX = knots.at(-1);
  const tailY = values.at(-1);
  if (Math.abs(tailSlope) > EPSILON) {
    const tailRoot = tailX - tailY / tailSlope;
    if (tailRoot >= tailX) roots.push(tailRoot);
  }
  return {
    payoff,
    breakevens: deduplicate(roots),
    maximum: tailSlope > EPSILON ? Infinity : Math.max(...values),
    minimum: tailSlope < -EPSILON ? -Infinity : Math.min(...values),
  };
}

/** Mixed expiries are valued at the first expiry, retaining later legs' time value. */
function mixedExpiryProfile(legs, spot, lotSize, rate, baseDate, targetTime) {
  const valuationTime = dateValue(baseDate);
  const daysForward = Math.max(0, (targetTime - valuationTime) / DAY_MS);
  const payoff = price => scenarioPayoff(legs, price, daysForward, 0, lotSize, rate, baseDate);
  const tailSlope = legs.reduce((sum, leg) => sum + (settledOptionValue(leg, valuationTime) === null && isCall(leg.type) ? legUnits(leg, lotSize) : 0), 0);
  const tailIntercept = legs.reduce((sum, leg) => {
    const settled = settledOptionValue(leg, valuationTime);
    if (settled !== null) return sum + legUnits(leg, lotSize) * (settled - leg.premium);
    const years = Math.max(0, (legExpiryTime(leg) - targetTime) / DAY_MS / YEAR_DAYS);
    const asymptote = isCall(leg.type) ? -leg.strike * Math.exp(-rate * years) : 0;
    return sum + legUnits(leg, lotSize) * (asymptote - leg.premium);
  }, 0);
  const strikeScale = Math.max(spot, ...legs.map(leg => leg.strike), 1);
  const upper = Math.max(strikeScale * 5, Math.abs(tailIntercept / (tailSlope || lotSize)) * 2 + strikeScale);
  const knots = deduplicate([0, ...legs.map(leg => leg.strike), ...Array.from({ length: 1001 }, (_, index) => upper * index / 1000)]);
  const derivative = price => legs.reduce((sum, leg) => {
    if (settledOptionValue(leg, valuationTime) !== null) return sum;
    const years = Math.max(0, (legExpiryTime(leg) - targetTime) / DAY_MS / YEAR_DAYS);
    const greeks = optionGreeks(price, leg.strike, years, (leg.iv ?? DEFAULT_IV) / 100, rate, leg.type);
    return sum + legUnits(leg, lotSize) * greeks.delta;
  }, 0);
  // Include smooth turning points before looking for roots. A very narrow
  // profitable interval can otherwise sit between two sampled loss points.
  const turningPoints = [];
  for (let index = 0; index < knots.length - 1; index++) {
    const left = knots[index];
    const right = knots[index + 1];
    if (derivative(left) * derivative(right) < 0) turningPoints.push(bisect(derivative, left, right));
  }
  const profileKnots = deduplicate([...knots, ...turningPoints]);
  const roots = [];
  const extrema = [payoff(0), payoff(upper)];
  for (let index = 0; index < profileKnots.length - 1; index++) {
    const left = profileKnots[index];
    const right = profileKnots[index + 1];
    const leftValue = payoff(left);
    const rightValue = payoff(right);
    extrema.push(leftValue, rightValue);
    if (Math.abs(leftValue) < EPSILON && Math.abs(rightValue) >= EPSILON) roots.push(left);
    if (leftValue * rightValue < 0) roots.push(bisect(payoff, left, right));
    if (Math.abs(rightValue) < EPSILON && Math.abs(leftValue) >= EPSILON) roots.push(right);
  }
  if (Math.abs(tailSlope) < EPSILON) extrema.push(tailIntercept);
  return {
    payoff,
    breakevens: deduplicate(roots),
    maximum: tailSlope > EPSILON ? Infinity : Math.max(...extrema),
    minimum: tailSlope < -EPSILON ? -Infinity : Math.min(...extrema),
  };
}

function probabilityOfProfit(profile, spot, years, iv, rate) {
  if (years <= 0 || iv <= 0 || spot <= 0) {
    const terminalSpot = spot * Math.exp(rate * Math.max(years, 0));
    return profile.payoff(terminalSpot) > EPSILON ? 100 : 0;
  }
  const volatility = iv / 100;
  const logMean = Math.log(spot) + (rate - volatility * volatility / 2) * years;
  const logDeviation = volatility * Math.sqrt(years);
  const cdf = price => price === Infinity ? 1 : price <= 0 ? 0 : normalCDF((Math.log(price) - logMean) / logDeviation);
  const boundaries = [0, ...profile.breakevens.filter(value => value > 0), Infinity];
  let probability = 0;
  for (let index = 0; index < boundaries.length - 1; index++) {
    const left = boundaries[index];
    const right = boundaries[index + 1];
    const sample = right === Infinity ? Math.max(left * 2, left + spot, 1) : (left + right) / 2;
    if (profile.payoff(sample) > EPSILON) probability += cdf(right) - cdf(left);
  }
  return Math.max(0, Math.min(100, probability * 100));
}

export function analyzeStrategy(legs, spot, lotSize = 1, iv = DEFAULT_IV, rate = DEFAULT_RATE, baseDate = DEMO_DATE) {
  const active = enabledLegs(legs);
  const valuationTime = dateValue(baseDate);
  const greeks = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  if (!active.length) {
    return { maxProfit: 0, maxLoss: 0, breakevens: [], netPremium: 0, ...greeks, pop: 0, rewardRisk: 0, mixedExpiry: false, analysisExpiry: null, daysToExpiry: 0 };
  }
  const unsettled = active.filter(leg => settledOptionValue(leg, valuationTime) === null);
  const analysisLegs = unsettled.length ? unsettled : active;
  const firstLeg = analysisLegs.reduce((first, leg) => legExpiryTime(leg) < legExpiryTime(first) ? leg : first);
  const mixedExpiry = new Set(unsettled.map(legExpiryTime)).size > 1;
  const analysisExpiry = firstLeg.expiry;
  const targetTime = Math.max(valuationTime, legExpiryTime(firstLeg));
  const days = Math.max(0, (targetTime - valuationTime) / DAY_MS);
  const profile = mixedExpiry
    ? mixedExpiryProfile(active, spot, lotSize, rate, baseDate, targetTime)
    : exactExpiryProfile(active, lotSize, valuationTime);
  for (const leg of active) {
    if (settledOptionValue(leg, valuationTime) !== null) continue;
    const years = Math.max(0, (legExpiryTime(leg) - valuationTime) / DAY_MS / YEAR_DAYS);
    const individual = optionGreeks(spot, leg.strike, years, (leg.iv ?? iv) / 100, rate, leg.type);
    for (const name of Object.keys(greeks)) greeks[name] += individual[name] * legUnits(leg, lotSize);
  }
  const maxProfit = Math.max(0, profile.maximum);
  const maxLoss = Math.max(0, -profile.minimum);
  return {
    maxProfit,
    maxLoss,
    breakevens: profile.breakevens,
    netPremium: active.reduce((sum, leg) => sum - leg.premium * legUnits(leg, lotSize), 0),
    ...greeks,
    pop: probabilityOfProfit(profile, spot, days / YEAR_DAYS, iv, rate),
    rewardRisk: maxLoss === Infinity ? 0 : maxLoss > 0 ? maxProfit / maxLoss : maxProfit > 0 ? Infinity : 0,
    mixedExpiry,
    analysisExpiry,
    daysToExpiry: days,
  };
}
