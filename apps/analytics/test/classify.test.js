/**
 * THE AUDIT'S TEST MATRIX — T1–T17, against the canonical classifier
 * and the canonical metrics. Pure fixtures, no network, no clock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, inPopulation, deriveDeviceSegments } from '../lib/identity.js';
import { aggregate } from '../lib/metrics.js';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const MADS = '6758a44e-64fd-4837-999c-838644503142';
const MADSPIN = 'c942c8f2-5df1-46f9-9bfc-89553f7448ce';
const OP = '94a88288-43aa-445b-abb8-7dc895804b51';

const SEG = { users: { [OP]: 'internal', [MADS]: 'internal', 'u-beta': 'beta' }, devices: { 'dev-op-1': 'internal' } };

const row = (over) => ({ name: 'opened_app', device_id: 'd', user_id: null, session_id: 's', created_at: '2026-08-28T00:00:00Z', ...over });

// T1–T4 · an internal person is internal on every device and network —
// network is not an input, so there is nothing to vary but the device.
test('T1–T4: internal account classifies internal regardless of device', () => {
  for (const device_id of ['desktop-chrome', 'iphone-safari', 'pwa-standalone', 'brand-new']) {
    assert.equal(classify(row({ user_id: OP, device_id }), SEG), 'internal');
  }
});

test('T5: Mads (6758a44e) is internal; MADSPiN BABY (c942c8f2) is public', () => {
  assert.equal(classify(row({ user_id: MADS }), SEG), 'internal');
  assert.equal(classify(row({ user_id: MADSPIN }), SEG), 'public');
});

test('T6: an ordinary authenticated account is public', () => {
  assert.equal(classify(row({ user_id: 'u-ordinary' }), SEG), 'public');
});

test('T7: an anonymous visitor on an unregistered device is public', () => {
  assert.equal(classify(row({ device_id: 'stranger-device' }), SEG), 'public');
});

test('T8: one person, five devices → 1 person, 5 devices', () => {
  const rows = ['d1', 'd2', 'd3', 'd4', 'd5'].map((d, i) =>
    row({ user_id: 'u1', device_id: d, session_id: 's' + i }));
  const out = aggregate(rows, { population: 'public', segments: SEG });
  assert.equal(out.metrics.authenticated_people, 1);
  assert.equal(out.metrics.devices, 5);
});

test('T9: 3 sessions producing 40 session_end rows count as 3, not 40', () => {
  const rows = [];
  for (let i = 0; i < 40; i++) {
    rows.push(row({ name: 'session_end', user_id: 'u1', session_id: 'sess-' + (i % 3) }));
  }
  const out = aggregate(rows, { population: 'public', segments: SEG });
  assert.equal(out.metrics.sessions, 3);
  assert.equal(out.metrics.by_name.session_end, 40, 'raw lifecycle evidence stays visible');
});

test('T10: a device-id reset mid-window keeps the person internal throughout', () => {
  const rows = [row({ user_id: OP, device_id: 'old-dev' }), row({ user_id: OP, device_id: 'new-dev' })];
  for (const r of rows) assert.equal(classify(r, SEG), 'internal');
  const out = aggregate(rows, { population: 'internal', segments: SEG });
  assert.equal(out.metrics.authenticated_people, 1);
  assert.equal(out.metrics.devices, 2);
});

test('T11: PWA and browser are two devices, one person, both internal', () => {
  const rows = [row({ user_id: MADS, device_id: 'browser-id' }), row({ user_id: MADS, device_id: 'pwa-id' })];
  const out = aggregate(rows, { population: 'internal', segments: SEG });
  assert.equal(out.metrics.authenticated_people, 1);
  assert.equal(out.metrics.devices, 2);
});

test('T12: unknown device, no account → public; unknown NEVER silently internal', () => {
  assert.equal(classify(row({ device_id: 'never-seen' }), {}), 'public');
  assert.equal(classify({}, undefined), 'public');
});

test('T13: pre-login anonymous rows stay anonymous; the device classifies internal via the link rule', () => {
  const links = [{ device_id: 'shared-dev', user_id: OP }];
  const devices = deriveDeviceSegments(links, SEG.users);
  const seg = { users: SEG.users, devices };
  const anonBefore = row({ device_id: 'shared-dev', user_id: null });
  const attributedAfter = row({ device_id: 'shared-dev', user_id: OP });
  assert.equal(classify(anonBefore, seg), 'internal', 'classification, not attribution');
  assert.equal(anonBefore.user_id, null, 'the raw row is never rewritten');
  assert.equal(classify(attributedAfter, seg), 'internal');
});

test('T14: zero internal rows survive the public filter', () => {
  const rows = [
    row({ user_id: OP }),                          // internal account
    row({ user_id: null, device_id: 'dev-op-1' }), // internal device, anonymous
    row({ user_id: 'u-ordinary', device_id: 'x' }),
    row({ user_id: null, device_id: 'stranger' }),
  ];
  const out = aggregate(rows, { population: 'public', segments: SEG });
  assert.equal(out.metrics.events, 2);
  for (const r of rows) {
    if (classify(r, SEG) === 'internal') assert.equal(inPopulation(r, SEG, 'public'), false);
  }
});

test('T15: a shared device — attributed rows classify by their OWN account; anonymous rows go internal', () => {
  const links = [
    { device_id: 'family-pc', user_id: OP },
    { device_id: 'family-pc', user_id: 'u-ordinary' },
  ];
  const seg = { users: SEG.users, devices: deriveDeviceSegments(links, SEG.users) };
  assert.equal(classify(row({ device_id: 'family-pc', user_id: 'u-ordinary' }), seg), 'public',
    'the ordinary account is NOT dragged internal by sharing hardware');
  assert.equal(classify(row({ device_id: 'family-pc', user_id: OP }), seg), 'internal');
  assert.equal(classify(row({ device_id: 'family-pc', user_id: null }), seg), 'internal',
    'anonymous rows on a mixed device: internal wins');
});

// T16 · dashboard ≡ snapshot: both consume ONE classify. Guarded
// structurally — no second `function classify` or device-only
// segmentOf may exist anywhere in the service.
test('T16: exactly one classifier exists in the service', () => {
  const libDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib');
  let defs = 0;
  for (const f of readdirSync(libDir)) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(join(libDir, f), 'utf8');
    defs += (src.match(/function classify\(/g) || []).length;
    assert.doesNotMatch(src, /function segmentOf\(/, 'device-only classifier resurrected in ' + f);
  }
  assert.equal(defs, 1, 'expected exactly one classify() definition, found ' + defs);
});

// T17 · output independent of any browser state: aggregate is pure —
// same rows + same segments = identical output, twice.
test('T17: identical inputs produce identical output — nothing else can influence it', () => {
  const rows = [row({ user_id: 'u1' }), row({ device_id: 'd2', session_id: 's2' })];
  const a = aggregate(rows, { population: 'public', segments: SEG, linkedDevices: new Set(['d']) });
  const b = aggregate(rows, { population: 'public', segments: SEG, linkedDevices: new Set(['d']) });
  assert.deepEqual(a, b);
});

// ── beyond the matrix ────────────────────────────────────────────────

test("'all' is genuinely unfiltered — D6 stays closed", () => {
  const rows = [row({ user_id: OP }), row({ user_id: 'u-ordinary' }), row({ user_id: 'u-beta' })];
  const out = aggregate(rows, { population: 'all', segments: SEG });
  assert.equal(out.metrics.events, 3);
});

test('beta is its own population, excluded from public', () => {
  const rows = [row({ user_id: 'u-beta' }), row({ user_id: 'u-ordinary' })];
  assert.equal(aggregate(rows, { population: 'beta', segments: SEG }).metrics.events, 1);
  assert.equal(aggregate(rows, { population: 'public', segments: SEG }).metrics.events, 1);
});

test('anonymous visitors = devices never linked to ANY account; reach = the named sum', () => {
  const rows = [
    row({ user_id: 'u1', device_id: 'd-linked' }),
    row({ user_id: null, device_id: 'd-linked', session_id: 's9' }), // signed-out on a linked device: NOT a visitor
    row({ user_id: null, device_id: 'd-stranger', session_id: 's8' }),
  ];
  const out = aggregate(rows, {
    population: 'public', segments: {}, linkedDevices: new Set(['d-linked']),
  });
  assert.equal(out.metrics.anonymous_visitors, 1);
  assert.equal(out.metrics.reach, 2); // 1 person + 1 visitor
});

test('absent linkedDevices omits the visitor metrics rather than guessing zero', () => {
  const out = aggregate([row({})], { population: 'public', segments: {} });
  assert.equal('anonymous_visitors' in out.metrics, false);
  assert.equal('reach' in out.metrics, false);
});

test('null session_ids are counted in the stated denominator, not vanished', () => {
  const rows = [row({ session_id: null }), row({ session_id: 's1' })];
  const out = aggregate(rows, { population: 'public', segments: {} });
  assert.equal(out.metrics.sessions, 1);
  assert.equal(out.metrics.sessions_null_rows, 1);
});
