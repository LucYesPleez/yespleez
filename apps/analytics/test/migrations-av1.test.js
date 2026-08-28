/** Contract tests for the AV2/AV3 migrations — same spirit as migrations.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const migrations = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations');
const av2 = readFileSync(join(migrations, '20260828000004_av2_teams.sql'), 'utf8');
const av3 = readFileSync(join(migrations, '20260828000005_av3_identity_links.sql'), 'utf8');

test('AV2: a team default cannot be public — absence is public, both axes', () => {
  assert.match(av2, /default_segment text CHECK \(default_segment IN \('internal', 'beta', 'test'\)\)/);
});

test('AV2: membership removal is soft — history is evidence', () => {
  assert.match(av2, /removed_at timestamptz/);
  assert.doesNotMatch(av2, /ON DELETE CASCADE[^\n]*team_members/);
});

test('AV3: links are unique per (device, account) and provenance-stamped', () => {
  assert.match(av3, /UNIQUE \(device_id, user_id\)/);
  assert.match(av3, /CHECK \(method IN \('observed', 'backfill'\)\)/);
});

test('AV3: the backfill stamps first co-occurrence, not the run date', () => {
  assert.match(av3, /min\(created_at\)/);
});

test('AV3 reads raw events and never writes them', () => {
  const lines = av3.split('\n').filter((l) => /usage_events/.test(l) && !/^\s*--/.test(l));
  for (const line of lines) {
    assert.doesNotMatch(line, /ALTER TABLE|DROP|INSERT INTO public\.usage_events|UPDATE|DELETE FROM public\.usage_events|TRUNCATE/i,
      'AV3 mutates usage_events: ' + line.trim());
  }
  assert.match(av3, /INSERT INTO analytics\.identity_links/);
});

test('AV3: the backfill is idempotent', () => {
  assert.match(av3, /ON CONFLICT \(device_id, user_id\) DO NOTHING/);
});

test('both migrations close their tables to public keys and verify positively', () => {
  for (const [name, sql] of [['AV2', av2], ['AV3', av3]]) {
    assert.match(sql, /REVOKE ALL ON [^\n]* FROM PUBLIC, anon, authenticated/, name);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/, name);
    assert.match(sql, /RAISE EXCEPTION/, name);
    assert.match(sql, /RAISE NOTICE 'V\d PASSED/, name);
  }
});

test('no migration introduces IP, user-agent or geolocation storage', () => {
  for (const sql of [av2, av3]) {
    assert.doesNotMatch(sql, /\bip_address\b|\buser_agent\b|\bgeolocation\b|\binet\b/i);
  }
});
