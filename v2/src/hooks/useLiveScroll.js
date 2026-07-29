import { useEffect } from 'react';

/**
 * DRIVING THE REAL PAGE, NOT A SCREENSHOT.
 *
 * ⚠⚠ THIS EXISTS BECAUSE THE SCREENSHOT FIX DOESN'T APPLY HERE. My Scene and
 * Messages needed a scripted screenshot because a guest's real versions of
 * those screens are genuinely empty. What's On and Discover are not — a guest
 * sees real, current events and real, current artists — so owner: "both of
 * these screens should scroll as the info that's already there is current."
 * Faking a screenshot of data that is already live and already on screen
 * would be pointless; this scrolls the ACTUAL page.
 *
 * ⚠⚠ EVERY STOP IS CLAMPED TO WHAT THE PAGE CAN ACTUALLY SCROLL, and that is
 * the whole reason this works on two very different screens. A waypoint's
 * offset is where the element SITS; it is not necessarily somewhere the page
 * can scroll TO. Measured live: What's On is a long page (stops at 406, 755,
 * 1088, 1421) and behaves as you'd expect. Discover's content was only 158px
 * taller than the window, with its section headings at 285 and 554 — both
 * past the end of the scroll range. Unclamped, the browser silently pinned
 * every one of those to 158, each "animation" finished instantly with
 * nothing visible moving, and the loop just span through its stops. Clamping
 * (and then dropping stops that collapse onto each other) turns that into an
 * honest "there is barely anything to scroll here", which is the truth.
 */

/**
 * THE RAIL'S SWIPE RHYTHM — a list of (time, distance) stops, both as
 * fractions, linearly interpolated between. The uneven spacing IS the
 * feel: covering a lot of distance in little time reads as a flick,
 * covering little in comparable time reads as momentum dying off.
 *
 * ⚠ THE OPENING IS SPLIT 60/40, and that is the whole reason this is not
 * one smooth ramp. It used to reach the rail's halfway point in a single
 * unbroken sweep, which on a horizontal card rail reads as a shove rather
 * than a swipe — owner: "the portrait scroll first move is far too long."
 * Now: 0 → 30% of the rail, a beat to settle, then the remaining 20% to
 * land on the same halfway mark. Everything from .15 onwards — the run to
 * the far end, the hold there, the two-stage return — is unchanged.
 *
 * ⚠ ONLY THE RAILS USE THIS. The page's own vertical motion is waypoint
 * based (stop-to-stop on real headings, see below) and never samples a
 * curve at all.
 */
const CURVE = [
  [0,    0],
  [.05,  .30],   // first flick — 60% of the old opening move
  [.075, .33],   // settle
  [.11,  .50],   // the other 40%, landing where the old opening ended
  [.15,  .56],
  [.26,  1],     // run to the far end
  [.42,  1],     // hold there
  [.54,  .42],   // return, in two stages
  [.6,   .36],
  [.72,  0],
  [1,    0],     // hold at the start before repeating
];

function sampleCurve(progress) {
  for (let i = 1; i < CURVE.length; i++) {
    const [t0, d0] = CURVE[i - 1];
    const [t1, d1] = CURVE[i];
    if (progress <= t1) {
      const span = t1 - t0;
      const local = span > 0 ? (progress - t0) / span : 0;
      return d0 + (d1 - d0) * local;
    }
  }
  return 0;
}

function easeInOutCubic(t) {
  return t < .5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

const WAYPOINT_MOVE_MS = 875;
const WAYPOINT_HOLD_MS = 1188;
// The true top gets longer than an ordinary content stop — it is where the
// heading itself lives, and where the cycle both starts and ends.
const WAYPOINT_TOP_HOLD_MS = 1875;
// Below this, a page is "not really scrollable" and stop-to-stop motion would
// be a few jittery pixels pretending to be a tour. Rails still run.
const MIN_USEFUL_SCROLL = 80;

/**
 * @param {boolean} active
 * @param {string[]} [rails]      `data-tour` selectors for horizontal rails
 *                                (a portrait-card row) scrolled on the
 *                                fraction curve — ALWAYS, independently of
 *                                whether the page itself has anywhere to go.
 *                                On a short page this is the only motion, and
 *                                it is the one that matters: it is the cards
 *                                the step is talking about.
 * @param {string}  [waypoints]   a `data-tour` selector matching, in DOM
 *                                order, every element to stop at.
 * @param {number}  [durationMs]  rail cycle length.
 */
export default function useLiveScroll(active, rails = [], waypoints, durationMs = 10000) {
  // Rails is routinely a fresh array literal every render; depending on its
  // identity would restart the loop constantly.
  const railsKey = rails.join('|');

  useEffect(() => {
    if (!active) return undefined;
    // A moving page is exactly the kind of motion this setting exists to
    // suppress — sitting still on whatever the page already shows is the
    // correct fallback, not a jump to a fixed scroll position.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;

    const scroller = document.scrollingElement || document.documentElement;
    const originalScrollTop = scroller.scrollTop;
    let raf, railRaf, timer, cancelled = false;
    let railEls = [];
    let originalRailLefts = [];

    /**
     * ⚠⚠ WAIT FOR THE SCREEN TO EXIST BEFORE MEASURING IT. This is the bug
     * that made Discover look broken while What's On worked, and the two
     * differed for a reason that has nothing to do with either screen: a
     * step declaring `route` NAVIGATES first, so when this effect runs, the
     * new page has not rendered and every `querySelector` returns null. Only
     * the step whose route was ALREADY current (What's On, the tour's first
     * page) happened to find its targets on the first try.
     *
     * A single `requestAnimationFrame` was not enough either — the route
     * change, React's re-render and the screen's own data all have to land.
     * So this retries for up to ~2s and starts the moment the targets are
     * actually there, which is correct for both cases: instant when the page
     * is already up, patient when it is still arriving.
     */
    const deadline = performance.now() + 2000;
    // ⚠ EACH WAITER OWNS ITS OWN HANDLE, collected for cleanup. The rails
    // and the page wait independently and can become ready on different
    // frames; sharing one `raf` variable means whichever starts second
    // overwrites the other's handle, and cleanup then cancels a frame that
    // is no longer the live one — leaving a loop running after unmount.
    const pending = new Set();
    const whenReady = (isReady, start) => {
      const attempt = () => {
        if (cancelled) return;
        if (isReady()) { start(); return; }
        if (performance.now() > deadline) return;
        const next = requestAnimationFrame(attempt);
        pending.add(next);
      };
      const first = requestAnimationFrame(attempt);
      pending.add(first);
    };

    // ── THE RAILS ────────────────────────────────────────────────────────
    // Kept entirely separate from the page scroll, because on a short page
    // (Discover) this is the ONLY thing that moves, and it must not be
    // conditional on the page having somewhere to go.
    if (rails.length) {
      whenReady(
        () => rails.every(sel => document.querySelector(sel)),
        () => {
          railEls = rails.map(sel => document.querySelector(sel)).filter(Boolean);
          originalRailLefts = railEls.map(el => el.scrollLeft);
          const railStart = performance.now();
          const tickRails = (now) => {
            if (cancelled) return;
            const frac = sampleCurve(((now - railStart) % durationMs) / durationMs);
            /**
             * ⚠⚠ RE-QUERIED EVERY FRAME, NOT CAPTURED ONCE. Discover's rail
             * lives inside `profiles.length > 0`, so the element that exists
             * when this loop starts is frequently NOT the element that ends
             * up on screen — when the profile data lands, React mounts a
             * fresh node and the one captured here becomes detached. A
             * detached node reports `scrollWidth === 0`, so the loop keeps
             * running and keeps setting `scrollLeft` to zero, which is
             * exactly "the rail never moves" with no error anywhere.
             * Re-querying costs a selector lookup per frame and removes the
             * entire class of bug.
             */
            const live = rails.map(sel => document.querySelector(sel)).filter(Boolean);
            if (live.length) railEls = live;
            for (const el of railEls) {
              el.scrollLeft = frac * Math.max(0, el.scrollWidth - el.clientWidth);
            }
            railRaf = requestAnimationFrame(tickRails);
          };
          railRaf = requestAnimationFrame(tickRails);
        },
      );
    }

    // ── THE PAGE ─────────────────────────────────────────────────────────
    if (waypoints) {
      whenReady(() => document.querySelector(waypoints), () => {
        if (cancelled) return;

        const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        // Nothing worth touring vertically — leave the page where it is and
        // let the rails carry the step. See MIN_USEFUL_SCROLL.
        if (maxScroll < MIN_USEFUL_SCROLL) return;

        const els = [...document.querySelectorAll(waypoints)];
        if (!els.length) return;

        // Clamp, then drop stops that collapsed onto their neighbour — two
        // "different" waypoints that both pin to the page bottom are one
        // stop, and animating between them is a 0px move that burns a beat.
        const raw = els.map(el => Math.min(
          maxScroll,
          Math.round(el.getBoundingClientRect().top + scroller.scrollTop),
        ));
        const stops = [0];
        for (const v of raw) {
          if (Math.abs(v - stops[stops.length - 1]) > 24) stops.push(v);
        }
        // A single stop means the page had one reachable section; there is
        // no tour to run, only a jump and a jump back.
        if (stops.length < 2) return;
        // Closes the loop back to the top so the cycle repeats seamlessly.
        stops.push(0);

        let hop = 0;
        const runHop = () => {
          if (cancelled) return;
          const from = stops[hop];
          const to = stops[(hop + 1) % stops.length];
          const start = performance.now();

          const step = (now) => {
            if (cancelled) return;
            const t = Math.min(1, (now - start) / WAYPOINT_MOVE_MS);
            scroller.scrollTop = from + (to - from) * easeInOutCubic(t);
            if (t < 1) { raf = requestAnimationFrame(step); return; }

            timer = setTimeout(() => {
              hop = (hop + 1) % stops.length;
              runHop();
            }, to === 0 ? WAYPOINT_TOP_HOLD_MS : WAYPOINT_HOLD_MS);
          };
          raf = requestAnimationFrame(step);
        };
        runHop();
      });
    }

    return () => {
      cancelled = true;
      pending.forEach(cancelAnimationFrame);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(railRaf);
      clearTimeout(timer);
      scroller.scrollTop = originalScrollTop;
      railEls.forEach((el, i) => { el.scrollLeft = originalRailLefts[i]; });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, railsKey, waypoints, durationMs]);
}
