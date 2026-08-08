// THE FACEBOOK-STYLE HEADER: transparent at rest, opaque once you move, gone
// once you commit to reading, back the instant you look up.
//
// Spec (owner, 2026-08-04): fade transparent -> rgba(10,10,16,.95) over the
// first 80px with a matching blur; keep the bar visible through that; only then
// let a deliberate downward scroll slide it away; return it immediately on any
// upward scroll, wherever you are on the page.
//
// ── WHY THIS TOUCHES THE DOM DIRECTLY AND NOT REACT STATE ────────────
// The alpha tracks scroll position continuously, so state would re-render
// GlobalHeader on every frame of every scroll — and GlobalHeader is not a leaf:
// it owns the notification panel, the share sheet, the tour overlay and three
// portals. Writing a custom property and toggling one class costs no React work
// at all and keeps the whole thing on the compositor.
//
// ⚠ TRANSFORM ONLY, NEVER `top`. `top` is a layout property: animating it
// relayouts the fixed element every frame and janks on a mid-range phone.
// `transform` is composited. The header ALSO carries translateX(-50%) for its
// own centring, so the hide has to COMPOSE with that rather than replace it —
// see .hidden in GlobalHeader.module.css, which restates both.

import { useEffect } from 'react';
import { isHeaderPinned, onHeaderPinChange } from '../lib/headerBehaviour';

/** Scroll distance over which the background reaches full opacity. */
export const FADE_DISTANCE = 80;

/** Peak background alpha — rgba(10,10,16,.95). */
export const MAX_ALPHA = 0.95;

/** Peak blur, reached with the alpha. */
export const MAX_BLUR_PX = 10;

/**
 * ⚠ HYSTERESIS, AND IT IS THE WHOLE ANTI-JITTER MECHANISM. Scroll events fire
 * with sub-pixel deltas and momentum scrolling reverses sign constantly near
 * rest; reacting to the sign of a single delta makes the bar oscillate. Travel
 * has to accumulate past this in one direction before the state flips.
 */
const DIRECTION_THRESHOLD = 12;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * @param ref        ref to the header element
 * @param hiddenClass the class that applies translateY(-100%)
 */
export default function useAutoHideHeader(ref, hiddenClass) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    // Honour the OS setting: someone who has asked for less motion should not
    // get a bar sliding in and out of view. They still get the fade, which is
    // a colour change rather than movement.
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    let lastY = window.scrollY;
    // Travel accumulated since the last direction change, signed.
    let travel = 0;
    let hidden = false;
    let frame = 0;
    let pinned = isHeaderPinned();

    const show = () => {
      if (!hidden) return;
      hidden = false;
      el.classList.remove(hiddenClass);
    };

    const apply = () => {
      frame = 0;
      const y = Math.max(0, window.scrollY);
      const delta = y - lastY;
      lastY = y;

      // ── the fade, driven by position rather than by events ──
      // A pure function of scrollY, so it cannot drift out of sync with the
      // page the way an accumulated value would after a programmatic jump.
      const progress = clamp(y / FADE_DISTANCE, 0, 1);
      el.style.setProperty('--yp-header-bg-a', String(progress * MAX_ALPHA));
      el.style.setProperty('--yp-header-blur', `${progress * MAX_BLUR_PX}px`);

      if (pinned || reduceMotion) { show(); return; }

      // Direction, with hysteresis. Travel resets whenever the sign flips, so
      // a jitter of a few pixels either way never reaches the threshold.
      if ((delta > 0 && travel < 0) || (delta < 0 && travel > 0)) travel = 0;
      travel += delta;

      // ⚠ NEVER HIDE INSIDE THE FADE ZONE. The spec keeps the bar visible until
      // the background is fully opaque — otherwise it would slide away while
      // still half transparent and read as a glitch rather than a gesture.
      if (y <= FADE_DISTANCE) { show(); return; }

      if (travel > DIRECTION_THRESHOLD && !hidden) {
        hidden = true;
        el.classList.add(hiddenClass);
      } else if (travel < -DIRECTION_THRESHOLD && hidden) {
        // Immediately, at any scroll position — this is the half people
        // actually feel. Reaching for the header is how you ask for it back.
        show();
      }
    };

    // rAF-coalesced: scroll can fire many times per frame, and doing this work
    // more than once per painted frame is wasted either way.
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };

    const unsubscribe = onHeaderPinChange(next => {
      pinned = next;
      if (pinned) { travel = 0; show(); }
    });

    apply();                       // paint the correct state before first scroll
    window.addEventListener('scroll', onScroll, { passive: true });
    // A route change scrolls to top without necessarily firing scroll, and a
    // resize can change where "top" is; both need the fade recomputed.
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
      unsubscribe();
      el.classList.remove(hiddenClass);
    };
  }, [ref, hiddenClass]);
}
