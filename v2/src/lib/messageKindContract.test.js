import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * THE CLIENT'S KIND LIST MUST EQUAL THE DATABASE'S.
 *
 * `messageKinds.jsx` says it "MUST stay in step with the CHECK" in M9a. That
 * comment is the only thing holding the two together — nothing fails if a kind
 * is added to one and forgotten in the other, and the two failure modes are
 * both silent:
 *
 *   in the DB, not the client   the message stores fine and renders as an
 *                               unknown kind, telling the user to update an
 *                               app that is already current
 *   in the client, not the DB   the renderer exists and the insert is rejected
 *                               by the CHECK at send time
 *
 * ── WHY THIS PARSES SOURCE INSTEAD OF IMPORTING ──────────────────────
 *
 * `messageKinds.jsx` contains JSX, which `node --test` cannot parse — there is
 * no transform in the test runner. Restating the list here instead would prove
 * that this file's copy agrees with itself and notice nothing, which is the
 * one thing this test exists to catch. So BOTH sides are read as text and
 * neither is trusted.
 *
 * If the extraction below breaks, the guard test fails loudly rather than
 * silently comparing two empty arrays.
 */

const MIGRATION = fileURLToPath(
  new URL('../../../supabase/migrations/20260721000000_m9a_message_kinds.sql', import.meta.url),
);
const REGISTRY = fileURLToPath(new URL('./messageKinds.jsx', import.meta.url));

/** The kinds the DATABASE will accept — from `messages_kind_valid`. */
function kindsInMigration() {
  const sql = readFileSync(MIGRATION, 'utf8');
  const match = sql.match(/kind\s+IN\s*\(([^)]*)\)/i);
  if (!match) throw new Error('no `kind IN (...)` in the migration — has the CHECK been renamed?');
  return quoted(match[1]);
}

/** The kinds the CLIENT will render — from `export const KINDS`. */
function kindsInRegistry() {
  const src = readFileSync(REGISTRY, 'utf8');
  const match = src.match(/export\s+const\s+KINDS\s*=\s*\[([\s\S]*?)\]/);
  if (!match) throw new Error('no `export const KINDS = [...]` in messageKinds.jsx — has it been renamed?');
  return quoted(match[1]);
}

/** Single-quoted string literals, in order, ignoring comments and whitespace. */
function quoted(block) {
  return [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
}

test('the extraction actually found both lists', () => {
  // Guards every assertion below. Two regexes that quietly matched nothing
  // would make `deepEqual([], [])` pass and report a contract never checked.
  const db = kindsInMigration();
  const client = kindsInRegistry();
  assert.ok(db.length >= 5, `parsed only ${db.length} kinds from the migration: ${db}`);
  assert.ok(client.length >= 5, `parsed only ${client.length} kinds from the registry: ${client}`);
  assert.ok(db.includes('text') && client.includes('text'), 'text must appear in both');
});

test('the client kind list matches the database CHECK exactly', () => {
  // If this fails, one side was edited alone. Fix the list, not the test.
  assert.deepEqual(kindsInRegistry(), kindsInMigration());
});

test('every kind has a human label', () => {
  // A kind with no label renders unnamed in the fallback — an unplayable voice
  // note that does not say it is a voice note.
  const src = readFileSync(REGISTRY, 'utf8');
  const block = src.match(/export\s+const\s+LABELS\s*=\s*\{([\s\S]*?)\n\}/);
  assert.ok(block, 'no `export const LABELS = {...}` in messageKinds.jsx');

  const labelled = new Set([...block[1].matchAll(/^\s*(\w+)\s*:/gm)].map(m => m[1]));
  for (const kind of kindsInMigration()) {
    assert.ok(labelled.has(kind), `kind '${kind}' has no entry in LABELS`);
  }
});
