/**
 * THE RECORD GESTURE — press, then drag along one axis.
 *
 * Hold the microphone to record. Drag it sideways into the waveform dock to
 * lock; drag it DOWN to cancel.
 *
 * ── WHY THIS REPLACED SLIDE-UP-TO-LOCK ───────────────────────────────
 *
 * The previous model was WhatsApp's: up to lock, left to cancel. Two axes, and
 * the lock target was a distance rather than a thing — you had to be told it
 * existed. Docking into a control that is permanently on screen explains itself:
 * the dock is visible before you press, it lights up as you approach, and the
 * gesture ends somewhere rather than merely far enough.
 *
 * Cancel lives on the vertical because the dock claimed the horizontal. The
 * dock sits LEFT of the microphone, so docking is a leftward drag — which is
 * where cancel used to be. Two opposite outcomes on one direction is a coin
 * toss, not a gesture. Down is where discarded things go anyway.
 *
 * ── LOCK IS A HIT TEST, CANCEL IS A DISTANCE ─────────────────────────
 *
 * Deliberately different, because they are different kinds of act.
 *
 * Lock has a target on screen, so the only honest test is whether the finger is
 * ON it. A fixed distance would be right at one screen width and wrong at every
 * other — the dock sits at the end of a flexible row, so how far it is from the
 * microphone depends on the text field, which depends on the viewport.
 *
 * Cancel has no target — it is a throw-away gesture into empty space, off the
 * bottom of the composer — so distance is the only thing it can be.
 */

/**
 * Movement below this is not a gesture. Covers finger tremor, the few pixels a
 * touch travels during a normal press, and trackpad jitter on desktop.
 */
export const SLOP_PX = 10;

/**
 * Drag DOWN this far to cancel.
 *
 * ⚠ CANCEL MOVED OFF THE HORIZONTAL, and it had to. The dock sits to the LEFT
 * of the microphone in the composer, so docking is a leftward drag — which is
 * exactly where cancel used to live. Two opposite outcomes on one direction is
 * not a gesture, it is a coin toss.
 *
 * Down is the right home for it: away from the composer, off the bottom of the
 * screen, the direction everything discarded goes. It also leaves the whole
 * horizontal axis to the dock, so the signature gesture is unambiguous.
 */
export const CANCEL_DISTANCE_PX = 72;

/**
 * How much of the dock counts as "in".
 *
 * Grown beyond the control's own bounds because a finger is far wider than a
 * cursor and hides the target it is aiming at. Docking should succeed when it
 * looks like it should, not only when the pointer's single reported pixel lands
 * inside a 40px circle.
 */
export const DOCK_PADDING_PX = 14;

/**
 * Travel required before a dock hit counts.
 *
 * MEASURED PROBLEM: the dock sits 9px from the microphone, so its 14px padded
 * hit zone begins INSIDE the microphone itself. Without this, a 20px slip
 * locked the recording — barely past the 10px slop, and nothing like the
 * deliberate drag the gesture is meant to be.
 *
 * Padding cannot simply shrink: it exists because a fingertip is wide and hides
 * its target. So the fix is a minimum journey rather than a smaller destination
 * — you must actually carry the microphone somewhere, not merely twitch toward
 * a neighbour.
 */
export const DOCK_MIN_TRAVEL_PX = 34;

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
  // Ties go to horizontal: both meanings live on that axis, and a gesture that
  // committed to vertical could then do nothing at all.
  return Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
}

/** Is this point inside the dock, allowing for a fingertip? */
export function isOverDock(point, rect, padding = DOCK_PADDING_PX) {
  if (!point || !rect) return false;
  return point.x >= rect.left - padding
      && point.x <= rect.right + padding
      && point.y >= rect.top - padding
      && point.y <= rect.bottom + padding;
}

/**
 * What this drag means right now.
 *
 * @param {object} p
 * @param {number} p.dx        horizontal travel from the press origin
 * @param {number} p.dy        vertical travel
 * @param {'x'|'y'|null} p.axis committed axis, or null if none yet
 * @param {{x:number,y:number}} p.point   current pointer position
 * @param {DOMRect|null} p.dockRect       the dock's bounds, or null
 *
 * @returns {{action:'lock'|'cancel'|null, cancelProgress:number, dockProgress:number}}
 *
 * `dockProgress` drives the dock lighting up as the finger nears it. It is
 * distance-based purely for the ANIMATION — the decision itself is the hit
 * test, so the dock can glow at 80% without that ever being what locks it.
 */
export function resolveGesture({ dx, dy, axis, point, dockRect } = {}) {
  const down = Math.max(0, dy);
  // Sideways distance is not what decides the lock — arriving is. It only
  // gates it, so a twitch toward an adjacent control cannot count as a journey.
  const travelled = Math.abs(dx ?? 0);

  // HORIZONTAL is the dock's axis, in whichever direction the dock happens to
  // lie — it sits left of the microphone today, and a future layout could put
  // it elsewhere. The hit test does not care, which is the advantage of testing
  // a target instead of a direction.
  if (axis === 'x') {
    if (travelled >= DOCK_MIN_TRAVEL_PX && isOverDock(point, dockRect)) {
      return { action: 'lock', cancelProgress: 0, dockProgress: 1 };
    }
    return { action: null, cancelProgress: 0, dockProgress: nearness(point, dockRect) };
  }

  // VERTICAL is cancel, downward only. Dragging UP does nothing: the old model
  // locked that way, and anyone carrying that habit should get a no-op rather
  // than a surprise.
  if (axis === 'y') {
    const cancelProgress = clamp01(down / CANCEL_DISTANCE_PX);
    if (down >= CANCEL_DISTANCE_PX) {
      return { action: 'cancel', cancelProgress: 1, dockProgress: 0 };
    }
    return { action: null, cancelProgress, dockProgress: 0 };
  }

  return { action: null, cancelProgress: 0, dockProgress: 0 };
}

/**
 * How close the pointer is to the dock, 0..1, for the lighting only.
 *
 * Measured from the dock's centre against a fixed approach distance rather than
 * from the gesture's origin, so the glow depends on where the finger IS, not on
 * where it started. Starting closer should not mean starting brighter.
 */
function nearness(point, rect) {
  if (!point || !rect) return 0;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const distance = Math.hypot(point.x - cx, point.y - cy);
  const APPROACH = 130;
  return clamp01(1 - distance / APPROACH);
}

function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
