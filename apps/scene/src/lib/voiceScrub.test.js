import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp01, fractionFromPointer, seekTarget, stepFraction, ARROW_STEP,
} from './voiceScrub.js';

/* ── fractionFromPointer ─────────────────────────────────────────── */

const RECT = { left: 100, width: 200 };

test('a pointer at the left edge is 0, the right edge is 1, the middle is 0.5', () => {
  assert.equal(fractionFromPointer(100, RECT), 0);
  assert.equal(fractionFromPointer(300, RECT), 1);
  assert.equal(fractionFromPointer(200, RECT), 0.5);
});

test('a pointer dragged past either edge clamps rather than overshooting', () => {
  // A finger leaves the waveform constantly during a drag; the playhead must
  // pin to the ends, not fly off to a negative time or past the note's length.
  assert.equal(fractionFromPointer(40, RECT), 0);
  assert.equal(fractionFromPointer(9999, RECT), 1);
});

test('⚠ a zero-width rect yields 0, never NaN or Infinity', () => {
  // THE FIRST-TOUCH DEFECT. getBoundingClientRect returns width 0 before
  // layout or under display:none; dividing by it would seek the note to a
  // broken time on the very first press.
  assert.equal(fractionFromPointer(150, { left: 0, width: 0 }), 0);
  assert.equal(fractionFromPointer(150, null), 0);
});

/* ── seekTarget ──────────────────────────────────────────────────── */

test('the middle of a 10s note seeks to 5s', () => {
  assert.equal(seekTarget(0.5, 10), 5);
});

test('dragging back to the beginning lands exactly on 0', () => {
  // "Drag back to 0:00" is called out explicitly; it must be precise, not
  // 0.05 short, or the note looks like it will not rewind fully.
  assert.equal(seekTarget(0, 10), 0);
  assert.equal(seekTarget(-0.3, 10), 0);
});

test('⚠ dragging to the far end stops a hair short, so it does not snap back', () => {
  // Seeking to exactly duration fires `ended`, which resets to 0 and marks the
  // note finished — so a drag to the right edge would jump to the START. The
  // margin keeps the playhead where the finger dropped it.
  const t = seekTarget(1, 10);
  assert.ok(t < 10 && t >= 9.9, `expected just under 10, got ${t}`);
});

test('a zero or unknown duration seeks to 0 rather than to NaN', () => {
  assert.equal(seekTarget(0.5, 0), 0);
  assert.equal(seekTarget(0.5, NaN), 0);
  assert.equal(seekTarget(0.5, undefined), 0);
});

/* ── stepFraction ────────────────────────────────────────────────── */

test('arrow steps move by ARROW_STEP and clamp at both ends', () => {
  assert.equal(stepFraction(0.5, ARROW_STEP), 0.55);
  assert.equal(stepFraction(0.5, -ARROW_STEP), 0.45);
  assert.equal(stepFraction(0.98, ARROW_STEP), 1);   // clamps, no overshoot
  assert.equal(stepFraction(0.02, -ARROW_STEP), 0);
});

test('clamp01 keeps a fraction usable whatever it is handed', () => {
  assert.equal(clamp01(1.4), 1);
  assert.equal(clamp01(-2), 0);
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01(0.3), 0.3);
});
