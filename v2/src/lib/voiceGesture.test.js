import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  commitAxis, resolveGesture,
  SLOP_PX, CANCEL_DISTANCE_PX, LOCK_DISTANCE_PX,
} from './voiceGesture.js';

// ── small movements are not gestures ────────────────────────────────

test('a press that barely moves commits to no axis', () => {
  // Finger tremor, and the few pixels a touch travels during a normal press.
  assert.equal(commitAxis(0, 0), null);
  assert.equal(commitAxis(3, -4), null);          // hypot 5
  assert.equal(commitAxis(-6, 6), null);          // hypot 8.49
});

test('the dead zone is a circle, not a diamond', () => {
  // Comparing axes separately makes a diamond, and a diagonal drag escapes a
  // diamond sooner than a straight one — so the gesture would engage at
  // different distances depending on direction. Both of these are just inside
  // the radius and must behave identically.
  const diagonal = SLOP_PX / Math.SQRT2 - 0.1;    // ~6.97 on each axis
  assert.equal(commitAxis(-diagonal, -diagonal), null, 'diagonal must not engage early');
  assert.equal(commitAxis(-(SLOP_PX - 0.1), 0), null, 'straight must not engage early');

  // And both engage once past it.
  assert.ok(commitAxis(-(SLOP_PX + 1), 0));
  assert.ok(commitAxis(-SLOP_PX, -SLOP_PX));
});

test('no gesture can fire before an axis is committed', () => {
  // Even movement far past a threshold does nothing while axis is null — the
  // component must commit first, and this is what stops a fast flick from
  // triggering both meanings at once.
  const r = resolveGesture(-500, -500, null);
  assert.equal(r.action, null);
  assert.equal(r.cancelProgress, 0);
  assert.equal(r.lockProgress, 0);
});

// ── axis commitment ─────────────────────────────────────────────────

test('the dominant direction wins the axis', () => {
  assert.equal(commitAxis(-40, -5),  'x');
  assert.equal(commitAxis(-5,  -40), 'y');
});

test('a tie commits to lock, never to cancel', () => {
  // Lock is recoverable, cancel destroys the recording. An exactly diagonal
  // drag must not resolve to the destructive one.
  assert.equal(commitAxis(-30, -30), 'y');
});

// ── only the committed axis can act ─────────────────────────────────

test('a lock drag that drifts left cannot cancel', () => {
  // THE defect this design exists to prevent. A finger travelling up to lock
  // also drifts sideways; if both axes stayed live, a drag toward lock would
  // destroy the recording on the way.
  const drifted = resolveGesture(-CANCEL_DISTANCE_PX * 2, -LOCK_DISTANCE_PX, 'y');
  assert.equal(drifted.action, 'lock', 'must lock, never cancel');
  assert.equal(drifted.cancelProgress, 0, 'the cancel hint must not even light up');
});

test('a cancel drag that drifts up cannot lock', () => {
  const drifted = resolveGesture(-CANCEL_DISTANCE_PX, -LOCK_DISTANCE_PX * 2, 'x');
  assert.equal(drifted.action, 'cancel');
  assert.equal(drifted.lockProgress, 0);
});

// ── the thresholds themselves ───────────────────────────────────────

test('cancel fires exactly at its threshold and not before', () => {
  assert.equal(resolveGesture(-(CANCEL_DISTANCE_PX - 1), 0, 'x').action, null);
  assert.equal(resolveGesture(-CANCEL_DISTANCE_PX, 0, 'x').action, 'cancel');
});

test('lock fires exactly at its threshold and not before', () => {
  assert.equal(resolveGesture(0, -(LOCK_DISTANCE_PX - 1), 'y').action, null);
  assert.equal(resolveGesture(0, -LOCK_DISTANCE_PX, 'y').action, 'lock');
});

test('cancel is harder to reach than lock', () => {
  // Deliberate: the destructive gesture must be the harder one to perform by
  // accident. If this ever inverts, an accidental swipe destroys recordings.
  assert.ok(CANCEL_DISTANCE_PX > LOCK_DISTANCE_PX,
    `cancel ${CANCEL_DISTANCE_PX}px must exceed lock ${LOCK_DISTANCE_PX}px`);
});

// ── direction ───────────────────────────────────────────────────────

test('sliding right or down is not a gesture', () => {
  const right = resolveGesture(CANCEL_DISTANCE_PX * 3, 0, 'x');
  assert.equal(right.action, null);
  assert.equal(right.cancelProgress, 0);

  const down = resolveGesture(0, LOCK_DISTANCE_PX * 3, 'y');
  assert.equal(down.action, null);
  assert.equal(down.lockProgress, 0);
});

test('overshooting back past the origin reports no progress, not negative', () => {
  // A finger that goes left then swings right past where it started would
  // otherwise drive a negative transform and push the affordance off-screen.
  assert.equal(resolveGesture(120, 0, 'x').cancelProgress, 0);
});

// ── progress is bounded, because it drives transforms ───────────────

test('progress stays within 0..1 however far the finger travels', () => {
  const far = resolveGesture(-4000, 0, 'x');
  assert.equal(far.cancelProgress, 1);

  const farUp = resolveGesture(0, -4000, 'y');
  assert.equal(farUp.lockProgress, 1);

  for (const d of [0, 5, 25, 79, 80, 81, 500]) {
    const p = resolveGesture(-d, 0, 'x').cancelProgress;
    assert.ok(p >= 0 && p <= 1, `progress ${p} out of range at ${d}px`);
  }
});

test('progress is monotonic — the affordance never jumps backwards', () => {
  let previous = -1;
  for (let d = 0; d <= LOCK_DISTANCE_PX * 2; d += 4) {
    const p = resolveGesture(0, -d, 'y').lockProgress;
    assert.ok(p >= previous, `progress fell from ${previous} to ${p} at ${d}px`);
    previous = p;
  }
});

test('the same input always gives the same output', () => {
  // "Deterministic" in the literal sense — no time, no randomness, no state.
  const a = resolveGesture(-42, -17, 'x');
  const b = resolveGesture(-42, -17, 'x');
  assert.deepEqual(a, b);
});
