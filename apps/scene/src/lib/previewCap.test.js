/**
 * THE PREVIEW CAP — the first twenty minutes of a set.
 *
 * ⚠⚠ WHY THIS IS TESTED HERE AND NOT THROUGH THE PLAYER. The browser preview
 * pane cannot play media: position and duration both read 0, so a test that
 * drove the real widget would pass while enforcing nothing — the same trap as
 * the frozen-rAF one. The maths is checked synchronously; the component only
 * wires it up.
 *
 * ⚠ Two previous versions of this rule shipped and neither capped anything.
 * Both looked right on screen. That is the whole reason for these assertions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPastCap, previewProgress, PREVIEW_MS } from './previewCap.js';

const MIN = 60 * 1000;

test('the cap is twenty minutes', () => {
  assert.equal(PREVIEW_MS, 20 * MIN);
});

test('⭐⭐ it stops at 20:00 HOWEVER the playhead got there', () => {
  // The distinction that matters: this asks only where the playhead IS, so a
  // listener who dragged the scrubber is treated exactly like one who sat
  // through it. The previous version measured listening time and let a drag
  // to 1:15:00 play on.
  assert.equal(isPastCap(20 * MIN), true, 'exactly the cap is spent');
  assert.equal(isPastCap(20 * MIN + 500), true, 'a poll landing just past it still stops');
  assert.equal(isPastCap(75 * MIN), true, 'seeked far beyond — stops immediately');
});

test('⚠ it does NOT stop a moment before the cap', () => {
  assert.equal(isPastCap(19 * MIN + 59 * 1000), false);
  assert.equal(isPastCap(0), false);
  // Mutation guard: if the comparison flipped to `>`, the first assertion in
  // the test above would fail and this one would still pass. Both are needed.
});

test('⛔ an unreadable position never stops the player', () => {
  // Silence is not evidence of having heard twenty minutes. A provider that
  // has not loaded, or a widget that answered late, must not be killed.
  for (const bad of [null, undefined, NaN, 'later', -1, {}]) {
    assert.equal(isPastCap(bad), false, `${String(bad)} must not trigger the cap`);
  }
});

test('⛔ the bar measures the PREVIEW, not the track', () => {
  // On a 92-minute set the bar fills at 20:00. Measuring against the track
  // would leave it crawling to ~22% — which is what made the old bar a lie.
  assert.equal(previewProgress(0), 0);
  assert.equal(previewProgress(10 * MIN), 50);
  assert.equal(previewProgress(20 * MIN), 100);
  assert.equal(previewProgress(90 * MIN), 100, 'never past full');
});

test('⚠ a mix shorter than the cap never fills the bar, and that is correct', () => {
  // A seven-minute demo ends on its own FINISH event at seven minutes. Nothing
  // waits out the remaining thirteen, so the bar simply stops at 35%.
  assert.equal(Math.round(previewProgress(7 * MIN)), 35);
  assert.equal(isPastCap(7 * MIN), false, 'a short mix is never cut off by the cap');
});

test('an unreadable position reads as an empty bar, not a full one', () => {
  for (const bad of [null, undefined, NaN, -5]) {
    assert.equal(previewProgress(bad), 0);
  }
});
