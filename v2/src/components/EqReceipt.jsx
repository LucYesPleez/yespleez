import { RECEIPT, litBars } from '../lib/receiptState';

/**
 * THE EQ RECEIPT — three bars that rise as a message travels.
 *
 *   ▁▁▁  waiting      ▃▁▁  sent      ▃▅▇  seen      ▁▁▁  failed (red)
 *
 * ── WHY AN EQUALISER AND NOT A TICK ──────────────────────────────────
 *
 * Ticks are WhatsApp's. This app is for DJs, bands, venues and festivals, and
 * an EQ bar already carries meaning here because of Voiceys — so the receipt
 * belongs to the scene rather than being borrowed from another messenger.
 *
 * ⚠ IT IS A PROGRESS INDICATOR SHAPED LIKE AN EQ, NOT AN AUDIO METER.
 *
 * That distinction is the whole risk. Anything that keeps moving next to a
 * voice note reads as recording or playback — this app has BOTH within a few
 * pixels of this mark. So each bar animates once, briefly, on arrival and then
 * stops dead. A resting receipt is completely static.
 *
 * Bars rise LEFT TO RIGHT and never fall, so the shape alone tells you how far
 * it got, at a glance and without colour. Colour is reinforcement, not the
 * signal — which also means it survives being seen by someone who cannot
 * separate violet from magenta.
 */

/** LIT heights as a fraction of the mark's height, shortest first. */
const STEPS = [0.44, 0.7, 1];

/**
 * The resting height of a bar that has not lit yet.
 *
 * ⚠ IT MUST BE SHORTER THAN STEPS[0], and that is not cosmetic. This started as
 * `STEPS[0]`, which meant the first bar was the same height lit or unlit — so
 * `sent` and `waiting` were identical in silhouette and told apart only by
 * colour. The whole point of an EQ ladder is that its SHAPE carries the state:
 *
 *   ▁▁▁  waiting      ▃▁▁  sent      ▃▅▇  seen
 *
 * Caught by measuring the rendered heights, not by looking — at 11px the
 * difference between "all three flat" and "one of them slightly less flat" is
 * invisible in a screenshot and obvious in the numbers.
 */
const REST = 0.26;

/** Unlit bars stay drawn. The ladder should show what has NOT happened yet. */
const DIM = 'rgba(255,255,255,.22)';

/**
 * Lit colours, brightening along the ladder.
 *
 * Cyan → violet → magenta, the same three stops the Voicey waveform runs
 * through, so the two marks read as the same family rather than as two
 * unrelated gradients that both happen to be brand-coloured.
 */
const LIT = ['#00E5FF', '#A855F7', '#FF4FD8'];

const FAILED = '#FF3B5C';

export default function EqReceipt({ state, size = 11 }) {
  if (!state) return null;

  const failed = state === RECEIPT.FAILED;
  const lit    = litBars(state);

  const label =
    failed ? 'Not sent'
    : state === RECEIPT.WAITING ? 'Sending'
    : state === RECEIPT.SEEN    ? 'Seen'
    : 'Sent';

  return (
    <span
      // The state is announced, never inferred from the drawing. A screen
      // reader gets the word; the bars are decoration to it.
      role="img"
      aria-label={label}
      title={label}
      className={`yp-eq${failed ? ' yp-eq-failed' : ''}`}
      style={{ height: size, gap: Math.max(1.5, size * 0.17) }}
    >
      {STEPS.map((step, i) => {
        const on = !failed && i < lit;
        return (
          <span
            key={i}
            style={{
              // Unlit bars sit at REST, well below even the first step, so an
              // unfinished ladder reads as flat and each rung visibly rises.
              height: `${(on ? step : REST) * 100}%`,
              width: Math.max(2, size * 0.2),
              background: failed ? FAILED : on ? LIT[i] : DIM,
              // Staggered so the bars arrive as a run rather than together —
              // 90ms apart is enough to read as a sweep and short enough that
              // the whole thing has settled within a third of a second.
              transitionDelay: `${i * 90}ms`,
            }}
          />
        );
      })}
    </span>
  );
}
