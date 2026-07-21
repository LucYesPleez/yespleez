/**
 * THE RECORD GESTURE, AS ARITHMETIC.
 *
 * Press and hold records. Slide left past a threshold cancels. Slide up past a
 * threshold locks. Only one of those may ever happen.
 *
 * Extracted from the component and kept pure because "thresholds must be stable
 * and deterministic" is a claim that should be testable rather than asserted —
 * and because gesture bugs are close to impossible to reproduce by hand. A
 * diagonal drag that flickers between "cancel" and "lock" is a real defect that
 * no amount of careful pressing will reliably surface.
 *
 * Nothing here touches the DOM, React, or the recorder.
 *
 * ── WHY AN AXIS IS COMMITTED, AND NEVER RECONSIDERED ─────────────────
 *
 * A finger does not travel in a straight line. Dragging up to lock also drifts
 * sideways by tens of pixels, and dragging left drifts vertically. If both axes
 * stayed live for the whole gesture, a drag toward lock could cross the cancel
 * threshold on the way — destroying a recording the user was trying to keep.
 *
 * So the FIRST movement that clears the slop radius decides the axis, and that
 * decision is final for the rest of the press. After that, movement on the
 * other axis is ignored entirely: it cannot trigger, and it cannot even light
 * up the affordance. The gesture becomes predictable the instant it starts,
 * which is the only way a user can learn it.
 */

/**
 * Movement below this is not a gesture. Covers finger tremor, the few pixels a
 * touch travels during a normal press, and trackpad jitter on desktop.
 */
export const SLOP_PX = 10;

/**
 * Slide LEFT this far to cancel.
 *
 * Deliberately larger than the lock distance. Cancel destroys a recording and
 * lock does not, so the destructive gesture is the harder one to perform by
 * accident.
 */
export const CANCEL_DISTANCE_PX = 80;

/** Slide UP this far to lock. */
export const LOCK_DISTANCE_PX = 56;

/**
 * Decide which axis this gesture belongs to.
 *
 * Returns null until the slop radius is cleared — before that there is no
 * gesture yet, only a press.
 *
 * Uses radial distance rather than per-axis comparison so the dead zone is a
 * circle. Comparing each axis separately makes a diamond, and a diagonal drag
 * escapes a diamond sooner than a straight one — meaning the gesture would
 * engage at different distances depending on direction.
 */
export function commitAxis(dx, dy, slop = SLOP_PX) {
  if (Math.hypot(dx, dy) < slop) return null;
  // Ties go to the vertical axis: lock is the safe outcome, cancel is not.
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

/**
 * What this movement means, given the axis already committed to.
 *
 * @param {number} dx     horizontal travel from the press origin (left = negative)
 * @param {number} dy     vertical travel   (up = negative)
 * @param {'x'|'y'|null} axis  the committed axis, or null if none yet
 * @returns {{action: 'cancel'|'lock'|null, cancelProgress: number, lockProgress: number}}
 *
 * `action` is what to DO now — thresholds fire on crossing, not on release, so
 * the interface responds while the finger is still moving.
 *
 * The two progress values are 0–1 and drive the affordances. Only the committed
 * axis ever reports progress; the other stays at 0 so a drifting finger cannot
 * make the cancel hint glow while the user is reaching for lock.
 */
export function resolveGesture(dx, dy, axis) {
  // Only LEFTWARD and UPWARD travel count. Sliding right or down is not a
  // gesture in either direction, and clamping at zero means an overshoot back
  // past the origin cannot register as negative progress.
  const left = Math.max(0, -dx);
  const up   = Math.max(0, -dy);

  const cancelProgress = axis === 'x' ? clamp01(left / CANCEL_DISTANCE_PX) : 0;
  const lockProgress   = axis === 'y' ? clamp01(up   / LOCK_DISTANCE_PX)   : 0;

  let action = null;
  if (axis === 'x' && left >= CANCEL_DISTANCE_PX) action = 'cancel';
  else if (axis === 'y' && up >= LOCK_DISTANCE_PX) action = 'lock';

  return { action, cancelProgress, lockProgress };
}

function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
