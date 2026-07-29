import { useRef, useCallback } from 'react';

// First-use discoverability: any named rail gets a small horizontal "bump"
// on its first 10 visits, then never again — just enough to hint it's
// swipeable without being distracting.
const DISCOVERY_MAX_VISITS = 10;
const DISCOVERY_BUMP_PX    = 46;
const DISCOVERY_KEY_PREFIX = 'yp_hscroll_visits_';

/* How long the rail takes to travel out and back. `behavior: 'smooth'` covered
   the 46px in roughly a fifth of a second — fast enough that the cards blurred
   past and the hint taught nothing. Owner, 2026-07-29: "scroll them at the same
   speed you do the vertical scroll". This is a comfortable read of that
   distance, and it is why the animation is hand-rolled rather than delegated. */
const DISCOVERY_GLIDE_MS = 900;
const DISCOVERY_HOLD_MS  = 420;   // a beat at the far end, so the eye can land

/* How still the page must be before the reader counts as "arrived", and how
   long the hint then waits before it moves. The dwell is the "wait a second" —
   long enough to reach the heading and see what the cards are. */
const DISCOVERY_SETTLE_MS = 400;
const DISCOVERY_DWELL_MS  = 1000;

/* easeInOutCubic — starts and ends at rest, like a page settling. */
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function glide(el, from, to, ms) {
  const start = performance.now();
  let raf = 0;
  const step = now => {
    if (!el.isConnected) return;
    const t = Math.min(1, (now - start) / ms);
    el.scrollLeft = from + (to - from) * ease(t);
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

function armDiscoveryBump(el, discoveryId) {
  const key = DISCOVERY_KEY_PREFIX + discoveryId;
  let settled = false;
  const timers = [];
  let cancelGlide = null;

  // Nothing to teach if the user has asked for stillness.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {};

  /* ⚠ THE HINT WAITS FOR THE READER TO ARRIVE AND STOP.
     Three conditions, and ALL of them must hold — each one alone was tried and
     each one alone was wrong:

       1. the rail is FULLY on screen, not clipping in at its edge
       2. the page has STOPPED scrolling
       3. a beat has passed since it settled

     Condition 2 is the one that actually matters and the one I kept missing.
     The rail enters the viewport partway through the reader's own scroll down
     the page, so firing on visibility alone means the cards slide while the
     page is still travelling — the motion is spent before the Recently Added
     heading has even arrived, and from the reader's seat the rail was "already
     scrolling" when they got there. Owner, said more times than it should have
     taken: "wait till it's at the heading for recently added, THEN scroll
     horizontal on the rail."

     So visibility only ARMS it. The scroll settling is what starts the clock. */
  let settleTimer = null;

  const beginWhenPageSettles = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      window.removeEventListener('scroll', beginWhenPageSettles, true);
      if (!el.isConnected) return;
      // The tour drives this rail itself while it is running; two writers on
      // one scrollLeft fight, and the reader sees a shove mid-glide.
      if (el.dataset.liveScroll) return;
      // Still fully in view after the scroll stopped? They may have passed it.
      const b = el.getBoundingClientRect();
      if (b.bottom > window.innerHeight || b.top < 0) return;
      timers.push(setTimeout(() => {
        if (!el.isConnected) return;
        cancelGlide = glide(el, 0, DISCOVERY_BUMP_PX, DISCOVERY_GLIDE_MS);
        timers.push(setTimeout(() => {
          if (el.isConnected) cancelGlide = glide(el, DISCOVERY_BUMP_PX, 0, DISCOVERY_GLIDE_MS);
        }, DISCOVERY_GLIDE_MS + DISCOVERY_HOLD_MS));
      }, DISCOVERY_DWELL_MS));
    }, DISCOVERY_SETTLE_MS);
  };

  const io = new IntersectionObserver(entries => {
    if (settled) return;
    if (!entries.some(e => e.isIntersecting && e.intersectionRatio >= 0.99)) return;
    if (el.scrollWidth <= el.clientWidth + 1) return;   // visible, but nothing to hint

    const visits = Number(localStorage.getItem(key) || 0);
    settled = true;
    io.disconnect();
    if (visits >= DISCOVERY_MAX_VISITS) return;
    localStorage.setItem(key, String(visits + 1));

    // Armed, not started. Every scroll event pushes the clock back; when they
    // stop, it runs out and the hint plays.
    window.addEventListener('scroll', beginWhenPageSettles, true);
    beginWhenPageSettles();
  }, { threshold: [0.99] });   // the WHOLE rail, not a sliver of its edge

  io.observe(el);

  return () => { io.disconnect(); window.removeEventListener('scroll', beginWhenPageSettles, true); clearTimeout(settleTimer); timers.forEach(clearTimeout); if (cancelGlide) cancelGlide(); };
}

/* How far the pointer may travel and still count as a click rather than a drag.
   Matches the browser's own instinct for the distinction; small enough that a
   deliberate tap always opens, large enough to absorb the wobble in a real
   hand. */
const DRAG_SLOP_PX = 5;

/* How far the rail travels per pixel of pointer movement.
   Was 1.2 — the rail ran AHEAD of the cursor, so cards crossed the screen
   faster than the hand moved them and were gone before they could be read.
   Owner, 2026-07-29: "half the speed".

   0.5 means the rail moves half as far as the hand. That deliberately gives up
   1:1 tracking — a card no longer stays under the cursor — in exchange for
   being able to actually look at what is going past, which is the entire point
   of a browsing rail. */
const DRAG_SPEED = 0.5;

export function useDragScroll(discoveryId) {
  const teardownRef = useRef(null);
  const drag = useRef({ active: false, startX: 0, scrollLeft: 0, downX: 0, downY: 0, moved: false });

  // A callback ref (not a plain ref object) so setup can run whenever the
  // node actually mounts — scroll rails are frequently rendered only once
  // async data has loaded, well after this hook's own first render. It also
  // exposes `.current` on itself (a normal ref object never calls back on
  // mount, so this is the one property external callers rely on, e.g.
  // MySceneScreen's `stripRef.current.children`).
  const ref = useCallback(el => {
    ref.current = el;
    if (teardownRef.current) { teardownRef.current(); teardownRef.current = null; }
    if (!el) return;

    /* ⚠ A DRAG MUST NOT DOUBLE AS A CLICK.
       Releasing after dragging the rail was opening whichever card happened to
       be under the cursor — you scrolled, let go, and the app navigated
       somewhere you never chose. The drag and the click are separate
       intentions; the second one now needs its own press.

       Swallowed in the CAPTURE phase on the rail itself, so the event never
       reaches the card and never bubbles to React's root listener — which is
       where onClick is actually dispatched. Done here rather than as a returned
       prop so all twelve rails are fixed without touching a single call site. */
    const swallowClickAfterDrag = ev => {
      if (!drag.current.moved) return;
      drag.current.moved = false;
      ev.preventDefault();
      ev.stopPropagation();
    };
    el.addEventListener('click', swallowClickAfterDrag, true);

    const bumpTeardown = discoveryId ? armDiscoveryBump(el, discoveryId) : null;
    teardownRef.current = () => {
      el.removeEventListener('click', swallowClickAfterDrag, true);
      if (bumpTeardown) bumpTeardown();
    };
  }, [discoveryId]);

  const onMouseDown = useCallback(e => {
    drag.current = {
      active: true,
      startX: e.pageX - ref.current.offsetLeft,
      scrollLeft: ref.current.scrollLeft,
      // Where the press began, so movement can be measured against it. Reset
      // every press: a clean click after a drag must still open the card.
      downX: e.clientX, downY: e.clientY, moved: false,
    };
    ref.current.style.cursor = 'grabbing';
    ref.current.style.userSelect = 'none';
  }, []);

  const onMouseUp = useCallback(() => {
    drag.current.active = false;
    if (ref.current) {
      ref.current.style.cursor = '';
      ref.current.style.userSelect = '';
    }
  }, []);

  const onMouseMove = useCallback(e => {
    if (!drag.current.active || !ref.current) return;
    e.preventDefault();
    // Measured from the press, not accumulated per move, so slow travel counts
    // the same as fast — it is the distance that makes it a drag, not the speed.
    if (!drag.current.moved) {
      const dx = e.clientX - drag.current.downX;
      const dy = e.clientY - drag.current.downY;
      if ((dx * dx) + (dy * dy) > DRAG_SLOP_PX * DRAG_SLOP_PX) drag.current.moved = true;
    }
    const x = e.pageX - ref.current.offsetLeft;
    const walk = (x - drag.current.startX) * DRAG_SPEED;
    ref.current.scrollLeft = drag.current.scrollLeft - walk;
  }, []);

  const onMouseLeave = useCallback(() => {
    drag.current.active = false;
    if (ref.current) {
      ref.current.style.cursor = '';
      ref.current.style.userSelect = '';
    }
  }, []);

  return { ref, onMouseDown, onMouseUp, onMouseMove, onMouseLeave };
}
