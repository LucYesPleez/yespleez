import { useEffect, useState } from 'react';

/**
 * The current time, to the MINUTE — the clock the set times read from.
 *
 * ⚠ A MINUTE, ⛔ NOT A SECOND. Nothing on the schedule changes faster than a
 * set boundary, so a per-second tick would re-render the whole night sixty
 * times for every state change it could possibly produce.
 *
 * ⭐ IT LANDS ON THE MINUTE, ⛔ not 60s after mount. A timer started at 8:59:59
 * would otherwise report the 9:00 change at 9:00:59, and the act on stage would
 * be a minute behind the room. The first tick is aligned to the boundary and
 * the interval takes over from there.
 *
 * ⚠ A HIDDEN TAB IS NOT A RUNNING ONE. Browsers throttle background timers, so
 * a phone left in a pocket comes back stale; the clock is re-read on
 * `visibilitychange` rather than trusted to have kept counting.
 */
export function useNowMinute(enabled = true) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return undefined;
    let interval = 0;
    const tick = () => setNow(Date.now());

    /* Time from here to the top of the next minute, so every later tick sits
       on the boundary rather than drifting from whenever this mounted. */
    const toBoundary = 60_000 - (Date.now() % 60_000);
    const align = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, toBoundary);

    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearTimeout(align);
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  return now;
}
