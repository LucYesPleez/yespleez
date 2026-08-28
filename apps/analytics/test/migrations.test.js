/**
 * MIGRATION CONTRACT TESTS — the SQL cannot run in CI, but its
 * load-bearing clauses can be pinned so an edit that drops one fails
 * here first. Same spirit as Scene's analytics.test.js pinning the
 * EVENTS list against the A1 CHECK.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const migrations = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations');
const av0 = readFileSync(join(migrations, '20260828000002_av0_analytics_schema.sql'), 'utf8');
const av1 = readFileSync(join(migrations, '20260828000003_av1_account_segments.sql'), 'utf8');

test('AV0 closes the schema to public keys and resets default privileges', () => {
  assert.match(av0, /REVOKE ALL ON SCHEMA analytics FROM PUBLIC, anon, authenticated/);
  assert.match(av0, /ALTER DEFAULT PRIVILEGES IN SCHEMA analytics\s+REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated/);
  assert.match(av0, /GRANT\s+USAGE ON SCHEMA analytics TO service_role/);
});

test('AV0 never touches the raw event store', () => {
  // The only statements allowed to name usage_events are assertions.
  const statements = av0
    .split('\n')
    .filter((l) => /usage_events/.test(l) && !/^\s*--/.test(l));
  for (const line of statements) {
    assert.doesNotMatch(line, /ALTER TABLE|DROP|INSERT|UPDATE|DELETE|TRUNCATE/i, 'AV0 mutates usage_events: ' + line.trim());
  }
});

test("AV1 stores 'public' as absence — the CHECK must exclude it", () => {
  assert.match(av1, /CHECK \(segment IN \('internal', 'beta', 'test'\)\)/);
  assert.doesNotMatch(av1, /segment IN \([^)]*'public'/);
});

test('AV1 records provenance and copies the legacy rows idempotently', () => {
  assert.match(av1, /CHECK \(source IN \('direct', 'team_default', 'system'\)\)/);
  assert.match(av1, /ON CONFLICT \(user_id\) DO NOTHING/);
  assert.match(av1, /FROM public\.analytics_account_segments/);
});

test('AV1 keeps the legacy table alive — Studio still reads it until Phase F', () => {
  assert.doesNotMatch(av1, /DROP TABLE\s+(IF EXISTS\s+)?public\.analytics_account_segments/i);
});

test('both migrations verify positively, in the A1 house style', () => {
  for (const [name, sql] of [['AV0', av0], ['AV1', av1]]) {
    assert.match(sql, /RAISE EXCEPTION/, name + ' has no failing assertions');
    assert.match(sql, /RAISE NOTICE '\w+ PASSED/, name + ' has no passing notices');
  }
});

test('no migration introduces IP, user-agent or geolocation storage', () => {
  for (const sql of [av0, av1]) {
    assert.doesNotMatch(sql, /\bip_address\b|\buser_agent\b|\bgeolocation\b|\binet\b/i);
  }
});
