import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * ── ⭐ ARRIVING AT A SECTION, NOT JUST AT A SCREEN ───────────────────────────
 *
 * A notification that lands you on a dashboard has only half-answered itself:
 * the thing it is about is one of eight sections down the page. `?section=` and
 * `?tab=` carry the rest of the address, and this hook is the ONE reader of
 * them — a second copy in each dashboard is how two screens end up disagreeing
 * about what `?tab=BOOKED` means.
 *
 * ⚠⚠ THE SECTION DOES NOT EXIST WHEN THE SCREEN MOUNTS. Every dashboard renders
 * its sections after its data arrives, so scrolling on mount scrolls to nothing
 * and silently does nothing — the exact shape of failure that makes a link look
 * broken. This polls for the element and gives up after a bounded wait rather
 * than assuming either.
 *
 * ⛔ It does not scroll ANYTHING itself. Each dashboard owns the offset its own
 * header needs, so the hook hands back the resolved id and the tab and lets the
 * screen do what it already does for its own stat tiles.
 *
 * ⭐ Fires ONCE per arrival. A landing is an event, not a state: re-running it
 * on every render would drag the page back every time the user scrolled away.
 */
export function useDashboardLanding(onLand) {
  const [params] = useSearchParams();
  const landed = useRef(false);
  const section = params.get('section');
  const tab = params.get('tab');

  // The callback is read through a ref so a screen may pass an inline arrow
  // without re-arming the effect on every render.
  const handler = useRef(onLand);
  handler.current = onLand;

  useEffect(() => {
    if (!section || landed.current) return undefined;
    const elementId = `section-${section}`;
    let tries = 0;
    let lastTop = null;
    const timer = setInterval(() => {
      tries += 1;
      const el = document.getElementById(elementId);
      /* ⛔⛔ THE DEADLINE APPLIES TO THE WHOLE SEARCH, ⛔ not only to a missing
         element. A first version gave up only when the section was ABSENT, so
         a section that existed but never stopped moving — a rail still loading
         its images — polled forever and never scrolled at all. A late,
         approximate landing beats no landing. */
      if (el && tries >= SETTLE_DEADLINE) {
        landed.current = true;
        clearInterval(timer);
        handler.current?.({ section, tab, elementId, el });
        return;
      }
      if (el) {
        /**
         * ⚠⚠ EXISTING IS NOT THE SAME AS SETTLED, and scrolling to a section
         * that is still moving lands nowhere near it.
         *
         * Measured: the section appeared, we scrolled, and the rest of the
         * dashboard (avatar, stats, availability rail) then rendered ABOVE it
         * and pushed it 500px down the page — so the reader arrived at the
         * right screen looking at the wrong thing, which is indistinguishable
         * from the link being ignored.
         *
         * ⭐ So wait for its position to stop changing between polls. That is
         * a measurement of the real layout rather than a guessed delay, and it
         * costs one extra 100ms tick in the settled case.
         */
        const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
        if (lastTop !== top) { lastTop = top; return; }
        landed.current = true;
        clearInterval(timer);
        handler.current?.({ section, tab, elementId, el });
      } else if (tries >= MAX_TRIES) {
        // ⛔ Give up quietly. The section may genuinely not exist for this
        // reader — a link built for an artist opened by a host — and dragging
        // them somewhere arbitrary is worse than leaving them at the top.
        clearInterval(timer);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [section, tab]);
}

const POLL_MS = 100;
const MAX_TRIES = 50;        // 5s — long enough for a cold dashboard fetch
const SETTLE_DEADLINE = 18;  // 1.8s — land approximately rather than not at all
