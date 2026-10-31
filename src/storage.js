import { MARKETS } from './data.js';
import { DEFAULT_RATE } from './engine.js';

export const STORAGE_KEY = 'folio.positions.v1';
const MAX_POSITIONS = 500;
const MAX_LEGS = 24;
const MAX_BACKUP_CHARS = 12_000_000;
const knownMarkets = new Set(MARKETS.map(market => market.symbol));
// These sizes belong to the original demo snapshot. Never migrate an old entry
// using a current instrument master: that would change its economic quantity.
const LEGACY_LOT_SIZES = Object.freeze({ NIFTY: 65, BANKNIFTY: 30, SENSEX: 20 });
const ENTRY_SOURCES = new Set(['legacy-demo', 'upstox', 'manual']);
const IV_SOURCES = new Set(['provider', 'calibrated', 'manual', 'unavailable']);
let nextId = 0;

function fail(message) {
  throw new Error(message);
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
}

function boundedString(value, label, maximum, { optional = false, trim = false } = {}) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string') fail(`${label} must be text.`);
  const result = trim ? value.trim() : value;
  if ((!optional && result.length === 0) || result.length > maximum) {
    fail(`${label} must contain ${optional ? '0' : '1'}–${maximum} characters.`);
  }
  return result;
}

function numberInRange(value, label, minimum, maximum, integer = false) {
  if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    const range = minimum === Number.MIN_VALUE ? `greater than 0 and no more than ${maximum}` : `between ${minimum} and ${maximum}`;
    fail(`${label} must be ${integer ? 'a whole number' : 'a finite number'} ${range}.`);
  }
  return value;
}

function identifier(value, prefix) {
  if (value === undefined || value === null || value === '') {
    return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now().toString(36)}-${(++nextId).toString(36)}`;
  }
  return boundedString(value, `${prefix === 'position' ? 'Position' : 'Leg'} ID`, 160, { trim: true });
}

function expiryDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 2026) {
    fail(`${label} must be a valid YYYY-MM-DD date from 2026 onwards.`);
  }
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    fail(`${label} must be a real calendar date.`);
  }
  return value;
}

function timestamp(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'string' && value.length > 40)) {
    fail(`${label} must be a valid timestamp.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) fail(`${label} must be a valid timestamp.`);
  return date.toISOString();
}

function isoTimestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    fail(`${label} must be an ISO timestamp with a timezone.`);
  }
  const day = value.slice(0, 10);
  const midnight = Date.parse(`${day}T00:00:00Z`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(midnight) || !Number.isFinite(parsed) || new Date(midnight).toISOString().slice(0, 10) !== day) {
    fail(`${label} must be a real ISO timestamp.`);
  }
  return new Date(parsed).toISOString();
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) fail(`${label} must be ${[...allowed].join(', ')}.`);
  return value;
}

function validateLeg(input, expiry, index, marketSymbol, dataMode) {
  const label = `Leg ${index + 1}`;
  record(input, label);
  if (input.side !== 'buy' && input.side !== 'sell') fail(`${label} side must be buy or sell.`);
  if (input.type !== 'CE' && input.type !== 'PE') fail(`${label} type must be CE or PE.`);
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') fail(`${label} enabled state must be true or false.`);
  const lots = numberInRange(input.lots, `${label} lots`, 1, 100, true);
  const legacy = input.lotSize === undefined && input.quantityUnits === undefined && dataMode !== 'live' && input.entryPriceSource !== 'upstox';
  const entryPriceSource = input.entryPriceSource === undefined
    ? (legacy ? 'legacy-demo' : undefined)
    : enumValue(input.entryPriceSource, ENTRY_SOURCES, `${label} entry price source`);
  const result = {
    id: identifier(input.id, 'leg'),
    side: input.side,
    type: input.type,
    strike: numberInRange(input.strike, `${label} strike`, Number.MIN_VALUE, 10_000_000),
    lots,
    premium: numberInRange(input.premium, `${label} premium`, 0, 10_000_000),
    iv: input.iv === null && (entryPriceSource === 'upstox' || (entryPriceSource === 'manual' && dataMode === 'live')) ? null : numberInRange(input.iv, `${label} IV`, 0.1, 300),
    expiry: expiryDate(input.expiry ?? expiry, `${label} expiry`),
    enabled: input.enabled ?? true,
  };
  if (input.contractId !== undefined) {
    const contractId = boundedString(input.contractId, `${label} contract ID`, 160, { trim: true });
    if (!/^[A-Z][A-Z0-9_]{0,29}\|[^|\r\n]+$/.test(contractId)) fail(`${label} contract ID must use the exchange|instrument format.`);
    result.contractId = contractId;
  }
  if (input.lotSize !== undefined) result.lotSize = numberInRange(input.lotSize, `${label} lot size`, 1, 1_000_000, true);
  else if (legacy) result.lotSize = LEGACY_LOT_SIZES[marketSymbol];
  if (input.quantityUnits !== undefined) result.quantityUnits = numberInRange(input.quantityUnits, `${label} quantity units`, 1, 100_000_000, true);
  else if (result.lotSize !== undefined) result.quantityUnits = lots * result.lotSize;
  if (entryPriceSource !== undefined) result.entryPriceSource = entryPriceSource;
  if (input.exchange !== undefined) result.exchange = boundedString(input.exchange, `${label} exchange`, 30, { trim: true });
  if (input.quoteSource !== undefined) result.quoteSource = boundedString(input.quoteSource, `${label} quote source`, 30, { trim: true });
  if (input.ivSource !== undefined) result.ivSource = enumValue(input.ivSource, IV_SOURCES, `${label} IV source`);
  if (input.entryAt !== undefined) result.entryAt = isoTimestamp(input.entryAt, `${label} entry time`);
  if (input.snapshotAt !== undefined) result.snapshotAt = isoTimestamp(input.snapshotAt, `${label} snapshot time`);
  if (input.expiresAt !== undefined) result.expiresAt = isoTimestamp(input.expiresAt, `${label} expiry time`);
  if (input.settlementPrice !== undefined) result.settlementPrice = numberInRange(input.settlementPrice, `${label} settlement price`, 0, 10_000_000);
  return result;
}

function validateRecord(input, minimumLegs) {
  record(input, 'Position');
  const name = boundedString(input.name, 'Position name', 80, { trim: true });
  if (!knownMarkets.has(input.marketSymbol)) fail('Position market must be NIFTY, BANKNIFTY, or SENSEX.');
  const expiry = expiryDate(input.expiry, 'Position expiry');
  const dataMode = input.dataMode === undefined ? undefined : enumValue(input.dataMode, new Set(['demo', 'live']), 'Position data mode');
  if (!Array.isArray(input.legs) || input.legs.length < minimumLegs || input.legs.length > MAX_LEGS) {
    fail(`A ${minimumLegs === 0 ? 'workspace' : 'position'} must contain ${minimumLegs}–${MAX_LEGS} option legs.`);
  }
  const legs = Array.from(input.legs, (leg, index) => validateLeg(leg, expiry, index, input.marketSymbol, dataMode));
  if (new Set(legs.map(leg => leg.id)).size !== legs.length) fail('Each leg in a position must have a unique ID.');
  const now = new Date().toISOString();
  const createdAt = timestamp(input.createdAt, now, 'Created date');
  const result = {
    id: identifier(input.id, 'position'),
    name,
    marketSymbol: input.marketSymbol,
    expiry,
    legs,
    notes: boundedString(input.notes, 'Position notes', 4000, { optional: true }),
    createdAt,
    updatedAt: timestamp(input.updatedAt, createdAt, 'Updated date'),
    rate: numberInRange(input.rate ?? DEFAULT_RATE, 'Interest rate', -1, 1),
  };
  if (dataMode !== undefined) result.dataMode = dataMode;
  if (input.baseDate !== undefined) result.baseDate = isoTimestamp(input.baseDate, 'Position base date');
  return result;
}

/** Return a fresh, allowlisted saved position containing at least one leg. */
export function validatePosition(input) {
  return validateRecord(input, 1);
}

/** Draft workspaces may be empty; all other position and leg rules still apply. */
export function validateWorkspace(input) {
  return validateRecord(input, 0);
}

function validatePositions(input) {
  if (!Array.isArray(input)) fail('Positions must be an array.');
  if (input.length > MAX_POSITIONS) fail(`A library can contain up to ${MAX_POSITIONS} positions. Export a backup before removing older positions.`);
  const positions = Array.from(input, validatePosition);
  if (new Set(positions.map(position => position.id)).size !== positions.length) fail('Every saved position must have a unique ID.');
  return positions;
}

/** Accept the versioned Folio backup format, or an array for portability. */
export function parseImport(jsonString) {
  if (typeof jsonString !== 'string') fail('Choose a JSON text backup to import.');
  if (jsonString.length > MAX_BACKUP_CHARS) fail('This backup is too large. Import a file smaller than 12 MB.');
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (cause) {
    throw new Error('This backup contains invalid JSON. Choose a Folio JSON backup.', { cause });
  }
  if (Array.isArray(parsed)) return validatePositions(parsed);
  record(parsed, 'Backup');
  if (parsed.version !== 1 && parsed.version !== 2) fail('This backup version is not supported. Use a Folio version 1 or 2 backup.');
  return validatePositions(parsed.positions);
}

function browserStorage(provided) {
  try {
    const storage = provided === undefined ? globalThis.localStorage : provided;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      fail('Browser storage is unavailable. Enable site storage or use a regular browser window, then try again.');
    }
    return storage;
  } catch (cause) {
    throw new Error('Browser storage is unavailable. Enable site storage or use a regular browser window, then try again.', { cause });
  }
}

/** A missing key is empty. Unreadable storage throws and is never overwritten. */
export function readPositions(storage) {
  let raw;
  try {
    raw = browserStorage(storage).getItem(STORAGE_KEY);
  } catch (cause) {
    throw new Error('Saved positions could not be read. Enable browser site storage and reload. Your existing data has not been changed.', { cause });
  }
  if (raw === null) return [];
  try {
    return parseImport(raw);
  } catch (cause) {
    throw new Error('Saved positions are unreadable. Keep this browser’s site data and restore a valid Folio backup before saving. Your existing data has not been changed.', { cause });
  }
}

/** Validation is atomic: no storage write occurs unless every position is valid. */
export function writePositions(positions, storage) {
  const sanitized = validatePositions(positions);
  const serialized = JSON.stringify(sanitized);
  try {
    browserStorage(storage).setItem(STORAGE_KEY, serialized);
  } catch (cause) {
    const quota = cause?.name === 'QuotaExceededError' || cause?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || cause?.code === 22 || cause?.code === 1014;
    throw new Error(quota
      ? 'Your browser storage is full. Export a JSON backup, then remove older saved positions and try again.'
      : 'Positions could not be saved. Enable browser site storage or export a JSON backup to keep your work.', { cause });
  }
  return sanitized;
}

export function makeBackup(positions) {
  return JSON.stringify({ app: 'Folio', version: 2, exportedAt: new Date().toISOString(), positions: validatePositions(positions) }, null, 2);
}
