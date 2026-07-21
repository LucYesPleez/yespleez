import { useEffect, useRef } from 'react';

/**
 * THE LIVE RECORDING WAVEFORM, filling the composer's field left to right.
 *
 * Samples real loudness from the recorder while a locked recording runs, so what
 * you see is what the microphone is hearing. A decorative animation here would
 * be worse than nothing: it would look identical whether or not the microphone
 * was actually picking anything up, which is exactly the question someone
 * recording wants answered.
 *
 * ── IT GROWS, THEN IT SCROLLS ────────────────────────────────────────
 *
 * Bars accumulate from the left until the row is full, then the oldest falls off
 * — so a short recording reads as progress and a long one as a moving window.
 * Starting full and scrolling immediately would make the first second look the
 * same as the fiftieth.
 *
 * ── WRITTEN TO THE DOM, NOT THROUGH STATE ────────────────────────────
 *
 * Seventeen samples a second through React would re-render the whole composer —
 * including the microphone the user is currently dragging. The bars are written
 * directly, the same technique the playback waveform uses, so recording costs
 * the composer nothing.
 */

/** Bars across the field. Enough to read as audio, few enough to stay legible. */
const BAR_COUNT = 42;

/** ~17 samples a second. Faster looks frantic; slower stops feeling live. */
const SAMPLE_MS = 58;

const HEIGHT = 22;

export default function LiveWaveform({ getLevel }) {
  const rowRef = useRef(null);
  const barsRef = useRef([]);
  const historyRef = useRef([]);

  useEffect(() => {
    if (typeof getLevel !== 'function') return undefined;

    historyRef.current = [];
    const id = setInterval(() => {
      const level = Math.max(0, Math.min(1, getLevel() || 0));
      const history = historyRef.current;
      history.push(level);
      if (history.length > BAR_COUNT) history.shift();

      const nodes = barsRef.current;
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node) continue;
        const v = history[i];
        if (v === undefined) {
          // Not yet reached — nothing drawn, so the row fills rather than
          // starting as a flat line pretending to be silence.
          node.style.height = '0px';
          node.style.opacity = '0';
        } else {
          // Floor at 2px so a quiet moment still reads as a bar rather than a
          // gap, matching how the stored waveform treats silence.
          node.style.height = `${Math.max(2, v * HEIGHT)}px`;
          node.style.opacity = '1';
        }
      }
    }, SAMPLE_MS);

    return () => clearInterval(id);
  }, [getLevel]);

  return (
    <div
      ref={rowRef}
      className="yp-live-wave"
      aria-hidden="true"
      style={{
        flex: 1, minWidth: 0, height: HEIGHT,
        display: 'flex', alignItems: 'center', gap: 2,
      }}
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span
          key={i}
          ref={el => { barsRef.current[i] = el; }}
          style={{
            flex: 1,
            height: 0,
            opacity: 0,
            borderRadius: 999,
            background: 'linear-gradient(180deg, #D8B4FE 0%, #A855F7 100%)',
            transition: 'height .06s linear',
          }}
        />
      ))}
    </div>
  );
}
