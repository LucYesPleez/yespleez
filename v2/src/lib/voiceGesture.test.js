import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  commitAxis, resolveGesture, isOverDock,
  SLOP_PX, CANCEL_DISTANCE_PX, DOCK_PADDING_PX, DOCK_MIN_TRAVEL_PX,
} from './voiceGesture.js';

/** A dock sitting to the RIGHT of the microphone, as it does in the composer. */
const dock = { left: 300, right: 340, top: 100, bottom: 140, width: 40, height: 40 };
const at = (x, y = 120) => ({ x, y });

// ── small movements are not gestures ────────────────────────────────

test('a press that barely moves commits to no axis', () => {
  assert.equal(commitAxis(0, 0), null);
  assert.equal(commitAxis(3, -4), null);          // hypot 5
  assert.equal(commitAxis(-6, 6), null);          // hypot 8.49
});

test('the dead zone is a circle, not a diamond', () => {
  // Comparing axes separately makes a diamond, and a diagonal drag escapes a
  // diamond sooner than a straight one — the gesture would engage at different
  // distances depending on direction.
  const diagonal = SLOP_PX / Math.SQRT2 - 0.1;
  assert.equal(commitAxis(diagonal, diagonal), null);
  assert.equal(commitAxis(SLOP_PX - 0.1, 0), null);
  assert.ok(commitAxis(SLOP_PX + 1, 0));
});

test('ties commit to horizontal, because that is where both meanings live', () => {
  // A gesture that committed to vertical could then do nothing at all.
  assert.equal(commitAxis(30, 30), 'x');
  assert.equal(commitAxis(-30, -30), 'x');
});

// ── the axes swapped: horizontal docks, vertical cancels ────────────

test('dragging UP does nothing — lock is no longer a distance', () => {
  // The old model locked this way. Anyone with that muscle memory must get a
  // no-op rather than a surprise.
  const r = resolveGesture({ dx: 0, dy: -400, axis: 'y', point: at(120, -280), dockRect: dock });
  assert.equal(r.action, null);
  assert.equal(r.cancelProgress, 0);
});

test('no gesture fires before an axis is committed', () => {
  const r = resolveGesture({ dx: -500, dy: 0, axis: null, point: at(-380), dockRect: dock });
  assert.equal(r.action, null);
});

// ── LOCK is a hit test on a real target ─────────────────────────────

test('the microphone locks when it reaches the dock', () => {
  const r = resolveGesture({ dx: -60, dy: 0, axis: 'x', point: at(320), dockRect: dock });
  assert.equal(r.action, 'lock');
  assert.equal(r.dockProgress, 1);
});

test('direction does not matter — only arriving does', () => {
  // The dock sits left of the microphone today; a future layout could move it.
  // Testing the target rather than a direction means neither the gesture nor
  // this test has to know which way it lies.
  const fromLeft  = resolveGesture({ dx:  40, dy: 0, axis: 'x', point: at(dock.left + 5), dockRect: dock });
  const fromRight = resolveGesture({ dx: -40, dy: 0, axis: 'x', point: at(dock.right - 5), dockRect: dock });
  assert.equal(fromLeft.action, 'lock');
  assert.equal(fromRight.action, 'lock');
});

test('travelling toward the dock but stopping short does NOT lock', () => {
  // The whole difference from a distance threshold: getting close is not
  // arriving, however far you went.
  const r = resolveGesture({ dx: -30, dy: 0, axis: 'x', point: at(370), dockRect: dock });
  assert.equal(r.action, null);
  assert.ok(r.dockProgress > 0, 'but the dock should be lighting up');
  assert.ok(r.dockProgress < 1);
});

test('the dock target is padded for a fingertip', () => {
  assert.equal(isOverDock(at(dock.left - DOCK_PADDING_PX + 1), dock), true);
  assert.equal(isOverDock(at(dock.left - DOCK_PADDING_PX - 5), dock), false);
  assert.equal(isOverDock(at(320, dock.bottom + DOCK_PADDING_PX - 1), dock), true);
  assert.equal(isOverDock(at(320, dock.bottom + DOCK_PADDING_PX + 5), dock), false);
});

test('with no dock on screen, nothing can lock', () => {
  // The dock is conditionally rendered. A gesture must not lock against a
  // target that is not there.
  const r = resolveGesture({ dx: -400, dy: 0, axis: 'x', point: at(-280), dockRect: null });
  assert.equal(r.action, null);
  assert.equal(r.dockProgress, 0);
});

test('the glow follows where the finger IS, not how far it came', () => {
  // Measured from the dock rather than from the origin, so starting closer does
  // not mean starting brighter.
  const near = resolveGesture({ dx: -5,   dy: 0, axis: 'x', point: at(dock.left - 20), dockRect: dock });
  const far  = resolveGesture({ dx: -300, dy: 0, axis: 'x', point: at(dock.left - 120), dockRect: dock });
  assert.ok(near.dockProgress > far.dockProgress,
    'the closer pointer must glow brighter despite the shorter drag');
});

// ── CANCEL is downward, and a distance ──────────────────────────────

test('cancel fires exactly at its threshold and not before', () => {
  const short = resolveGesture({ dx: 0, dy: CANCEL_DISTANCE_PX - 1, axis: 'y', point: at(120, 200), dockRect: dock });
  assert.equal(short.action, null);
  const far = resolveGesture({ dx: 0, dy: CANCEL_DISTANCE_PX, axis: 'y', point: at(120, 200), dockRect: dock });
  assert.equal(far.action, 'cancel');
});

test('a vertical drag never lights the dock', () => {
  const r = resolveGesture({ dx: 0, dy: 50, axis: 'y', point: at(320, 160), dockRect: dock });
  assert.equal(r.dockProgress, 0);
  assert.ok(r.cancelProgress > 0);
});

// ── progress values drive animation, so they must stay bounded ──────

test('both progress values stay within 0..1', () => {
  for (const [dx, dy, axis] of [[-500,0,'x'], [-80,0,'x'], [0,0,'x'], [200,0,'x'], [0,-300,'y'], [0,500,'y']]) {
    const r = resolveGesture({ dx, dy, axis, point: at(120 + dx, 120 + dy), dockRect: dock });
    assert.ok(r.cancelProgress >= 0 && r.cancelProgress <= 1, `cancel ${r.cancelProgress}`);
    assert.ok(r.dockProgress >= 0 && r.dockProgress <= 1, `dock ${r.dockProgress}`);
  }
});

test('the same input always gives the same output', () => {
  const a = resolveGesture({ dx: -42, dy: 7, axis: 'x', point: at(300), dockRect: dock });
  const b = resolveGesture({ dx: -42, dy: 7, axis: 'x', point: at(300), dockRect: dock });
  assert.deepEqual(a, b);
});

// ── a twitch is not a journey ───────────────────────────────────────

test('a small slip toward the dock does not lock', () => {
  // MEASURED: the dock sits 9px from the microphone, so its padded hit zone
  // starts inside the microphone. A 20px slip used to lock the recording.
  const r = resolveGesture({ dx: -20, dy: 0, axis: 'x', point: at(dock.right - 2), dockRect: dock });
  assert.equal(r.action, null, 'twitching onto a neighbouring control is not docking');
  assert.ok(r.dockProgress > 0, 'though it may still glow, which is the invitation');
});

test('a deliberate drag onto the dock locks', () => {
  const r = resolveGesture({ dx: -DOCK_MIN_TRAVEL_PX, dy: 0, axis: 'x', point: at(dock.right - 2), dockRect: dock });
  assert.equal(r.action, 'lock');
});

test('distance alone never locks, however far', () => {
  // The gate is a minimum, not a trigger. Travelling a long way while missing
  // the dock must still do nothing — otherwise it is a distance threshold
  // wearing a target's clothes.
  const r = resolveGesture({ dx: -900, dy: 0, axis: 'x', point: at(-800), dockRect: dock });
  assert.equal(r.action, null);
});
