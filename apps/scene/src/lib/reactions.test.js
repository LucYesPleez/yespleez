import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REACTIONS, REACTION_KEYS, isReactionKey, reactionFor,
  summariseReactions, decideReactionTap,
} from './reactions.js';

/* ── THE REGISTRY IS THE CONTRACT ──────────────────────────────────── */

test('⚠ the Hand is NOT a reaction', () => {
  // Owner's decision: the Yes lives on the composer and in its own column,
  // never as one of N equal choices behind a long press. Putting it in this
  // list is how you get people using it LESS, which is the opposite of what
  // it is for. This test exists to make that a deliberate act, not a tidy-up.
  assert.ok(!REACTION_KEYS.includes('hand'), 'hand must never be in the reaction registry');
});

test('every reaction has a stable key and something to render', () => {
  for (const r of REACTIONS) {
    assert.match(r.key, /^[a-z]+$/, 'keys are short, stable and lowercase');
    assert.ok(r.label, `${r.key} needs a label for screen readers and tooltips`);
    assert.ok(r.emoji || r.custom, `${r.key} has no glyph`);
  }
});

test('keys are unique — a duplicate would silently merge two reactions', () => {
  assert.strictEqual(new Set(REACTION_KEYS).size, REACTION_KEYS.length);
});

test('⚠ no key is an emoji character', () => {
  // The wire format is a key, never the glyph. `😶‍🌫️` is three codepoints
  // joined by a ZWJ and `🫡` carries a variation selector on some platforms;
  // round-trip that through a CHECK constraint or a client that normalises
  // Unicode differently and rows stop matching for reasons invisible in a
  // query result.
  for (const key of REACTION_KEYS) {
    assert.ok(/^[\x20-\x7E]+$/.test(key), `${key} must be plain ASCII`);
  }
});

test('an unknown key resolves to null rather than a wrong reaction', () => {
  // Rows can carry keys this build does not know — an older client writing a
  // since-removed reaction, or a newer one writing a since-added reaction.
  // Coercing would silently rewrite what somebody said.
  assert.strictEqual(reactionFor('nope'), null);
  assert.strictEqual(isReactionKey('nope'), false);
  assert.strictEqual(isReactionKey(REACTION_KEYS[0]), true);
});

/* ── SUMMARISING ───────────────────────────────────────────────────── */

test('counts group by reaction and mark the viewer\'s own', () => {
  const rows = [
    { profile_id: 'a', reaction: 'joycat' },
    { profile_id: 'b', reaction: 'joycat' },
    { profile_id: 'c', reaction: 'nails' },
  ];
  const { counts, total, mine } = summariseReactions(rows, 'b');

  assert.strictEqual(total, 3);
  assert.strictEqual(mine, 'joycat');
  assert.strictEqual(counts.find(c => c.key === 'joycat').count, 2);
  assert.strictEqual(counts.find(c => c.key === 'joycat').mine, true);
  assert.strictEqual(counts.find(c => c.key === 'nails').mine, false);
});

test('⚠ counts follow REGISTRY order, not popularity', () => {
  // A bar that reorders as counts change makes the same message look
  // different every glance, and moves the target out from under a finger
  // that was already reaching for it.
  const rows = [
    { profile_id: 'a', reaction: 'nails' },
    { profile_id: 'b', reaction: 'nails' },
    { profile_id: 'c', reaction: 'salute' },
  ];
  const { counts } = summariseReactions(rows);
  assert.deepStrictEqual(counts.map(c => c.key), ['salute', 'nails'],
    'salute is earlier in the registry despite having fewer');
});

test('⚠ an unknown reaction still counts toward the total', () => {
  // The number must stay honest even when this build cannot draw the glyph.
  // Dropping it entirely would under-report a real person's real reaction.
  const rows = [
    { profile_id: 'a', reaction: 'salute' },
    { profile_id: 'b', reaction: 'from_the_future' },
  ];
  const { counts, total } = summariseReactions(rows);
  assert.strictEqual(total, 2, 'both are real reactions by real people');
  assert.strictEqual(counts.length, 1, 'but only the drawable one is listed');
});

test('rows with no reaction are ignored, not counted as zero-width entries', () => {
  // A row can exist carrying only handed_at — a Yes with no emoji reaction.
  // It must not appear here at all.
  const rows = [
    { profile_id: 'a', reaction: null },
    { profile_id: 'b' },
    null,
    { profile_id: 'c', reaction: 'woozy' },
  ];
  const { counts, total } = summariseReactions(rows);
  assert.strictEqual(total, 1);
  assert.strictEqual(counts.length, 1);
});

test('no rows summarises to empty rather than throwing', () => {
  for (const input of [[], null, undefined]) {
    const { counts, total, mine } = summariseReactions(input);
    assert.deepStrictEqual(counts, []);
    assert.strictEqual(total, 0);
    assert.strictEqual(mine, null);
  }
});

/* ── THE TAP RULE ──────────────────────────────────────────────────── */

test('⚠ tapping a different reaction REPLACES — one per person per message', () => {
  // The same rule the primary key (message_id, profile_id) enforces in the
  // database, so the UI and the table cannot drift apart about it.
  assert.strictEqual(decideReactionTap({ current: 'salute', tapped: 'nails' }), 'set');
});

test('tapping the active reaction clears it', () => {
  assert.strictEqual(decideReactionTap({ current: 'nails', tapped: 'nails' }), 'clear');
});

test('tapping with nothing active sets it', () => {
  assert.strictEqual(decideReactionTap({ current: null, tapped: 'woozy' }), 'set');
  assert.strictEqual(decideReactionTap({ tapped: 'woozy' }), 'set');
});
