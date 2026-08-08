import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * The one way a screen reads data.
 *
 * Deliberately tiny — no cache, no dedupe, no retries. A real query library
 * belongs here eventually, and when it arrives it replaces this file and
 * nothing else, because every caller already speaks `{ data, loading, error,
 * reload }`.
 *
 * ⭐ WHAT IT DOES GET RIGHT, because these are the bugs that actually bite:
 *
 *   · A stale response never wins. Switch category quickly and the slower
 *     first request must not overwrite the faster second one — otherwise the
 *     table shows Volunteers under a Music tab, which reads as data
 *     corruption rather than a race.
 *   · It does not set state after unmount.
 *   · `loading` stays true for the FIRST load only; a refetch keeps the old
 *     rows on screen rather than blanking a table someone is reading.
 */
export function useQuery(fn, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, loading: enabled, error: null });
  const runId = useRef(0);
  const alive = useRef(true);

  /**
   * ⚠ SET TO TRUE ON MOUNT, not just false on unmount.
   *
   * StrictMode deliberately mounts, unmounts and remounts every component in
   * development. A cleanup that only ever sets this to `false` leaves it
   * false forever after that first cycle, so every response is discarded as
   * "arrived after unmount" and the UI loads silently, permanently, with no
   * error. It cost me a stuck skeleton and two wrong theories about the dev
   * server before I looked here.
   */
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const run = useCallback(async () => {
    const id = ++runId.current;
    setState(prev => ({ ...prev, loading: prev.data == null, error: null }));
    try {
      const data = await fn();
      // Ignore anything that is not the most recent request.
      if (!alive.current || id !== runId.current) return;
      setState({ data, loading: false, error: null });
    } catch (error) {
      if (!alive.current || id !== runId.current) return;
      setState({ data: null, loading: false, error });
    }
    // `fn` is intentionally excluded — callers pass an inline closure, so
    // depending on it would re-run on every render. `deps` is the contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!enabled) return;
    run();
  }, [run, enabled]);

  return { ...state, reload: run };
}
