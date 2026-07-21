import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MESSAGE_KINDS, classifyKind, isKnownKind, KIND_LABELS } from './messageKinds.js';

const MIGRATION = fileURLToPath(
  new URL('../../../supabase/migrations/20260721000000_m9a_message_kinds.sql', import.meta.url),
);

/**
 * Reads the kind list out of `messages_kind_valid` in the migration itself.
 *
 * Deliberately parses the FILE rather than restating the list here. A test
 * that hardcodes its own copy of the expected kinds proves the two hardcoded
 * copies in the test agree — it cannot notice a kind added to the database
 * and forgotten on the client, which is the only failure this test exists to
 * catch.
 */
function kindsInMigration() {
  const sql = readFileSync(MIGRATION, 'utf8');

  // The CHECK body, from `kind IN (` to its closing paren.
  const match = sql.match(/kind\s+IN\s*\(([^)]*)\)/i);
  if (!match) {
    throw new Error('could not find `kind IN (...)` in the migration — has the CHECK been renamed?');
  }

  return match[1]
    .split(',')
    .map(s => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
}

test('the client kind list matches the database CHECK exactly', () => {
  // If this fails, one of the two was edited alone. Fix the list, not the test.
  assert.deepEqual(MESSAGE_KINDS, kindsInMigration());
});

test('the migration parse actually found kinds', () => {
  // Guards the test above: a regex that silently matched nothing would make
  // `deepEqual([], [])` pass and report a green contract that was never checked.
  const found = kindsInMigration();
  assert.ok(found.length >= 5, `expected a real kind list, parsed ${found.length}: ${found}`);
  assert.ok(found.includes('text'), 'text must be in the migration list');
});

test('every kind has a label', () => {
  for (const kind of MESSAGE_KINDS) {
    assert.ok(KIND_LABELS[kind], `kind '${kind}' has no label — it would render unnamed`);
  }
});

test('a message with no kind is text', () => {
  const renderers = { text: () => null };
  assert.deepEqual(classifyKind(undefined, renderers).kind, 'text');
  assert.deepEqual(classifyKind(null, renderers).kind, 'text');
  assert.deepEqual(classifyKind(undefined, renderers).status, 'render');
});

test('a built kind renders', () => {
  const renderers = { text: () => null, voice: () => null };
  assert.deepEqual(classifyKind('voice', renderers).status, 'render');
});

test('a known but unbuilt kind is unbuilt, not unknown', () => {
  // The distinction the old single fallback could not make. Telling a user on
  // the current build to "update the app" because voice is unshipped is wrong.
  const renderers = { text: () => null };
  const result = classifyKind('voice', renderers);
  assert.deepEqual(result.status, 'unbuilt');
  assert.deepEqual(result.label, 'Voice message');
});

test('a kind from a newer client is unknown', () => {
  const renderers = { text: () => null };
  assert.deepEqual(classifyKind('hologram', renderers).status, 'unknown');
  assert.equal(isKnownKind('hologram'), false);
});
