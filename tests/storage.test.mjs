import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, readPositions, writePositions, validatePosition, validateWorkspace, parseImport, makeBackup } from '../src/storage.js';
import { makeStrategy } from '../src/data.js';

function position(overrides = {}) {
  return {
    id: 'position-example',
    name: 'My call spread',
    marketSymbol: 'NIFTY',
    expiry: '2026-10-30',
    legs: makeStrategy(),
    notes: 'Watch the upper strike.',
    createdAt: '2026-10-26T06:30:00Z',
    updatedAt: '2026-10-26T07:30:00Z',
    rate: 0.06,
    ...overrides,
  };
}

function memoryStorage(initial = null) {
  let value = initial;
  let writes = 0;
  return {
    getItem(key) { assert.equal(key, STORAGE_KEY); return value; },
    setItem(key, next) { assert.equal(key, STORAGE_KEY); writes++; value = next; },
    get value() { return value; },
    get writes() { return writes; },
  };
}

test('empty browser library reads as an empty array', () => {
  const storage = memoryStorage();
  assert.deepEqual(readPositions(storage), []);
  assert.equal(storage.writes, 0);
});

test('an empty workspace draft validates while an empty saved position still fails', () => {
  const draft = position({ name: 'Untitled strategy', legs: [] });
  const restored = validateWorkspace(draft);
  assert.deepEqual(restored.legs, []);
  assert.equal(restored.name, 'Untitled strategy');
  assert.equal(restored.marketSymbol, 'NIFTY');
  assert.equal(restored.rate, 0.06);
  assert.notEqual(restored, draft);
  assert.throws(() => validatePosition(draft), /1–24/);
  assert.throws(() => makeBackup([draft]), /1–24/);
});

test('workspace validation still rejects malformed legs, oversized drafts, and invalid fields', () => {
  const invalidLeg = position();
  invalidLeg.legs[0].premium = Infinity;
  assert.throws(() => validateWorkspace(invalidLeg), /Leg 1 premium/);
  assert.throws(() => validateWorkspace(position({ legs: new Array(1) })), /Leg 1 must be an object/);
  assert.throws(() => validateWorkspace(position({ legs: Array.from({ length: 25 }, () => makeStrategy()[0]) })), /0–24/);
  assert.throws(() => validateWorkspace(position({ legs: [], marketSymbol: 'UNKNOWN' })), /market/);
  assert.throws(() => validateWorkspace(position({ legs: [], expiry: '2026-02-30' })), /date/);
  assert.throws(() => validateWorkspace(position({ legs: [], rate: NaN })), /Interest rate/);
  const disabled = position(); disabled.legs.forEach(leg => { leg.enabled = false; });
  assert.ok(validateWorkspace(disabled).legs.every(leg => !leg.enabled));
});

test('saving and reading preserve every supported position and leg field', () => {
  const storage = memoryStorage();
  const input = position();
  input.legs[1].enabled = false;
  input.legs[1].expiry = '2026-11-06';
  const saved = writePositions([input], storage);
  assert.equal(storage.writes, 1);
  assert.deepEqual(readPositions(storage), saved);
  assert.equal(saved[0].notes, input.notes);
  assert.equal(saved[0].legs[1].enabled, false);
  assert.equal(saved[0].legs[1].expiry, '2026-11-06');
  assert.equal(saved[0].createdAt, '2026-10-26T06:30:00.000Z');
  input.legs[0].strike = 1;
  assert.equal(saved[0].legs[0].strike, 24500);
});

test('sanitization trims names and removes unrelated nested and top-level fields', () => {
  const input = position({ name: '  Thoughtful spread  ', injection: '<script>bad()</script>' });
  input.legs[0].unexpected = { html: '<b>text</b>' };
  const saved = validatePosition(input);
  assert.equal(saved.name, 'Thoughtful spread');
  assert.equal(Object.hasOwn(saved, 'injection'), false);
  assert.equal(Object.hasOwn(saved.legs[0], 'unexpected'), false);
  assert.equal(input.name, '  Thoughtful spread  ');
});

test('missing IDs, notes, timestamps, rate and enabled state receive safe defaults', () => {
  const input = position({ id: undefined, notes: undefined, createdAt: undefined, updatedAt: undefined, rate: undefined });
  input.legs[0].id = undefined;
  input.legs[0].enabled = undefined;
  input.legs[0].expiry = undefined;
  const output = validatePosition(input);
  assert.ok(output.id.length > 0);
  assert.ok(output.legs[0].id.length > 0);
  assert.equal(output.notes, '');
  assert.equal(output.rate, 0.06);
  assert.equal(output.legs[0].enabled, true);
  assert.equal(output.legs[0].expiry, output.expiry);
  assert.equal(output.createdAt, output.updatedAt);
});

test('backups have version and export metadata and round-trip with the importer', () => {
  const source = [position()];
  const json = makeBackup(source);
  const backup = JSON.parse(json);
  assert.equal(backup.app, 'Folio');
  assert.equal(backup.version, 1);
  assert.ok(Number.isFinite(Date.parse(backup.exportedAt)));
  assert.deepEqual(parseImport(json), source.map(validatePosition));
  assert.deepEqual(parseImport(JSON.stringify(source)), source.map(validatePosition));
});

test('imports reject malformed JSON, wrong versions and malformed collections', () => {
  assert.throws(() => parseImport('{broken'), /invalid JSON/);
  assert.throws(() => parseImport(JSON.stringify({version: 2, positions: []})), /version/);
  assert.throws(() => parseImport(JSON.stringify({version: 1, positions: {}})), /array/);
  assert.throws(() => parseImport('null'), /object/);
  assert.throws(() => parseImport({}), /JSON text/);
  assert.throws(() => parseImport(' '.repeat(12_000_001)), /too large/);
});

test('corrupt saved data is reported without changing or clearing the raw value', () => {
  for (const raw of ['not JSON', 'null', JSON.stringify([position({ marketSymbol: 'UNKNOWN' })])]) {
    const storage = memoryStorage(raw);
    assert.throws(() => readPositions(storage), /unreadable.*has not been changed/);
    assert.equal(storage.value, raw);
    assert.equal(storage.writes, 0);
  }
});

test('unavailable storage and storage access failures produce actionable errors', () => {
  assert.throws(() => readPositions(null), /Enable browser site storage/);
  assert.throws(() => writePositions([position()], null), /Enable browser site storage.*JSON backup/);
  const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.throws(() => readPositions(storage), /could not be read/);
  assert.throws(() => writePositions([position()], storage), /could not be saved/);
});

test('the default browser storage accessor is guarded even when reading it throws', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Blocked storage'); } });
    assert.throws(() => readPositions(), /could not be read/);
    assert.throws(() => writePositions([position()]), /could not be saved/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('quota failures keep earlier data and advise exporting a backup', () => {
  let raw = 'old-value';
  const storage = {
    getItem() { return raw; },
    setItem() { const error = new Error('full'); error.name = 'QuotaExceededError'; throw error; },
  };
  assert.throws(() => writePositions([position()], storage), /storage is full.*Export a JSON backup/);
  assert.equal(raw, 'old-value');
});

test('validation failures cannot partially write or overwrite a saved library', () => {
  const storage = memoryStorage('old-value');
  assert.throws(() => writePositions([position(), position({id:'invalid-position',name:''})], storage), /Position name/);
  assert.equal(storage.value, 'old-value');
  assert.equal(storage.writes, 0);
  assert.throws(() => writePositions(new Array(1), storage), /Position must be an object/);
  assert.throws(() => writePositions([position({legs:new Array(1)})], storage), /Leg 1 must be an object/);
  assert.equal(storage.writes, 0);
});

test('collection and leg limits, duplicate IDs, and string bounds are enforced', () => {
  assert.throws(() => makeBackup(Array.from({length:501}, (_,index) => position({id:`p-${index}`}))), /500/);
  assert.throws(() => makeBackup([position(), position()]), /unique ID/);
  assert.throws(() => validatePosition(position({legs:[]})), /1–24/);
  assert.throws(() => validatePosition(position({legs:Array.from({length:25}, () => makeStrategy()[0])})), /1–24/);
  const duplicate = position(); duplicate.legs[1].id = duplicate.legs[0].id;
  assert.throws(() => validatePosition(duplicate), /unique ID/);
  assert.throws(() => validatePosition(position({name:'x'.repeat(81)})), /1–80/);
  assert.throws(() => validatePosition(position({notes:'x'.repeat(4001)})), /0–4000/);
  assert.throws(() => validatePosition(position({id:'x'.repeat(161)})), /1–160/);
});

test('known markets and real ISO calendar dates are required, including each leg expiry', () => {
  assert.throws(() => validatePosition(position({marketSymbol:'UNKNOWN'})), /market/);
  for (const expiry of ['2025-12-31', '2026-02-30', '2026-13-01', '2026-1-01', '2026-10-30T10:00:00Z']) {
    assert.throws(() => validatePosition(position({expiry})), /date/);
  }
  const leap = validatePosition(position({expiry:'2028-02-29'}));
  assert.equal(leap.expiry, '2028-02-29');
  const input = position(); input.legs[0].expiry = '2026-02-30';
  assert.throws(() => validatePosition(input), /Leg 1 expiry/);
});

test('invalid nonfinite, out-of-range, fractional and wrong-type numeric values are rejected', () => {
  const badValues = {
    strike: [0, -1, 10_000_001, NaN, Infinity, '24500'],
    lots: [0, 101, 1.5, NaN, '1'],
    premium: [-1, 10_000_001, Infinity, null],
    iv: [0, 0.09, 301, NaN, '14.2'],
  };
  for (const [field, values] of Object.entries(badValues)) for (const value of values) {
    const input = position(); input.legs[0][field] = value;
    assert.throws(() => validatePosition(input), /Leg 1/);
  }
  for (const rate of [NaN, Infinity, -1.1, 1.1, '0.06']) assert.throws(() => validatePosition(position({rate})), /Interest rate/);
  const edge = position(); Object.assign(edge.legs[0], {strike:10_000_000, lots:100, premium:0, iv:300});
  assert.equal(validatePosition(edge).legs[0].premium, 0);
});

test('invalid enum values, enabled state, and timestamps cannot enter a library', () => {
  for (const patch of [{side:'hold'}, {type:'call'}, {enabled:'true'}]) {
    const input = position(); Object.assign(input.legs[0], patch);
    assert.throws(() => validatePosition(input), /Leg 1/);
  }
  assert.throws(() => validatePosition(position({createdAt:'tomorrow'})), /Created date/);
  assert.throws(() => validatePosition(position({updatedAt:{}})), /Updated date/);
});
