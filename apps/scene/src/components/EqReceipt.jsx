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
 * ── THE OPENING CASCADE IS A KEEPER, NOT A BUG ───────────────────────
 *
 * Opening a thread ripples the flourish down every read message in it, and the
 * owner wants that (2026-07-22). It is worth understanding WHY it happens,
 * because it looks like something that ought to be prevented.
 *
 * Receipts render before the watermarks are fetched, so every one mounts as
 * `sent` and flips to its true rung a moment later when the data lands. That
 * flip is a genuine state change, so the flourish fires — once, per message,
 * all at roughly the same instant.
 *
 * ⚠ IT THEREFORE DEPENDS ON THE FETCH LANDING AFTER FIRST PAINT. Cache the
 * watermarks, or resolve them before the thread renders, and the cascade
 * silently disappears — the receipts would simply mount correct, and mounting
 * correct never animates. If that ever happens and the effect is missed, this
 * is where it went.
 *
 * `prev` still starts as the current state, so a receipt that mounts already
 * settled paints silently. That guard is what keeps the flourish tied to
 * CHANGE rather than to existence — the cascade is a change arriving late, not
 * an animation on mount.
 */

/**
 * Bar heights, as fractions of the CYAN bar — the tallest.
 *
 * Owner's proportions: grey is half the cyan, pink two thirds. That puts the
 * peak in the middle, which is what stops it reading as a progress bar wearing
 * bars; a console silhouette is a shape, not a measurement. The PROGRESSION is
 * carried by how many bars are lit and by their colour.
 */
const HEIGHTS = [0.5, 1, 0.667];

/**
 * The resting height of a bar that has not lit yet.
 *
 * Must stay well below the shortest lit height. An earlier version rested them
 * at the first lit step, which made `sent` and `waiting` identical in
 * silhouette — the ladder became colour-only, and at 11px that is invisible.
 */
const REST = 0.22;

/** Unlit. Present, so the glyph always shows what has NOT happened yet. */
const DIM = 'rgba(255,255,255,.16)';

/**
 * ── RESTING COLOURS ARE DIMMED. THE FLOURISH IS NOT ──────────────────
 *
 * At full strength this mark was pulling the eye down the whole thread. It sits
 * beside every message you have ever sent, so it is the single most-repeated
 * element in the app — and a status glyph that competes with the message is
 * doing the opposite of its job.
 *
 * So the resting state runs at REST_ALPHA and the read flourish plays at full.
 * The moment something happens is allowed to be bright; the record of it having
 * happened is not.
 *
 * Alpha rather than darker hexes, so the same three colours stay recognisably
 * themselves and there is only one number to turn.
 */
const REST_ALPHA = 0.62;

const GREY = '156,163,175';   // #9CA3AF
const CYAN = '34,211,238';    // #22D3EE
const PINK = '236,72,153';    // #EC4899
const FAIL = '255,59,92';

const rgba = (c, a) => `rgba(${c},${a})`;

/**
 * The lit colours for each rung.
 *
 * Note `delivered` turns the FIRST bar cyan and `read` returns it to grey. That
 * is deliberate in the owner's spec: delivered is a moment of arrival, so both
 * live bars brighten together; read is the resolved end state, and there the
 * three bars settle into the grey → cyan → pink gradient that is the mark.
 */
function palette(state, alpha) {
  const g = rgba(GREY, alpha), c = rgba(CYAN, alpha), p = rgba(PINK, alpha);
  switch (state) {
    case RECEIPT.SENT:      return [g, DIM, DIM];
    case RECEIPT.DELIVERED: return [c, c,   DIM];
    case RECEIPT.SEEN:      return [g, c,   p];
    // Failure is the one state allowed to be loud at rest. It is the only rung
    // that asks the sender to DO something.
    case RECEIPT.FAILED:    return [rgba(FAIL, 1), rgba(FAIL, 1), rgba(FAIL, 1)];
    default:                return [DIM, DIM, DIM];
  }
}

/**
 * THE BARS BOUNCE OUT OF TIME WITH EACH OTHER.
 *
 * A left-to-right stagger reads as a progress sweep — the same gesture the
 * rungs already make, said twice. Giving each bar its own duration AND its own
 * offset makes them drift apart instead: they start together-ish, fall out of
 * phase, and land at different moments, which is what a console looks like when
 * three channels are moving independently.
 *
 * Deliberately not neat multiples. Durations that divide into each other would
 * re-synchronise every few cycles and the effect would collapse back into a
 * pulse. These share no common factor over three iterations.
 */
const BOUNCE = [
  { duration: 0.29, delay: 0.00 },
  { duration: 0.37, delay: 0.09 },
  { duration: 0.32, delay: 0.04 },
];

/**
 * Long enough for the SLOWEST bar to finish its three iterations.
 *
 * ⚠ MUST EXCEED max(delay + duration × 3), which is 0.09 + 1.11 = 1.20s. React
 * strips the class at this point, so a shorter value would guillotine the last
 * bar mid-bounce and leave it visibly snapping back.
 */
const PULSE_MS = 1300;

export default function EqReceipt({ state, size = 8 }) {
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
  // Full strength only while the flourish plays; dimmed the rest of the time.
  const colours = palette(state, pulsing ? 1 : REST_ALPHA);

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
              width: Math.max(1.75, size * 0.22),
              background: on || failed ? colours[i] : DIM,
              // The RUNG arriving still sweeps left to right — that reads as
              // progress, which is what it is.
              transitionDelay: `${i * 70}ms`,
              // The BOUNCE deliberately does not. Each bar keeps its own tempo
              // so the three drift apart instead of marching.
              animationDuration: `${BOUNCE[i].duration}s`,
              animationDelay: `${BOUNCE[i].delay}s`,
            }}
          />
        );
      })}
    </span>
  );
}
