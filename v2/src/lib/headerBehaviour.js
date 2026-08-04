// WHO IS ALLOWED TO PIN THE HEADER OPEN.
//
// The auto-hiding header is the app-wide default (owner, 2026-08-04), so this
// is the escape hatch rather than the switch: a screen that genuinely needs a
// permanently visible bar calls `useAlwaysVisibleHeader()` and the header stops
// hiding for as long as that screen is mounted.
//
// ⚠ A COUNTER, NOT A BOOLEAN. Two screens can overlap for a frame during a
// route transition — the outgoing one's cleanup runs after the incoming one's
// effect — so a boolean would be cleared by the screen that is leaving and the
// header would start hiding underneath the screen that just asked it not to.
// Counting locks makes the order irrelevant.
//
// ⚠ Module-level pub/sub rather than a context provider, matching tourState.js.
// GlobalHeader is mounted ABOVE the router in App.jsx, so a provider would have
// to wrap the whole app just to let a leaf screen talk upward past the router.

import { useEffect } from 'react';

let locks = 0;
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn(locks > 0);
}

/** True while any mounted screen is holding the header open. */
export function isHeaderPinned() {
  return locks > 0;
}

/** Subscribe to pin/unpin. Returns an unsubscribe. */
export function onHeaderPinChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Take a lock. Returns the release, which is safe to call more than once.
 *
 * ⚠ THE PRIMITIVE IS EXPORTED so the tests can drive the SAME code the hook
 * runs. A test that re-implemented "increment on mount, decrement on cleanup"
 * would be testing a copy, and would keep passing after this stopped matching
 * it.
 */
export function acquireHeaderLock() {
  locks += 1;
  emit();
  let released = false;
  return () => {
    // ⚠ Idempotent. React runs effect cleanups twice in StrictMode, and a
    // double release would drive the counter below zero — after which the NEXT
    // screen to pin the header would have to do it twice before it took.
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
    emit();
  };
}

/**
 * Hold the header permanently visible while this component is mounted.
 *
 * @param enabled pass false to opt out conditionally, rather than calling this
 *                inside a branch and breaking the Rules of Hooks.
 */
export function useAlwaysVisibleHeader(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    return acquireHeaderLock();
  }, [enabled]);
}
