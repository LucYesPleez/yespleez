/**
 * THE VOICEY PILL — the microphone and its waveform panel as one control.
 *
 * ── WHAT REPLACED WHAT (M9s) ─────────────────────────────────────────
 *
 * This is the dock and the microphone merged. They used to be two elements
 * side by side: a round microphone you pressed and held, and a rounded-square
 * dock you dragged it into to lock. Two shapes, deliberately different, so they
 * would not both look pressable.
 *
 * They are now one pill, and the difference that mattered is gone with them.
 * The microphone does not need to be told apart from its destination, because
 * the destination is the other end of the thing it already sits in.
 *
 * ── WHY A TOGGLE IS A BUTTON AND THE DOCK WAS NOT ────────────────────
 *
 * `VoiceDock` was `role="img"`: pressing it did nothing, so a `<button>` would
 * have promised a click it could not honour — the padlock defect. The pill is
 * the opposite case. Pressing it is the ENTIRE interaction, so the whole pill
 * is one button and the microphone inside it is decoration that moves. That
 * also makes the target 66px wide instead of 36.
 *
 * ── POSITION IS THE STATE ────────────────────────────────────────────
 *
 * Left end means recording, right end means not. Nothing else encodes it, and
 * nothing else needs to: the control's own geometry is the readout. Colour
 * reinforces it, so the state survives being seen in monochrome or by someone
 * who cannot distinguish violet from cyan.
 */

/**
 * Every control in the composer row. The pill's height, and the mic's.
 *
 * ⚠ MUST MATCH `CONTROL` in Composer. The capsule sizes its other three slots
 * from that number, and a pill even a pixel taller would break the row's flush
 * top and bottom — which is the whole thing that makes the composer read as one
 * object rather than four adjacent ones.
 */
const SIZE = 36;

/**
 * How far the microphone travels.
 *
 * SHORT ON PURPOSE. Under the old model, distance decided the outcome, so it
 * had to be far enough to be deliberate — 34px of travel before a dock hit even
 * counted. A toggle has no threshold to defend: the press already proved
 * intent, and the slide only has to show which end you are at. Anything longer
 * makes starting a recording feel like it took effort.
 */
const TRAVEL = 30;

const WIDTH = SIZE + TRAVEL;

/**
 * Exported because the composer's collapsing slot has to animate to exactly
 * this width. A copied literal there would silently stop matching the moment
 * either SIZE or TRAVEL changed, leaving the slot a few pixels off with nothing
 * to point at.
 */
export const PILL_WIDTH = WIDTH;

/** Proportional to SIZE, so the glyph still fits if the row is ever resized. */
const BARS = [.42, .72, 1, .58, .86, .34];

/** The brand gradient, worn only while recording. */
const GRADIENT = 'linear-gradient(135deg, #00E5FF, #BF5FFF)';

/**
 * The resting face. Opaque, not a translucent white — the pill's panel behind
 * it is violet, and anything see-through would tint the "neutral" button the
 * exact colour it is meant not to be.
 */
const NEUTRAL_FACE = '#15151E';

/**
 * The resting border. Neutral, and the only thing separating the microphone
 * from its panel while idle.
 *
 * The gradient ring that used to be here made the microphone the brightest
 * object in a composer that is doing nothing — the same complaint as the solid
 * violet circle before it, one step quieter. The brand gradient now appears in
 * exactly two places: this button while it is actually recording, and Send.
 */
const NEUTRAL_BORDER = '1px solid rgba(255,255,255,.22)';

/**
 * `parked` — a note is waiting in the composer (phase `pending`).
 *
 * The button does NOT start a new recording in that state; under the owner's
 * strengthened constitutional rule (2026-07-25) it continues the parked one,
 * because a control that implicitly discarded it cost a real recording after a
 * real phone call. The label has to say so: "Record a voice message" while a
 * note is parked promises a fresh start and is exactly the misreading that
 * caused the loss. Visual state stays `recording`-driven — parked is not live,
 * and the still dot beside it already carries that.
 */
export default function VoicePill({ recording = false, parked = false, disabled = false, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={recording}
      aria-label={
        recording ? 'Stop recording'
        : parked  ? 'Continue recording'
        : 'Record a voice message'
      }
      className={`yp-pill${recording ? ' yp-pill-live' : ''}`}
      style={{ width: WIDTH, height: SIZE }}
    >
      {/* THE PANEL'S OWN GLYPH — not a live meter. It only has to READ as a
          waveform so the control is recognisable at a glance; the live audio is
          drawn across the text field, where there is room for it. */}
      <span
        className="yp-pill-bars"
        style={{
          left: 0,
          width: TRAVEL,
          // Follows the microphone into whichever end it vacated. SIZE, not
          // TRAVEL: the bars move by the microphone's width, not by its travel.
          transform: `translate3d(${recording ? SIZE : 0}px, 0, 0)`,
        }}
      >
        {BARS.map((h, i) => (
          <span
            key={i}
            style={{
              height: Math.round(SIZE * .44 * h),
              // Dim at rest: the glyph's job is to say what the panel IS, not to
              // compete with the microphone sitting next to it. It brightens
              // when there is actually audio to represent.
              background: recording ? '#7DE9FF' : 'rgba(192,132,252,.42)',
            }}
          />
        ))}
      </span>

      {/* THE MICROPHONE — neutral at rest, brand gradient while recording.

          Colour is reserved for the state that has something to say. A resting
          microphone is a button that is doing nothing, so it wears a plain
          border and gets out of the way; the gradient arriving IS the feedback
          that recording started. */}
      <span
        className="yp-pill-mic"
        style={{
          width: SIZE,
          height: SIZE,
          boxSizing: 'border-box',   // or the border would grow the circle
          transform: `translate3d(${recording ? 0 : TRAVEL}px, 0, 0)`,
          background: recording ? GRADIENT : NEUTRAL_FACE,
          border: recording ? '1px solid transparent' : NEUTRAL_BORDER,
          color: recording ? '#0a0a0f' : 'rgba(255,255,255,.92)',
          boxShadow: recording ? 'none' : '0 4px 14px -8px rgba(0,0,0,.9)',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="2" width="6" height="11" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v5" />
        </svg>
      </span>
    </button>
  );
}
