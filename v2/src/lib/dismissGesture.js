/**
 * PULL DOWN TO MINIMISE — the arithmetic only.
 *
 * ── WHAT ACTUALLY FIXED THE BUG IS NOT IN THIS FILE ──────────────────
 *
 * Conversations used to dismiss themselves while people were reading. The cause
 * was structural: the dismiss listener sat on an ANCESTOR of the scrolling
 * message list, so every drag inside the list bubbled up to it, and "dragged
 * down a long way" describes scrolling back through a thread at least as well
 * as it describes a dismissal.
 *
 * The fix was to move the listener onto an element that cannot scroll — the
 * header's grab handle. That guarantee is enforced by WHERE the handler is
 * attached, and no threshold in this file can create or destroy it. If someone
 * later attaches these to the dialog, the scroll container, or the thread, the
 * bug returns however good the numbers are.
 *
 * What IS here is the second-order question: given a drag that definitely
 * started on the handle, was it a deliberate pull-down?
 */

/**
 * How far down the handle must travel.
 *
 * Larger than it needs to be for safety — the handle does not scroll, so this
 * number is not defending against anything; it only separates a deliberate pull
 * from a tap that wobbled. It is a comfort threshold, not a guard.
 */
export const PULL_PX = 64;

/** Below this, a drag has no direction worth reading — it is a press. */
export const SLOP_PX = 8;

/**
 * Did this drag on the handle mean "put it away"?
 *
 * @param {{dx:number, dy:number}} p travel from the press origin; dy positive is down
 * @returns {boolean}
 *
 * Requires the movement to be predominantly VERTICAL as well as far enough.
 * The handle sits in a header with buttons either side, and a diagonal swipe
 * toward one of them should not be read as a dismissal just because it happened
 * to cover enough vertical ground on the way.
 */
export function shouldDismiss({ dx = 0, dy = 0 } = {}) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  if (dy < PULL_PX) return false;                 // not far enough, or upward
  if (Math.hypot(dx, dy) < SLOP_PX) return false; // not a gesture at all
  return dy > Math.abs(dx);                       // predominantly downward
}

/**
 * How far through the pull we are, 0..1 — for the handle's own feedback.
 *
 * Progress is reported for ANY downward travel, including drags that will not
 * qualify, so the control responds while it is being used rather than only once
 * it has succeeded. Clamped, so the handle cannot be dragged past "done".
 */
export function pullProgress({ dy = 0 } = {}) {
  if (!Number.isFinite(dy) || dy <= 0) return 0;
  return Math.min(1, dy / PULL_PX);
}
