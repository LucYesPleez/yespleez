import { useCallback, useEffect, useRef } from 'react';
import { markNotificationsRead } from '../lib/markNotificationsRead';

/**
 * DEF-4 · A NOTIFICATION IS READ WHEN IT HAS BEEN SEEN — not when it was
 * fetched, and not when it was rendered.
 *
 * Owner's ruling, and the reason the two loaders no longer mark anything:
 * "Rendering data into the DOM is not sufficient. A notification becomes read
 * after it has been visibly displayed to the user, or when the user explicitly
 * marks it as read."
 *
 * So "seen" is defined here, once, as: at least SEEN_RATIO of the row inside
 * the viewport, continuously, for SEEN_DWELL_MS, while the tab is actually in
 * front. Anything short of that leaves the row unread.
 *
 * Usage — attach the returned ref callback to a row's outermost element:
 *
 *   const { observe } = useSeenNotifications({ enabled: !!session });
 *   {rows.map(n => <Row key={n.id} rootRef={observe(n.id)} … />)}
 *
 * ⚠ PASS ONLY UNREAD IDS OR DON'T — either is safe. An id already claimed is
 * ignored for the lifetime of the hook, so a re-render (or the 30s poll
 * replacing the list wholesale) cannot re-write a row or restart its dwell.
 */

/** Fraction of the row that must be inside the viewport to start counting. */
export const SEEN_RATIO = 0.5;

/** How long it must stay there. Long enough that a fast scroll past does not
 *  count as reading; short enough that a glance does. */
export const SEEN_DWELL_MS = 1000;

/** Rows seen together are written together — scrolling a list marks a run of
 *  rows within a few hundred ms of each other, and that is one UPDATE, not ten. */
const FLUSH_DEBOUNCE_MS = 400;

export default function useSeenNotifications({ enabled = true, onSeen } = {}) {
  // Element → { id, timer }. Keyed by element because that is what the
  // observer hands back.
  const rowsRef      = useRef(new Map());
  // id → Element, so a ref callback firing with null can find what to detach.
  const elementsRef  = useRef(new Map());
  // id → ref callback. Stable per id: returning a fresh function each render
  // would make React detach and re-attach every row on every render, and a
  // re-attached row starts its dwell again — so nothing below the fold would
  // ever survive long enough to count while the 30s poll is running.
  const callbacksRef = useRef(new Map());
  const claimedRef   = useRef(new Set());
  const pendingRef   = useRef(new Set());
  const observerRef  = useRef(null);
  const flushRef     = useRef(null);

  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;

  const flush = useCallback(async () => {
    clearTimeout(flushRef.current);
    flushRef.current = null;
    const ids = [...pendingRef.current];
    if (ids.length === 0) return;
    pendingRef.current.clear();

    const { error } = await markNotificationsRead(ids);
    if (error) {
      // Un-claim so a later pass can try again. The row is still unread in the
      // database, so leaving it claimed would strand it: visibly unread, never
      // retried, and the badge would keep counting a row the user has seen.
      ids.forEach(id => claimedRef.current.delete(id));
      return;
    }
    if (onSeenRef.current) onSeenRef.current(ids);
  }, []);

  const claim = useCallback((id) => {
    if (!id || claimedRef.current.has(id)) return;
    claimedRef.current.add(id);
    pendingRef.current.add(id);
    clearTimeout(flushRef.current);
    flushRef.current = setTimeout(flush, FLUSH_DEBOUNCE_MS);
  }, [flush]);

  const cancelDwell = useCallback((row) => {
    if (row?.timer) { clearTimeout(row.timer); row.timer = null; }
  }, []);

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return undefined;

    // Root is the viewport deliberately, including for NotifPanel's own
    // scrolling list. The intersection rectangle is clipped by every ancestor
    // that scrolls, so a row scrolled out of the panel already reports zero —
    // naming the panel as the root would add a coupling for no behaviour.
    const observer = new IntersectionObserver((entries) => {
      const visible = document.visibilityState === 'visible';
      for (const entry of entries) {
        const row = rowsRef.current.get(entry.target);
        if (!row) continue;

        const showing = entry.isIntersecting && entry.intersectionRatio >= SEEN_RATIO;
        if (!showing || !visible) { cancelDwell(row); continue; }
        if (row.timer) continue;

        row.timer = setTimeout(() => {
          row.timer = null;
          claim(row.id);
          // Seen once is seen. Nothing changes on a second look, and dropping
          // it keeps the observer's working set to what is still unread.
          observer.unobserve(entry.target);
        }, SEEN_DWELL_MS);
      }
    }, { threshold: [SEEN_RATIO] });

    observerRef.current = observer;
    for (const el of rowsRef.current.keys()) observer.observe(el);

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [enabled, claim, cancelDwell]);

  /**
   * ⚠ TIME ON A BACKGROUNDED TAB IS NOT TIME SPENT LOOKING. The observer keeps
   * reporting a row as intersecting when the tab goes behind another window or
   * the phone locks, so without this a list left open would mark itself read in
   * a pocket. Every dwell in flight is cancelled on the way out.
   *
   * Coming back needs the re-observe: the intersection has not CHANGED while
   * hidden, so no fresh entry would arrive and rows already on screen would sit
   * unread until the user scrolled. Re-observing re-fires the initial callback.
   */
  useEffect(() => {
    if (!enabled) return undefined;
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') {
        for (const row of rowsRef.current.values()) cancelDwell(row);
        return;
      }
      const observer = observerRef.current;
      if (!observer) return;
      for (const el of rowsRef.current.keys()) { observer.unobserve(el); observer.observe(el); }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [enabled, cancelDwell]);

  // Closing the panel (or leaving the screen) must not lose a row that already
  // finished its dwell and was only waiting on the debounce. Timers still
  // running are cancelled rather than claimed — an unfinished dwell means the
  // row was not seen, and unmount is not evidence to the contrary.
  useEffect(() => () => {
    for (const row of rowsRef.current.values()) cancelDwell(row);
    flush();
  }, [flush, cancelDwell]);

  const observe = useCallback((id) => {
    if (!id) return undefined;
    let cb = callbacksRef.current.get(id);
    if (cb) return cb;

    cb = (el) => {
      const previous = elementsRef.current.get(id);
      if (previous && previous !== el) {
        cancelDwell(rowsRef.current.get(previous));
        rowsRef.current.delete(previous);
        elementsRef.current.delete(id);
        observerRef.current?.unobserve(previous);
      }
      if (!el || claimedRef.current.has(id)) return;
      elementsRef.current.set(id, el);
      rowsRef.current.set(el, { id, timer: null });
      observerRef.current?.observe(el);
    };
    callbacksRef.current.set(id, cb);
    return cb;
  }, [cancelDwell]);

  /**
   * The explicit half of the owner's ruling — "or when the user explicitly
   * marks it as read". Bypasses dwell entirely, which is the point: the user
   * has just said so, and asking them to also look at each row would be
   * absurd.
   */
  const markSeenNow = useCallback(async (ids) => {
    const fresh = (ids || []).filter(id => id && !claimedRef.current.has(id));
    fresh.forEach(id => { claimedRef.current.add(id); pendingRef.current.add(id); });
    await flush();
  }, [flush]);

  return { observe, markSeenNow };
}
