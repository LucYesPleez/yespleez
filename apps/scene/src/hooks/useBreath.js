import { useState, useEffect } from 'react';
import { BREATH_MS } from '../lib/installCoach';

/**
 * A SLOW, REPEATING ON/OFF — the timing half of the install coach's glow.
 *
 * Returns a boolean that goes true for one breath, then false, then true
 * again `interval` later. Both the spotlight halo and the ambient ring around
 * the header icon run on this; only their numbers differ (8s while the
 * spotlight is up, 12s at rest, with a 4s opener on each new page).
 *
 * ⚠ THE FLAG MUST RETURN TO FALSE BETWEEN BREATHS, which is why this is a
 * pulse and not a looping CSS animation. The animation is `both`-filled and
 * plays once per mount of the class; if the class never came off, it would
 * never restart. Toggling is also what lets the cadence change mid-life —
 * a CSS `animation-iteration-count: infinite` cannot be talked out of its
 * rhythm without restarting the whole animation, visibly.
 *
 * ⚠ `interval` IS MEASURED BREATH-START TO BREATH-START, not from the end of
 * one to the start of the next. "Every 12 seconds" is what the brief says and
 * what a user perceives; adding the breath's own 3.6s on top would drift the
 * felt cadence to 15.6s.
 *
 * @param {boolean} enabled  false parks it silently — no timers, never lit.
 * @param {number}  firstMs  delay before the FIRST breath.
 * @param {number}  intervalMs  breath-start to breath-start thereafter.
 * @param {*}       resetKey  change it to start the cycle over from `firstMs`.
 *   The ambient pulse passes the route here: "every new page they go to, the
 *   icon pulses after 4 seconds, then returns to one every 12". Without a
 *   restart the user would land on a new page mid-interval and wait anywhere
 *   from 0 to 12 seconds, which is not a cadence — it is a coin toss.
 */
export default function useBreath(enabled, firstMs, intervalMs, resetKey) {
  const [lit, setLit] = useState(false);

  useEffect(() => {
    if (!enabled) { setLit(false); return undefined; }

    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.add(t); return t; };

    let repeat;
    const breathe = () => {
      setLit(true);
      // Off again once the animation has finished, so the next `true` is a
      // genuine re-trigger rather than a no-op on an already-present class.
      later(() => setLit(false), BREATH_MS);
    };

    later(() => {
      breathe();
      repeat = setInterval(breathe, intervalMs);
    }, firstMs);

    return () => {
      for (const t of timers) clearTimeout(t);
      clearInterval(repeat);
      setLit(false);
    };
  }, [enabled, firstMs, intervalMs, resetKey]);

  return lit;
}
