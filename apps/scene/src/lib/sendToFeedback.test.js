import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ⚠⚠ "IT DIDNT SAY SENT. I PRESSED IT A BUNCH MORE TIMES." — owner, 2026-08-11,
 * sharing an event to a conversation from a phone.
 *
 * It HAD sent, and it HAD said so: one 12.5px word at the right edge of the
 * row, directly under the thumb that had just tapped it. The only feedback the
 * system gave was in the one place a finger covers.
 *
 * ⭐ Three faults, one report:
 *   1. the confirmation was invisible in use
 *   2. nothing was said at sheet level, so looking away lost the answer
 *   3. the double-tap guard read STATE, and state is not synchronous
 *
 * ⚠ These are source-level assertions. They prove the mechanisms are present;
 * they cannot prove the sheet FEELS answered — that needed a phone, and it is
 * how the bug was found in the first place.
 */

const SRC = readFileSync(fileURLToPath(
  new URL('../components/SendToConversationSheet.jsx', import.meta.url)), 'utf8');

const sendFn = SRC.slice(SRC.indexOf('async function send('), SRC.indexOf('const needle'));

// ── 3 · the double-tap race ────────────────────────────────────────────────

/**
 * ⛔⛔ THE GUARD MUST BE A REF, AND MUST BE SET BEFORE THE FIRST await.
 *
 * `disabled={sendingTo === row.id}` reads state, and `setSending` applies on
 * the NEXT render — so two taps in the same frame both pass and both send.
 * Each carries its own `client_id`, so the Outbox cannot collapse them: that
 * protects against one message being DELIVERED twice, not against two being
 * CREATED. The result is two cards in the conversation.
 */
test('⛔ a second tap in the same frame cannot send twice', () => {
  assert.match(SRC, /const inFlight = useRef\(/,
    'the in-flight guard is not a ref — state cannot refuse a same-frame repeat');
  assert.match(sendFn, /if \(inFlight\.current\.has\(row\.id\)[\s\S]{0,60}\) return;/,
    'send() does not refuse a row already in flight');
});

/**
 * ⚠ ANCHORED ON `await sendMessage`, NOT ON THE WORD "await" — the first
 * version of this test matched the word inside the comment above the guard
 * ("Synchronous, before any await") and failed on correct code. Third time
 * today a source-level assertion tripped over prose: see also the
 * dangerouslySetInnerHTML check and the bracket in M9i's `kind IN` list.
 */
test('⛔ the guard is claimed BEFORE the send', () => {
  const beforeSend = sendFn.slice(0, sendFn.indexOf('await sendMessage'));
  assert.match(beforeSend, /inFlight\.current\.add\(row\.id\)/,
    'the guard is set after the send begins, which is the same race with more steps');
});

test('the guard is released on failure as well as success', () => {
  const del = sendFn.indexOf('inFlight.current.delete(row.id)');
  const errReturn = sendFn.indexOf('if (err)');
  assert.ok(del > 0 && del < errReturn,
    'a failed send leaves the row permanently un-sendable');
});

test('an already-sent row is refused too', () => {
  assert.match(sendFn, /sentTo\.has\(row\.id\)\) return;/,
    're-tapping a sent row would send a duplicate');
});

// ── 1 · the confirmation must survive a thumb ──────────────────────────────

/**
 * ⭐ THE TICK IS ON THE LEFT, OVER THE AVATAR — the far side of the row from
 * where the finger lands. ⛔ Feedback that lives only at the right-hand edge
 * is feedback the hand covers.
 */
test('⭐ a sent row changes on the side the finger is NOT on', () => {
  assert.match(SRC, /background: done \? 'rgba\(125,233,255,\.10\)'/,
    'the row itself does not change — only the word at its edge does');
  // ⚠ The anchor carries its quotes — `position: 'relative'` in the JSX. Without
  // them indexOf returns -1 and slice(-1) silently inspects the last character.
  const start = SRC.indexOf("position: 'relative', width: 36");
  assert.ok(start > 0, 'the avatar wrapper moved — re-anchor this test');
  const avatarBlock = SRC.slice(start, SRC.indexOf('flex: 1, minWidth: 0, fontSize: 15'));
  assert.match(avatarBlock, /\{done && \(/, 'there is no tick over the avatar');
  assert.match(avatarBlock, /M20 6 9 17l-5-5/, 'the tick glyph is missing');
});

// ── 2 · the sheet must say what it did ─────────────────────────────────────

/**
 * ⭐ Named, because after two sends "Sent" alone stops answering the question.
 * `aria-live` because a screen reader has the same problem in another form.
 */
test('⭐ the sheet confirms above the list, naming the recipient', () => {
  assert.match(SRC, /const \[lastSent, setLastSent\] = useState\(null\)/);
  assert.match(sendFn, /setLastSent\(row\.who\)/);
  assert.match(SRC, /aria-live="polite"/, 'the confirmation is not announced');
  assert.match(SRC, /Sent to \{lastSent\}/);
});

/**
 * ⚠ The banner sits ABOVE the list, beside the search box — a region the hand
 * never covers when reaching for a row. If it moves below the rows it is back
 * under the thumb and this whole fix is undone.
 */
test('⚠ the confirmation renders before the rows, not among them', () => {
  const banner = SRC.indexOf('Sent to {lastSent}');
  const rows   = SRC.indexOf('visible.map(row =>');
  assert.ok(banner > 0 && banner < rows, 'the confirmation moved into the tap zone');
});

// ── the haptic ─────────────────────────────────────────────────────────────

/**
 * ⭐ The send queues to the Outbox rather than awaiting the network, so
 * `Sending…` exists for about one frame — there is no motion to notice. A tick
 * is the one channel a finger cannot cover.
 *
 * ⛔ GUARDED. `vibrate` is absent on iOS Safari and throws in some embedded
 * webviews; a missing haptic must never cost the confirmation around it.
 */
test('the haptic fires on success and cannot break the send', () => {
  assert.match(sendFn, /navigator\.vibrate\?\.\(/, 'no haptic on a successful send');
  assert.match(sendFn, /try \{ navigator\.vibrate/, 'the haptic is unguarded');
  const err = sendFn.indexOf('if (err)');
  const vib = sendFn.indexOf('navigator.vibrate');
  assert.ok(vib > err, 'the haptic fires before the error check — it would buzz on failure');
});

// ── what must NOT change ───────────────────────────────────────────────────

/**
 * ⭐ Sharing one event with three people is ONE trip. Closing on the first send
 * is what makes that feel like three (owner, confirmed again 2026-08-11).
 */
test('⛔ the sheet still does not close itself after a send', () => {
  assert.doesNotMatch(sendFn, /onClose\(\)/,
    'the sheet closes on send — multi-send is broken');
});
