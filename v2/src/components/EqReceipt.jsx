import { useEffect, useRef, useState } from 'react';
import { RECEIPT, litBars } from '../lib/receiptState';

/**
 * THE STATUS GLYPH — YesPleez's answer to the double tick.
 *
 *   ▇▁▁  sent        ▇▇▁  delivered      ▇▇▇  read
 *   grey             cyan  cyan           grey · cyan · pink
 *
 * ── A GLYPH THAT BORROWS FROM AUDIO, NOT AN AUDIO METER ──────────────
 *
 * The distinction is the entire design, and getting it wrong is the one way
 * this fails. A miniature VU meter next to a voice note reads as playback —
 * and this app puts those within a few pixels of each other. So:
 *
 *   · bars are EQUAL WIDTH with fixed, deliberately uneven heights, which
 *     evokes a console without imitating a signal;
 *   · nothing moves except when the state actually CHANGES;
 *   · the read animation runs a fixed number of times and stops dead.
 *
 * There is no looping animation anywhere in this component or its CSS. That is
 * a constraint, not an omission.
 *
 * ── ANIMATION FIRES ON TRANSITION, NEVER ON MOUNT ────────────────────
 *
 * ⚠ THE SUBTLE ONE. Opening a thread mounts a receipt for every message in it,
 * all of them long since read. Animating on mount would set the whole history
 * oscillating at once every time you opened a conversation — which is both
 * absurd and exactly the "live meter" impression the design forbids.
 *
 * So the first render of any receipt paints its final state silently, and only
 * a change AFTER that animates. `prev` starting as the current state is what
 * encodes that.
 */

/**
 * Bar heights, tallest first.
 *
 * Uneven on purpose — an even ramp reads as a progress bar wearing bars, and a
 * console silhouette is what makes this recognisable at a glance. The
 * PROGRESSION is carried by how many bars are lit and by their colour, not by
 * the outline, so the shape is free to be a mark rather than a measurement.
 */
const HEIGHTS = [1, 0.64, 0.84];

/**
 * The resting height of a bar that has not lit yet.
 *
 * Must stay well below the shortest lit height. An earlier version rested them
 * at the first lit step, which made `sent` and `waiting` identical in
 * silhouette — the ladder became colour-only, and at 11px that is invisible.
 */
const REST = 0.26;

/** Unlit. Present, so the glyph always shows what has NOT happened yet. */
const DIM = 'rgba(255,255,255,.20)';

const GREY = '#9CA3AF';
const CYAN = '#22D3EE';
const PINK = '#EC4899';
const FAIL = '#FF3B5C';

/**
 * The lit colours for each rung.
 *
 * Note `delivered` turns the FIRST bar cyan and `read` returns it to grey. That
 * is deliberate in the owner's spec: delivered is a moment of arrival, so both
 * live bars brighten together; read is the resolved end state, and there the
 * three bars settle into the grey → cyan → pink gradient that is the mark.
 */
const PALETTE = {
  [RECEIPT.SENT]:      [GREY, DIM,  DIM],
  [RECEIPT.DELIVERED]: [CYAN, CYAN, DIM],
  [RECEIPT.SEEN]:      [GREY, CYAN, PINK],
  [RECEIPT.WAITING]:   [DIM,  DIM,  DIM],
  [RECEIPT.FAILED]:    [FAIL, FAIL, FAIL],
};

/** Matches the CSS: 3 oscillations at .3s. Cleared after, so it cannot repeat. */
const PULSE_MS = 900;

export default function EqReceipt({ state, size = 12 }) {
  const prev = useRef(state);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    const changed = prev.current !== state;
    prev.current = state;
    // Only READ gets the flourish. Sent and delivered are a bar rising into
    // place — a whole-glyph animation on every hop would make an ordinary
    // exchange feel busy, and this mark repeats down the entire thread.
    if (!changed || state !== RECEIPT.SEEN) return undefined;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), PULSE_MS);
    return () => clearTimeout(t);
  }, [state]);

  if (!state) return null;

  const lit    = litBars(state);
  const failed = state === RECEIPT.FAILED;
  const colours = PALETTE[state] ?? PALETTE[RECEIPT.WAITING];

  const label =
    failed ? 'Not sent'
    : state === RECEIPT.WAITING   ? 'Sending'
    : state === RECEIPT.DELIVERED ? 'Delivered'
    : state === RECEIPT.SEEN      ? 'Read'
    : 'Sent';

  return (
    <span
      // The word is announced; the bars are decoration to a screen reader.
      role="img"
      aria-label={label}
      title={label}
      className={`yp-eq${pulsing ? ' yp-eq-pulse' : ''}`}
      style={{ height: size, gap: Math.max(1.5, size * 0.16) }}
    >
      {HEIGHTS.map((h, i) => {
        const on = !failed && i < lit;
        return (
          <span
            key={i}
            style={{
              height: `${(on || failed ? h : REST) * 100}%`,
              width: Math.max(2, size * 0.18),
              background: on || failed ? colours[i] : DIM,
              // Staggered so a rung arrives as a sweep rather than a snap.
              transitionDelay: `${i * 70}ms`,
              animationDelay: `${i * 60}ms`,
            }}
          />
        );
      })}
    </span>
  );
}
