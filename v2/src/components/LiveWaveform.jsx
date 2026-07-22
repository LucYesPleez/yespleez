import { useEffect, useRef } from 'react';
import { barHeight, barCapacity } from '../lib/liveWaveform';

/**
 * THE LIVE RECORDING WAVEFORM — a strip that scrolls, not a row that updates.
 *
 * Samples real loudness from the recorder while recording runs, so what you see
 * is what the microphone is hearing. A decorative animation here would be worse
 * than nothing: it would look identical whether or not the microphone was
 * picking anything up, which is exactly the question someone recording wants
 * answered.
 *
 * ── IT NEVER COMPRESSES, AND IT NEVER DID ────────────────────────────
 *
 * Worth stating because it looked like it. The meter has always held a fixed
 * number of bars and dropped the oldest sample once full, so density was
 * constant and bar width never shrank however long the recording ran.
 *
 * What it did wrong was STEP. Every 58ms each bar's value hopped one position
 * left while the bars themselves stayed put — a shift register, not a moving
 * strip. Nothing moved; the picture was redrawn. That reads as marching, and no
 * amount of easing on the heights fixes it, because the thing that should be
 * moving is the strip.
 *
 * ── SO THE STRIP TRANSLATES ──────────────────────────────────────────
 *
 * Each tick: recycle the leftmost bar element to the end of the row and give it
 * the new sample. Moving it shifts the whole row left by exactly one pitch
 * instantly, so the transform is set to +pitch with NO transition to cancel that
 * — then, after a forced reflow, animated back to 0. The result is one
 * continuous leftward slide with no reset, because the element that leaves is
 * always the one being reused.
 *
 * ⚠ THE REFLOW BETWEEN THE TWO WRITES IS LOAD-BEARING. Without reading a layout
 * property in between, the browser coalesces both transform assignments and only
 * the last is ever seen — the strip would jump, which is precisely the artefact
 * this exists to remove.
 *
 * `transform` only, never `left` or a width: it composites on the GPU and costs
 * no layout. Seventeen samples a second through React would re-render the whole
 * composer, so bars are written directly, the same technique the playback
 * waveform uses.
 */

/** Bar width and the gap after it. PITCH is the distance the strip travels per sample. */
const BAR_W = 3;
const BAR_GAP = 2;
const PITCH = BAR_W + BAR_GAP;

/** ~17 samples a second. Faster looks frantic; slower stops feeling live. */
const SAMPLE_MS = 58;

/**
 * 22 → 34. The meter was legible in principle and invisible in practice.
 *
 * Vertical only, so it is safe inline: the composer's capsule has no fixed
 * height and its controls are already 44–46px, so the taller row costs no
 * layout. The horizontal dimension is the one that must stay in the stylesheet.
 */
const HEIGHT = 34;

/**
 * ⚠ THE METER IS PERCEPTUAL, NOT LINEAR — and this is why it was invisible.
 *
 * `level()` is RMS already multiplied by 2.2 at the source, but speech RMS sits
 * around .1 to .25, so a normal speaking voice arrived here as .22 to .55. On
 * the old 22px row that drew bars 5 to 12 pixels tall: present, technically
 * correct, and reported as "barely shows" on a real handset.
 *
 * The whole top half of the meter was reserved for shouting. A power curve
 * spends the height where voices actually live — .22 becomes .41, .55 becomes
 * .69 — while a shout still reaches the top, because 1 maps to 1 whatever the
 * exponent.
 *
 * ⚠ RAISING THE SOURCE GAIN INSTEAD WOULD BE WRONG. `level()` also has to stay
 * honest about loudness, and multiplying it further would clip every ordinary
 * voice to a flat maximum — the meter would stop responding at exactly the
 * point it is meant to be most informative. The curve is a DISPLAY decision and
 * belongs on the display side.
 */
const CURVE = 0.6;

export default function LiveWaveform({ getLevel }) {
  const viewportRef = useRef(null);
  const stripRef = useRef(null);

  useEffect(() => {
    if (typeof getLevel !== 'function') return undefined;

    const viewport = viewportRef.current;
    const strip = stripRef.current;
    if (!viewport || !strip) return undefined;

    // Honour the preference rather than easing more gently. Someone who has
    // asked for less motion should get a meter that updates without travelling,
    // which is still a truthful meter — the levels are the information, the
    // sliding is the polish.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    let bars = [];

    const build = () => {
      const count = barCapacity(viewport.clientWidth, PITCH);
      if (count === bars.length) return;
      strip.replaceChildren();
      bars = Array.from({ length: count }, () => {
        const b = document.createElement('span');
        b.className = 'yp-live-bar';
        b.style.height = '0px';
        strip.append(b);
        return b;
      });
    };

    build();
    // The composer's field changes width as the pill collapses in and out, so
    // the strip has to be able to gain and lose bars mid-recording.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(build) : null;
    ro?.observe(viewport);

    const id = setInterval(() => {
      if (!bars.length) return;
      const level = Math.max(0, Math.min(1, getLevel() || 0));

      // Recycle: the oldest bar becomes the newest. `append` MOVES the node, so
      // the row shifts left by one pitch in the same operation that supplies the
      // new sample — no element is created or destroyed while recording.
      const bar = bars.shift();
      bars.push(bar);
      strip.append(bar);
      bar.style.height = `${barHeight(level, HEIGHT, CURVE)}px`;

      if (still) return;

      // Cancel the instant shift the move just caused...
      strip.style.transition = 'none';
      strip.style.transform = `translate3d(${PITCH}px,0,0)`;
      // ...force the browser to accept that as a state of its own...
      void strip.offsetWidth;
      // ...then travel back to rest over exactly one sample, so the strip is
      // always moving and never waiting.
      strip.style.transition = `transform ${SAMPLE_MS}ms linear`;
      strip.style.transform = 'translate3d(0,0,0)';
    }, SAMPLE_MS);

    return () => {
      clearInterval(id);
      ro?.disconnect();
    };
  }, [getLevel]);

  return (
    <div
      ref={viewportRef}
      className="yp-live-wave"
      aria-hidden="true"
      style={{ flex: 1, minWidth: 0, height: HEIGHT }}
    >
      <div
        ref={stripRef}
        className="yp-live-strip"
        style={{ gap: BAR_GAP, height: HEIGHT }}
      />
    </div>
  );
}
