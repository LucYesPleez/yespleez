import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));

/**
 * The migration that currently DEFINES the kind CHECK.
 *
 * A CHECK cannot be amended in place — it is dropped and recreated — so the
 * authority is whichever migration touched it LAST, not whichever created it.
 * This used to name M9a directly, which meant the first migration to add a kind
 * would fail this test for a drift that did not exist.
 *
 * Sorted by filename, which is the timestamp prefix, which is apply order.
 */
function authoritativeMigration() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .filter(f => /ADD CONSTRAINT messages_kind_valid/i.test(readFileSync(MIGRATIONS_DIR + f, 'utf8')));

  if (!files.length) throw new Error('no migration defines messages_kind_valid');
  return MIGRATIONS_DIR + files.at(-1);
}
import { KINDS, LABELS } from './messageKindList.js';

/** The kinds the DATABASE will accept — from `messages_kind_valid`. */
function kindsInMigration() {
  const sql = readFileSync(authoritativeMigration(), 'utf8');
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

/* ── the standalone Hand owns its own clock ─────────────────────────── */

test('⚠ the Hand kind draws its own timestamp', async () => {
  // Not a style preference. This kind has no bubble, so a timestamp drawn BELOW
  // the mark makes the message's bottom edge the clock rather than the mark —
  // and the Yes badge, which anchors to the frame's bottom-left corner for every
  // kind, then lands on top of the time. Measured at 3.3px of overlap,
  // identically at 412px and 900px: not a phone or platform fault.
  //
  // With this true, `HandMessage` draws the clock beside the mark and the
  // frame's bottom edge is the mark again — restoring the badge's normal 6px
  // relationship with no special case anywhere.
  const { KIND_SHAPE, isBareKind } = await import('./messageKindList.js');

  assert.equal(KIND_SHAPE.hand?.ownsTimestamp, true,
    'the thread would draw the clock under the mark and the badge would sit on it');

  // Still bare: geometry only. It must not have acquired a bubble.
  assert.equal(isBareKind('hand'), true, 'the Hand must stay a bare kind');
  assert.equal(KIND_SHAPE.hand.padding, undefined, 'a bare kind must not take padding');
  assert.equal(KIND_SHAPE.hand.minHeight, undefined, 'a bare kind must not take a height floor');
});

test('a kind that owns its timestamp must actually render one', async () => {
  // ownsTimestamp tells the thread to stand down. A kind that claims it and then
  // draws nothing leaves that message with no time at all — a silent loss, since
  // nothing errors and the bubble simply looks slightly bare.
  const { KIND_SHAPE } = await import('./messageKindList.js');

  // Renderers do not all live in one file — voice has its own component.
  const SOURCE = {
    hand:  './messageKinds.jsx',
    voice: '../components/VoiceMessage.jsx',
  };

  for (const [kind, shape] of Object.entries(KIND_SHAPE)) {
    if (!shape.ownsTimestamp) continue;
    const path = SOURCE[kind];
    assert.ok(path, `${kind} claims ownsTimestamp but this test does not know where it renders`);
    const src = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.ok(/timeOf\(/.test(src), `${kind} claims ownsTimestamp but its renderer draws no clock`);
  }
});
