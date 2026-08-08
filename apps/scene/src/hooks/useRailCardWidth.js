import { useState, useEffect } from 'react';

/**
 * The width for a card in a horizontal-scroll rail (FollowingSection,
 * MessengerContactsSection) — 7.3 visible, desktop AND phone.
 *
 * ⚠ ONE COUNT AGAIN, NOT TWO. This briefly went 7.3 desktop / 4.3 phone, on
 * the assumption a smaller phone card needed more room to fit its text
 * legibly. The owner instead removed the text on phone (avatarOnly, below) —
 * an avatar alone stays legible much smaller than an avatar-plus-name does,
 * so the count could go back to matching desktop rather than needing its own
 * tier. If phone content changes again, re-check whether 7.3 still holds.
 *
 * `calc(100%/N)` gives the same COUNT at any width because it scales
 * proportionally with the container, which is what makes ONE formula correct
 * for both desktop and phone without a breakpoint.
 */
const CARD_COUNT = 7.3;
const GAP_PX = 10; // must match the rail's own `gap: 10` in both callers

export function useRailCardWidth() {
  const gaps = CARD_COUNT - 1;
  return `calc((100% - ${gaps * GAP_PX}px) / ${CARD_COUNT})`;
}

/**
 * 680px matches the app's own column width (see index.css) — the same line
 * everywhere else in this codebase treats as "phone vs desktop". Used for
 * layout/content decisions that are NOT card width: the two-column contact
 * list (desktop only), and avatar-only phone rail cards (below).
 */
const BREAKPOINT = 680;

function useIsNarrow() {
  const [narrow, setNarrow] = useState(
    typeof window !== 'undefined' ? window.innerWidth < BREAKPOINT : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${BREAKPOINT - 1}px)`);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return narrow;
}

export function useIsDesktop() {
  return !useIsNarrow();
}

/** Same signal, named for its actual use at the call site. */
export function useIsPhone() {
  return useIsNarrow();
}
