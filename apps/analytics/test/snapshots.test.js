import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, partitionHolds, WEEKS, SCHEMA_VERSION } from '../lib/snapshots.js';
import { aggregate } from '../lib/metrics.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const OP = '94a88288-43aa-445b-abb8-7dc895804b51';
const SEG = { users: { [OP]: 'internal', 'u-beta': 'beta' }, devices: {} };
const row = (over) => ({ name: 'opened_app', device_id: 'd', user_id: null, session_id: 's', created_at: '2026-08-20T00:00:00Z', ...over });

test('schema version is 2 — the v2 definitions are a new reporting identity', () => {
  assert.equal(SCHEMA_VERSION, 2);
});

test('a snapshot freezes the classification it was computed with', () => {
  const week = WEEKS.weekOf(new Date('2026-08-20T00:00:00Z'));
  const snap = buildSnapshot([row({ user_id: OP })], {
    population: 'internal', segments: SEG, linkedDevices: new Set(), week,
    finalised: true, reason: 'test',
  });
  assert.deepEqual(snap.segments_used.users, SEG.users);
  assert.equal(snap.finalised, true);
  assert.equal(snap.rebuild_reason, 'test');
  assert.equal(snap.week_start, week.weekStart);
});

test('snapshot arithmetic IS the live summary arithmetic — same module, same numbers', () => {
  const rows = [row({ user_id: 'u1', session_id: 's1' }), row({ session_id: 's2' })];
  const week = WEEKS.weekOf(new Date('2026-08-20T00:00:00Z'));
  const snap = buildSnapshot(rows, { population: 'public', segments: SEG, linkedDevices: new Set(), week });
  const live = aggregate(rows, { population: 'public', segments: SEG, linkedDevices: new Set() });
  assert.deepEqual(snap.metrics, live.metrics);
});

test('the partition property: populations sum to all, and a broken sum is caught', () => {
  const rows = [row({ user_id: OP }), row({ user_id: 'u-beta' }), row({ user_id: 'u-pub' }), row({})];
  const week = WEEKS.weekOf(new Date('2026-08-20T00:00:00Z'));
  const by = {};
  for (const p of ['public', 'internal', 'beta', 'test', 'all']) {
    by[p] = buildSnapshot(rows, { population: p, segments: SEG, linkedDevices: new Set(), week });
  }
  assert.equal(partitionHolds(by), true);
  by.internal.metrics.events += 1; // corrupt one population
  assert.equal(partitionHolds(by), false);
});

test('the Sydney week model survives the move: Monday start, DST-aware boundaries', () => {
  const w = WEEKS.weekOf(new Date('2026-08-20T00:00:00Z')); // a Thursday UTC
  assert.equal(WEEKS.sydneyParts(w.startUTC).weekday, 1, 'weeks start Monday, Sydney-local');
  // DST starts Sunday 4 Oct 2026, so the week of 28 Sep is 167 hours.
  const dst = WEEKS.weekOf(new Date('2026-09-30T00:00:00Z'));
  const hours = (dst.endUTC - dst.startUTC) / 3600000;
  assert.equal(hours, 167, 'the spring-forward week is 167 hours, computed in local time');
});

// ── migration contract ───────────────────────────────────────────────

const migrations = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations');
const av6 = readFileSync(join(migrations, '20260829000000_av6_snapshots.sql'), 'utf8');

test('AV6: (version, population, week) is a UNIQUE identity', () => {
  assert.match(av6, /UNIQUE \(schema_version, population, week_start\)/);
});

test('AV6: sealed like every analytics table, and v1 artefacts are never dropped', () => {
  assert.match(av6, /REVOKE ALL ON analytics\.snapshots FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(av6, /DROP TABLE[^\n]*weekly_analytics_snapshots/i);
});
