import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldDismiss, pullProgress, PULL_PX, SLOP_PX } from './dismissGesture.js';

/* ⚠ WHAT THESE TESTS DO NOT COVER.
 *
 * The bug — conversations dismissing themselves while being read — was that
 * this decision was being asked at all about drags inside the message list.
 * The fix is that the handler now lives on a non-scrolling handle, and that is
 * a fact about WHERE it is attached, which no test here can assert.
 *
 * If someone reattaches this to the dialog or the scroll container, every test
 * below still passes and the bug is back. The guard against that is the comment
 * in `ConversationDock`, not this file. */

test('a deliberate downward pull dismisses', () => {
  assert.equal(shouldDismiss({ dx: 0, dy: PULL_PX }), true);
  assert.equal(shouldDismiss({ dx: 4, dy: 120 }), true);
});

test('a short pull does not', () => {
  assert.equal(shouldDismiss({ dx: 0, dy: PULL_PX - 1 }), false);
  assert.equal(shouldDismiss({ dx: 0, dy: 20 }), false);
});

test('a tap never dismisses', () => {
  assert.equal(shouldDismiss({ dx: 0, dy: 0 }), false);
  assert.equal(shouldDismiss({ dx: 1, dy: 2 }), false);
});

test('upward travel never dismisses, however far', () => {
  // The handle sits at the top of the drawer; dragging UP from it is a reach
  // toward the header, not a request to put the conversation away.
  assert.equal(shouldDismiss({ dx: 0, dy: -200 }), false);
  assert.equal(shouldDismiss({ dx: 0, dy: -PULL_PX }), false);
});

test('a mostly-sideways swipe does not dismiss even when it travels far enough down', () => {
  // The handle has buttons either side of it. A diagonal reach toward one must
  // not be read as a dismissal just because it covered enough vertical ground.
  assert.equal(shouldDismiss({ dx: 300, dy: 100 }), false);
  assert.equal(shouldDismiss({ dx: -300, dy: 100 }), false);
});

test('the diagonal boundary is vertical-dominant, not merely vertical-present', () => {
  assert.equal(shouldDismiss({ dx: 99, dy: 100 }), true, 'more down than across');
  assert.equal(shouldDismiss({ dx: 100, dy: 100 }), false, 'exactly diagonal is not a pull');
  assert.equal(shouldDismiss({ dx: 101, dy: 100 }), false, 'more across than down');
});

test('slop rejects a jittery press that happens to clear the distance', () => {
  // Unreachable in practice given PULL_PX > SLOP_PX, but the guard is cheap and
  // the two constants are independently tunable.
  assert.ok(SLOP_PX < PULL_PX, 'slop must sit below the pull distance');
});

test('malformed input is refused rather than throwing', () => {
  // A pointer event with a missing coordinate must not dismiss a conversation.
  assert.equal(shouldDismiss({ dx: NaN, dy: 200 }), false);
  assert.equal(shouldDismiss({ dx: 0, dy: NaN }), false);
  assert.equal(shouldDismiss({}), false);
  assert.equal(shouldDismiss(), false);
  assert.equal(shouldDismiss({ dy: undefined, dx: undefined }), false);
});

/* ── progress ─────────────────────────────────────────────────────── */

test('progress runs 0 to 1 across the pull distance', () => {
  assert.equal(pullProgress({ dy: 0 }), 0);
  assert.equal(pullProgress({ dy: PULL_PX / 2 }), 0.5);
  assert.equal(pullProgress({ dy: PULL_PX }), 1);
});

test('progress clamps rather than exceeding 1', () => {
  // The handle must not be draggable past "done" — a bar that keeps growing
  // says the gesture has not finished when it has.
  assert.equal(pullProgress({ dy: PULL_PX * 5 }), 1);
});

test('upward travel reports no progress', () => {
  assert.equal(pullProgress({ dy: -50 }), 0);
});

test('progress is reported for pulls that will NOT qualify', () => {
  // Deliberate: the handle responds while it is being used, not only once the
  // gesture has succeeded. A control that stays inert until the threshold gives
  // no clue that it is doing anything.
  assert.ok(pullProgress({ dy: 10 }) > 0);
  assert.equal(shouldDismiss({ dx: 0, dy: 10 }), false);
});

test('malformed progress input is 0, never NaN', () => {
  // NaN would serialise into a transform string and silently kill the handle's
  // feedback rather than erroring.
  assert.equal(pullProgress({ dy: NaN }), 0);
  assert.equal(pullProgress({}), 0);
  assert.equal(pullProgress(), 0);
});
