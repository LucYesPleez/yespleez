import { useEffect, useRef } from 'react';
import { alignRight } from '../lib/liveWaveform';

/**
 * THE LIVE RECORDING WAVEFORM, rolling right to left across the composer's field.
 *
 * Samples real loudness from the recorder while recording runs, so what you see
 * is what the microphone is hearing. A decorative animation here would be worse
 * than nothing: it would look identical whether or not the microphone was
 * actually picking anything up, which is exactly the question someone recording
 * wants answered.
 *
 * ── IT ENTERS AT THE RIGHT AND TRAVELS LEFT ──────────────────────────
 *
 * The newest sample is always the RIGHTMOST bar, hard against the edge nearest
 * the microphone, and every older one shifts left to make room. The field fills
 * from the right and empties off the left.
 *
 * It used to accumulate from the left instead, which put NOW at a point that
 * wandered rightward for the first two and a half seconds and then stopped
 * moving. Anchoring the newest sample means the live edge is in the same place
 * at 0:01 as at 5:00, so what the microphone is hearing this instant is always
 * in one spot rather than somewhere that depends on how long you have been
 * talking.
 *
 * ── WRITTEN TO THE DOM, NOT THROUGH STATE ────────────────────────────
 *
 * Seventeen samples a second through React would re-render the whole composer.
 * The bars are written directly, the same technique the playback waveform uses,
 * so recording costs the composer nothing.
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
      const values = alignRight(history, nodes.length);

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node) continue;
        const v = values[i];
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
