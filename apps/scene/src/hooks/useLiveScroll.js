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

/* ⚠ THE MULTI-STOP RAIL CURVE IS GONE (2026-07-29). It described a flick out
   to the far end, a hold, and a two-stage return — a demonstration of the
   rail's whole contents. The rail's job in the tour is now a single short
   swipe that stays where it lands (see RAIL_SWIPE_PX), so the curve had no
   caller left. Removed rather than kept, because a documented rhythm the code
   no longer performs is worse than no comment at all; the history is in git if
   the flick is ever wanted back. */

function easeInOutCubic(t) {
  return t < .5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

const WAYPOINT_MOVE_MS = 600;
const WAYPOINT_HOLD_MS = 1188;

/* ── THE RAIL'S TEACHING GESTURE (owner spec, 2026-07-29) ──────────────────
   The page stops on Recently Added, waits ~500ms, and the rail takes ONE
   gentle swipe — two or three cards, slowly, ease-in-out, and it stays where
   it lands. No bounce, no overshoot, no return. The moment it finishes, the
   tour continues.

   ⚠ THE POINT IS THE FINGER, NOT THE CONTENTS. "It is a teaching gesture...
   like a real person lightly dragging the rail." A full-width traverse showed
   everything in the rail and taught nothing about how to move it; a short
   deliberate push is legible as a gesture that could be copied. */
const RAIL_SWIPE_PX     = 220;   // 2–3 cards
const RAIL_GLIDE_MS     = 900;
const POST_RAIL_HOLD_MS = 0;     // "continue immediately"

/* ⚠ THE PAGE MOVES FIRST AND THE RAIL MOVES SECOND. They never overlap. The
   rail used to start on wall-clock time the instant it existed, so it was
   already sliding while the page was still travelling — which is why the cards
   always looked "already scrolling" by the time the reader got there.

   ⚠ EVERY STEP PAUSES ON ENTRY, not just the ones that scroll. Owner,
   2026-07-29: "make every page in the tour pause as tour enters page, then
   wait 800ms before next action." Nothing on the screen behind the card may
   move until this has elapsed — the reader needs a moment to register that
   the page changed before anything starts animating. Mirrored as the
   scrolling demos' animation-delay in TourDemos.module.css. */
const ENTRY_PAUSE_MS = 800;
const RAIL_DWELL_MS  = 500;

/* Clear air above a section heading when the page stops on it, ON TOP of the
   sticky header's own height. Without it the stop puts the heading's top edge
   at viewport top, i.e. behind the header. */
const WAYPOINT_HEADING_GAP_PX = 20;
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
    let raf, railRaf, timer, railTimer, cancelled = false;
    let startRailGlide = null;
    // Temporary bottom padding added so sections can rise above the tour card.
    let padEl = null, originalPadBottom = '';
    // The rail makes ONE pass, on the first content stop; the page then waits
    // for it to finish before continuing to the next section.
    let railTriggered = false, onRailDone = null;
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
    /* ⚠ 2s WAS TOO TIGHT AND FAILED SILENTLY. Measured on Discover: the route
       change plus the profile fetch put the rail on screen at ~2.1s, just past
       the old deadline — so the waiter gave up, the rail was never claimed or
       driven, and the step ran with the cards sitting perfectly still. Nothing
       errored; the motion simply never happened.

       Waiting longer costs nothing: this resolves the instant the targets
       exist, so a fast load is unaffected and only a slow one benefits. */
    const deadline = performance.now() + 5000;
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
          /* ⚠ CLAIM THE RAIL. useDragScroll's first-visit "bump" is a second,
             independent writer of the same scrollLeft — measured mid-step, it
             shoved the cards 46px while the tour was driving them. Marking the
             element lets that hint stand down while the tour owns the motion;
             released on cleanup. */
          railEls.forEach(el => { el.dataset.liveScroll = '1'; });
          /* ⚠ A TEACHING GESTURE, NOT AN ANIMATION.
             Owner, 2026-07-29: "This is not an animation for visual effect. It
             is a teaching gesture... The movement should feel like a real
             person lightly dragging the rail with their finger."

             So: one short swipe of two or three cards, slow enough to follow,
             and it STAYS WHERE IT LANDS. No bounce, no overshoot, no return.
             Once the reader has seen a couple of new cards arrive, the point is
             made and the tour moves on.

             This replaced a full-width traverse driven by CURVE — out to the
             far end, a hold, and back again, over seconds. That demonstrated
             the rail's whole contents; it did not demonstrate that a finger
             moves it. The distance is now deliberately small.

             `startRailGlide` is called by the page loop once it has arrived and
             held, or immediately below if this step has no page tour. */
          let railStart = null;
          let swipeFrom = [];
          startRailGlide = () => {
            if (railStart !== null) return;      // one swipe, not one per hold
            swipeFrom = railEls.map(el => el.scrollLeft);
            railStart = performance.now();
          };
          const tickRails = (now) => {
            if (cancelled) return;
            if (railStart === null) { railRaf = requestAnimationFrame(tickRails); return; }
            const t = Math.min(1, (now - railStart) / RAIL_GLIDE_MS);
            const eased = easeInOutCubic(t);
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
            railEls.forEach((el, i) => {
              const from = swipeFrom[i] ?? 0;
              // Clamped, so a short rail stops at its end rather than pretending
              // to travel further than it has.
              const to = Math.min(from + RAIL_SWIPE_PX, Math.max(0, el.scrollWidth - el.clientWidth));
              el.scrollLeft = from + (to - from) * eased;
            });
            /* It rests where it lands. The tour continues the moment the swipe
               finishes — the reader has seen new cards arrive, which was the
               whole point. */
            if (t < 1) { railRaf = requestAnimationFrame(tickRails); return; }
            if (onRailDone) { const done = onRailDone; onRailDone = null; done(); }
          };
          railRaf = requestAnimationFrame(tickRails);

          // No page tour on this step, so there is nothing to take turns with:
          // observe the same entry pause and dwell, then go.
          if (!waypoints) timer = setTimeout(startRailGlide, ENTRY_PAUSE_MS + RAIL_DWELL_MS);
        },
      );
    }

    // ── THE PAGE ─────────────────────────────────────────────────────────
    if (waypoints) {
      whenReady(() => document.querySelector(waypoints), () => {
        if (cancelled) return;

        /* ⚠ THE CARD COVERS THE BOTTOM OF THE SCREEN, SO THE PAGE NEEDS ROOM
           TO LIFT CONTENT ABOVE IT.
           Owner, 2026-07-29: "I don't ever see the events in the window."
           Measured: Discover's last section heading reached the top fine, but
           every event under it sat behind the tour card — and the page had
           already hit the end of its scroll range, so nothing could bring them
           up. The page simply ends before the card does.

           Adding temporary padding equal to what the card covers gives the
           scroll somewhere to go. The blank space it creates is exactly the
           band the card is sitting over, so nobody ever sees it. Removed on
           cleanup, so the page is left as it was found. */
        const card = document.querySelector('[data-tour-card]');
        const cardCover = card
          ? Math.max(0, window.innerHeight - card.getBoundingClientRect().top)
          : 0;
        if (cardCover > 0) {
          padEl = scroller === document.documentElement ? document.body : scroller;
          originalPadBottom = padEl.style.paddingBottom;
          const existing = parseFloat(getComputedStyle(padEl).paddingBottom) || 0;
          padEl.style.paddingBottom = `${existing + cardCover + WAYPOINT_HEADING_GAP_PX}px`;
        }

        const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        // Nothing worth touring vertically — leave the page where it is and
        // let the rails carry the step. See MIN_USEFUL_SCROLL.
        if (maxScroll < MIN_USEFUL_SCROLL) return;

        const els = [...document.querySelectorAll(waypoints)];
        if (!els.length) return;

        // Clamp, then drop stops that collapsed onto their neighbour — two
        // "different" waypoints that both pin to the page bottom are one
        // stop, and animating between them is a 0px move that burns a beat.
        /* ⚠ STOP SHORT OF THE HEADING, NOT ON IT.
           A waypoint's offset puts the element's top edge at viewport top —
           which is UNDERNEATH the sticky header, so the very heading the stop
           exists to show (TONIGHT, THIS WEEKEND, COMING UP) arrived clipped or
           hidden behind it. Owner, 2026-07-29: "the headings aren't matching
           up... move the page down enough px so the correct headings have a
           20px buffer above."

           The header measures itself into --yp-header-height (GlobalHeader),
           so this follows it rather than hard-coding a number that would drift
           the moment the header changes. Falls back to the same 56px default
           the rest of the app uses. */
        const headerH = parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--yp-header-height'),
        ) || 56;
        const topGap = headerH + WAYPOINT_HEADING_GAP_PX;

        const raw = els.map(el => Math.max(0, Math.min(
          maxScroll,
          Math.round(el.getBoundingClientRect().top + scroller.scrollTop - topGap),
        )));
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

            /* ⚠ ARRIVED. */

            const nextHop = () => {
              hop = (hop + 1) % stops.length;
              runHop();
            };

            /* ⚠ THE PAGE WAITS FOR THE RAIL, IT DOES NOT TALK OVER IT.
               Owner's order, 2026-07-29: "pause on Recently Added / Active for
               400ms, then scroll the horizontal portrait cards once, THEN
               scroll to Recently Added Events."

               The hold used to be a fixed WAYPOINT_HOLD_MS, so the page moved
               on to the next section on its own schedule — cutting the rail
               off partway through its pass. Now the first content stop hands
               control to the rail and only continues once the glide has
               finished. Every other stop keeps the ordinary hold. */
            if (to !== 0 && startRailGlide && !railTriggered) {
              railTriggered = true;
              railTimer = setTimeout(startRailGlide, RAIL_DWELL_MS);
              onRailDone = () => { timer = setTimeout(nextHop, POST_RAIL_HOLD_MS); };
              return;
            }

            timer = setTimeout(nextHop, to === 0 ? WAYPOINT_TOP_HOLD_MS : WAYPOINT_HOLD_MS);
          };
          raf = requestAnimationFrame(step);
        };
        /* THE ENTRY PAUSE. Nothing moves for a beat after the step opens, so
           the reader registers that the page changed before it starts
           travelling — otherwise the scroll is already underway before they
           have looked at it. */
        timer = setTimeout(runHop, ENTRY_PAUSE_MS);
      });
    }

    return () => {
      cancelled = true;
      pending.forEach(cancelAnimationFrame);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(railRaf);
      clearTimeout(timer);
      clearTimeout(railTimer);
      if (padEl) padEl.style.paddingBottom = originalPadBottom;
      scroller.scrollTop = originalScrollTop;
      railEls.forEach((el, i) => { el.scrollLeft = originalRailLefts[i]; delete el.dataset.liveScroll; });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, railsKey, waypoints, durationMs]);
}
