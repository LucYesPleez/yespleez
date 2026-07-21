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
import { KINDS, LABELS } from './messageKindList.js';

/** The kinds the DATABASE will accept — from `messages_kind_valid`. */
function kindsInMigration() {
  const sql = readFileSync(MIGRATION, 'utf8');
  const match = sql.match(/kind\s+IN\s*\(([^)]*)\)/i);
  if (!match) throw new Error('no `kind IN (...)` in the migration — has the CHECK been renamed?');
  return quoted(match[1]);
}

/**
 * The kinds the CLIENT will render.
 *
 * Imported, not parsed. This was regex over `messageKinds.jsx` because JSX
 * cannot be imported by the test runner; the list now lives in a plain-data
 * module the registry re-exports, so the test compares against the REAL value
 * the app uses rather than against source text that merely looks like it.
 *
 * The migration side stays textual — SQL cannot be imported at all.
 */
function kindsInRegistry() {
  return KINDS;
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
  for (const kind of kindsInMigration()) {
    assert.ok(LABELS[kind], `kind '${kind}' has no entry in LABELS`);
  }
});

test('the registry still re-exports the list the app imports', () => {
  // The split is an implementation detail: `messageKinds.jsx` must remain the
  // one import a caller needs. If the re-export is dropped, every consumer
  // that reaches through the registry breaks — and this file would not notice,
  // because it imports the data module directly.
  const src = readFileSync(fileURLToPath(new URL('./messageKinds.jsx', import.meta.url)), 'utf8');
  assert.match(src, /export\s*\{[^}]*\bKINDS\b[^}]*\}\s*from\s*'\.\/messageKindList'/,
    'messageKinds.jsx must re-export KINDS from messageKindList');
  assert.match(src, /export\s*\{[^}]*\bLABELS\b[^}]*\}\s*from\s*'\.\/messageKindList'/,
    'messageKinds.jsx must re-export LABELS from messageKindList');
});
