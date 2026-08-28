import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDeviceSegments, missingLinks, segmentRowForNewMember, SEGMENTS } from '../lib/identity.js';

// The two approved decision uuids, pinned exactly as ratified.
const MADS = '6758a44e-64fd-4837-999c-838644503142';   // internal
const MADSPIN = 'c942c8f2-5df1-46f9-9bfc-89553f7448ce'; // public — NOT Mads

// ── deriveDeviceSegments: the approved asymmetry ─────────────────────

test('a device that ever carried an internal account derives internal', () => {
  const out = deriveDeviceSegments(
    [{ device_id: 'dev-1', user_id: MADS }],
    { [MADS]: 'internal' }
  );
  assert.deepEqual(out, { 'dev-1': 'internal' });
});

test('the rule derives internal ONLY — beta and public accounts derive nothing', () => {
  const out = deriveDeviceSegments(
    [
      { device_id: 'dev-beta', user_id: 'u-beta' },
      { device_id: 'dev-pub', user_id: 'u-pub' },
      { device_id: 'dev-test', user_id: 'u-test' },
    ],
    { 'u-beta': 'beta', 'u-test': 'test' } // u-pub unclassified = public
  );
  assert.deepEqual(out, {}, 'no non-internal segment may ever be device-derived');
});

test('a mixed device (internal + public accounts) derives internal for its anonymous rows', () => {
  const out = deriveDeviceSegments(
    [
      { device_id: 'shared', user_id: MADS },
      { device_id: 'shared', user_id: 'u-ordinary' },
    ],
    { [MADS]: 'internal' }
  );
  assert.deepEqual(out, { shared: 'internal' });
});

test('MADSPiN BABY is not Mads: their device derives nothing', () => {
  const out = deriveDeviceSegments(
    [{ device_id: 'dev-m', user_id: MADSPIN }],
    { [MADS]: 'internal' } // only the approved account is classified
  );
  assert.deepEqual(out, {}, 'c942c8f2 remains public; no name-similarity inference');
});

test('empty inputs derive an empty map, never a default', () => {
  assert.deepEqual(deriveDeviceSegments([], {}), {});
  assert.deepEqual(deriveDeviceSegments(undefined, undefined), {});
});

// ── missingLinks: the sweep's idempotency, as arithmetic ─────────────

test('a witnessed pair without a link is missing; a linked one is not', () => {
  const witnessed = [
    { device_id: 'd1', user_id: 'u1', first_seen: '2026-08-01' },
    { device_id: 'd2', user_id: 'u2', first_seen: '2026-08-02' },
  ];
  const links = [{ device_id: 'd1', user_id: 'u1' }];
  const out = missingLinks(witnessed, links);
  assert.equal(out.length, 1);
  assert.equal(out[0].device_id, 'd2');
});

test('running the sweep twice yields zero the second time — idempotent by construction', () => {
  const witnessed = [{ device_id: 'd1', user_id: 'u1', first_seen: '2026-08-01' }];
  const first = missingLinks(witnessed, []);
  const second = missingLinks(witnessed, first.map(({ device_id, user_id }) => ({ device_id, user_id })));
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
});

test('anonymous rows can never become links', () => {
  const out = missingLinks([{ device_id: 'd1', user_id: null, first_seen: '2026-08-01' }], []);
  assert.equal(out.length, 0);
});

// ── segmentRowForNewMember: team defaults never trump a deliberate act ─

test('joining a defaulted team materialises an explicit, explained row', () => {
  const row = segmentRowForNewMember({
    team: { id: 't1', name: 'YesPleez', default_segment: 'internal' },
    userId: MADS,
    existingSegment: null,
  });
  assert.equal(row.segment, 'internal');
  assert.equal(row.source, 'team_default');
  assert.match(row.note, /YesPleez/);
});

test('an existing classification is never touched by a roster edit — direct wins', () => {
  const row = segmentRowForNewMember({
    team: { id: 't1', name: 'YesPleez', default_segment: 'internal' },
    userId: 'u1',
    existingSegment: 'beta', // deliberately classified already
  });
  assert.equal(row, null);
});

test('a team without a default (public by absence) classifies nobody', () => {
  const row = segmentRowForNewMember({
    team: { id: 't2', name: 'Echo Valley', default_segment: null },
    userId: 'organiser-a',
    existingSegment: null,
  });
  assert.equal(row, null, 'Echo Valley organisers stay public — real users, never auto-internal');
});

test('SEGMENTS.PUBLIC exists as a concept but is never a storable row value', () => {
  assert.equal(SEGMENTS.PUBLIC, 'public');
  const row = segmentRowForNewMember({
    team: { id: 't3', name: 'x', default_segment: 'public' }, // constraint-impossible, but belt and braces
    userId: 'u1',
    existingSegment: null,
  });
  assert.equal(row, null);
});
