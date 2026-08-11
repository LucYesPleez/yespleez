import { useEffect, useRef } from 'react';
import { alignRight, barHeight } from '../lib/liveWaveform';

/**
 * THE OVERSIZED VOICEY STAGE — a big target for the one thing you do most.
 *
 * ┌──────────────────────────────────────────┐  ← rises to about a quarter
 * │                                          │    of the screen
 * │                   🎙                     │
 * │                  ~~~~~                   │  ← the PRESSABLE area, and the
 * │                                          │    only pressable area
 * ├──────────────────────────────────────────┤  ← DEAD ZONE begins here
 * │  [x]   Message……………   [~~mic]   [hand]   │  ← the normal row, floating on top
 * └──────────────────────────────────────────┘
 *
 * ── IT SITS BEHIND THE ROW, IT DOES NOT REPLACE IT ───────────────────
 *
 * The composer keeps every control it has. The stage is a surface that rises
 * BEHIND them, so nothing moves, nothing unmounts, and the row you already know
 * floats on top of it exactly where it was. That is also why raising the stage
 * cannot break anything: no existing control changes meaning, position or size.
 *
 * ── ⚠⚠ THE DEAD ZONE IS THE WHOLE POINT ──────────────────────────────
 *
 * Owner's rule, and the reason this component has a hit area at all:
 *
 *   "I don't want someone to try to press the camera icon and accidentally
 *    switch on voicey recording."
 *
 * A big surface behind small controls is a trap — a near-miss on the camera or
 * the + would land on the surface instead, and the failure is the worst kind:
 * a microphone you did not ask for, running, while you think you opened a
 * photo picker. So the pressable region stops SAFE_GAP above the row and the
 * rest of the stage is inert decoration. The gap is deliberately generous;
 * losing a few pixels of target costs nothing, and the alternative costs trust.
 *
 * ⛔ Never extend the hit area to the full stage. If the stage ever needs to be
 * taller, the dead zone grows with it — not the button.
 */

/**
 * How far up the stage reaches, as a share of the viewport.
 *
 * Owner asked for "1/4 of the screen". `dvh`, not `vh`: on a phone the browser
 * chrome slides away as you scroll and `vh` keeps quoting the tall figure, so a
 * `vh`-sized panel sits wrong for the first moments after the address bar
 * moves. `dvh` tracks what is actually visible.
 */
export const STAGE_H = '25dvh';

/**
 * How much room the raised stage needs ABOVE the composer row.
 *
 * ⚠⚠ THE MESSAGE LIST MUST RESERVE THIS OR MESSAGES HIDE BEHIND THE PANEL.
 * The stage is `position: absolute`, so it takes no space in layout — it simply
 * covers whatever is under it, and the last few messages in a thread were
 * exactly what it covered. Reported as messages getting lost behind the button.
 *
 * The stage stands `composerHeight` of that on the row itself, so only the
 * remainder is new. `max(0px, …)` because on a very short screen a quarter of
 * the viewport can be less than the composer, and a negative padding would
 * silently pull the thread DOWN behind the bar instead.
 *
 * ⛔ Exported as a CSS expression, not a number: the height is `dvh`, which
 * only the browser can resolve, and it changes as mobile chrome slides away.
 * Converting it to pixels in JS would freeze it at whatever the viewport was
 * on mount.
 */
export const stageClearance = composerHeight =>
  `max(0px, calc(${STAGE_H} - ${composerHeight}px))`;

/**
 * The composer row's own height, which the stage stands on.
 *
 * The row is a 48px capsule in 8px of vertical padding. It is stated here as a
 * number because the stage has to know where its foot is to work out where the
 * pressable region must stop — CSS cannot read a parent's height, and the stage
 * is a child of that row.
 *
 * ⚠ If Composer's PAD or CONTROL change, this changes with them. The measured
 * check is `pressable.bottom` sitting clear of the camera's top — see the
 * dead-zone test.
 */
const ROW_H = 48 + 8 * 2;

/**
 * The inert strip between the pressable surface and the composer row.
 *
 * Sized to the row itself plus breathing room, so a thumb travelling to the
 * camera has somewhere harmless to land short. See the dead-zone note above.
 */
const SAFE_GAP = 18;

/**
 * The stage's horizontal edge. POSITIVE insets it, NEGATIVE runs it off-screen.
 *
 * ⭐ SETTLED ON THE INSET, AFTER TRYING THE BLEED TWICE. The sequence is worth
 * keeping, because the middle steps look like abandoned directions and were
 * not: it hung 40px off each side, came in to judge the gradient border
 * against a closed shape, went back out to 40 ("too far"), then to 10 ("only
 * just offscreen"), and finally back in. The bleed was how the border got
 * chosen; the border is why the bleed lost.
 *
 * ⭐ THE REASON IT LOST: a gradient outline that runs off the screen stops
 * reading as an outline and starts reading as a stripe. Once the panel had one,
 * the shape had to close for the edge to mean anything.
 *
 * 12 matches the composer form's own horizontal padding, so the stage lines up
 * with the capsule sitting on it rather than to an independent margin.
 */
const INSET = 12;

/**
 * The corner rounding. A softened rectangle — not a lozenge, but nowhere near
 * square either.
 *
 * ⚠ AN EXPLICIT NUMBER, NEVER 999. Every corner gets clamped together the
 * moment one side's radii exceed its length, so a "just make it round" value
 * silently resolves to half the height and takes the shape somewhere nobody
 * chose. Stating it keeps this exactly where it was set.
 *
 * ⚠ THE CEILING IS HALF THE HEIGHT (~101 at 25dvh on a 812px screen). Past
 * that the sides go fully semicircular and the panel becomes the lozenge it
 * was before. 76 is close to it — deliberately — so the corners are very soft
 * and only a short straight run survives along the top and sides. ⚠ On a
 * SHORTER screen the ceiling drops with the height, and the browser will clamp
 * this silently rather than complain; if the shape ever looks unexpectedly
 * pill-like on a small phone, that is what happened.
 */
const RADIUS = 76;

/**
 * The gradient border's thickness.
 *
 * ⚠ IT IS DRAWN AS A BACKGROUND, NOT A BORDER. CSS cannot put a gradient on a
 * `border` and keep `border-radius` — `border-image` ignores the radius and
 * squares the corners off. The technique in the stylesheet is two backgrounds,
 * one clipped to the padding box (the fill) and one to the border box (the
 * gradient), with a transparent border of this width revealing the second.
 */
const BORDER = 3;

/**
 * How far the stage's foot extends BELOW the composer row it stands on.
 *
 * ⚠⚠ THE HEIGHT GROWS BY EXACTLY THIS, SO THE TOP EDGE DOES NOT MOVE. That is
 * the whole requirement — "keep the top there but bring the bottom down". Drop
 * the foot without growing the height and the panel simply slides downward,
 * taking the approved top with it.
 *
 * ⚠ AND THE DEAD ZONE MOVES WITH IT. The pressable area's offset is measured
 * up from the foot, so lowering the foot silently steals exactly this many
 * pixels from the gap protecting the camera. It is compensated below; that
 * compensation is not optional.
 */
const BOTTOM_DROP = 15;

/**
 * THE RESTING WAVEFORM — a glyph, and ⚠ NOT A METER.
 *
 * ⭐ EXACTLY THE PRECEDENT VoicePill SET, at a larger size: its panel carries a
 * still bar glyph whose job is to say what the control IS, and it hands over to
 * the real meter the moment there is audio. Dim, and fixed heights — the same
 * shape every time.
 *
 * ⛔ It must never animate. A moving waveform with no microphone open looks
 * identical to one that is listening, which is the single question a person
 * recording actually wants answered, and faking it is the one thing
 * `LiveWaveform`'s own header forbids.
 */
const BARS = [.30, .55, .80, 1, .72, .46, .84, .58, .34];

/** ~17 samples a second — the rate LiveWaveform settled on. */
const SAMPLE_MS = 58;

/** The row's height in px, and the ceiling a shout reaches. */
const WAVE_H = 34;

/**
 * THE STAGE'S WAVEFORM — the resting glyph and the live meter as ONE row.
 *
 * ⚠⚠ IT IS NOT `LiveWaveform`, AND THAT IS THE POINT. That component is tuned
 * for the composer's narrow field: 42 bars at 2px. Dropped into a panel this
 * wide it drew a thin grey smear that looked nothing like the chunky resting
 * glyph beside it, so starting a recording visibly SWAPPED one waveform for a
 * different one. Here the same nine bars stay put and start moving.
 *
 * ⭐ WRITTEN STRAIGHT TO THE DOM, like both other waveforms in the app.
 * Seventeen React renders a second would re-render the composer, the stage and
 * every control on it, ~17 times a second, for the whole recording.
 *
 * ⛔ AT REST IT MUST NOT MOVE. Fixed heights, no animation, no transition. A
 * waveform that animates with no microphone open looks identical to one that
 * is listening — which is the single question a person recording needs
 * answered, and the reason `LiveWaveform`'s own header forbids faking it.
 */
function StageWave({ getLevel, recording }) {
  const barsRef = useRef([]);

  useEffect(() => {
    const nodes = barsRef.current;
    if (!recording || typeof getLevel !== 'function') {
      // Back to the resting glyph — and back to the SAME heights every time,
      // so lowering the mic does not leave the bars frozen mid-shout.
      nodes.forEach((n, i) => { if (n) n.style.height = `${Math.round(BARS[i] * WAVE_H)}px`; });
      return undefined;
    }

    const history = [];
    const id = setInterval(() => {
      const level = Math.max(0, Math.min(1, getLevel() || 0));
      history.push(level);
      if (history.length > BARS.length) history.shift();
      // Newest on the RIGHT, everything older shifting left — the same
      // direction of travel the composer's meter and the stored waveform use,
      // so "now" is always the same edge wherever you see audio in this app.
      const values = alignRight(history, nodes.length);
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node) continue;
        const v = values[i];
        node.style.height = v === undefined ? '2px' : `${barHeight(v, WAVE_H, 0.6)}px`;
      }
    }, SAMPLE_MS);

    return () => clearInterval(id);
  }, [getLevel, recording]);

  return (
    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, height: WAVE_H }}>
      {BARS.map((h, i) => (
        <span
          key={i}
          ref={el => { barsRef.current[i] = el; }}
          style={{
            width: 4,
            height: Math.round(h * WAVE_H),
            borderRadius: 999,
            background: recording ? '#BF5FFF' : 'rgba(191,95,255,.55)',
          }}
        />
      ))}
    </span>
  );
}

export default function VoiceyStage({ raised, recording, parked, disabled, getLevel, onToggle }) {
  return (
    <div
      aria-hidden={!raised}
      className={`yp-voicey-stage${raised ? ' yp-voicey-stage-up' : ''}`}
      style={{
        // Anchored to the composer form (which is `position: relative`) and
        // grown UPWARD. `bottom: 0` keeps its foot on the row so the two read
        // as one object rather than a floating panel with a gap under it.
        position: 'absolute', left: INSET, right: INSET, bottom: -BOTTOM_DROP,
        // A quarter of the screen INCLUDING the row it stands on, which is what
        // "comes up a quarter of the screen" describes from the outside — plus
        // the foot's drop, so the TOP EDGE HOLDS STILL while the bottom moves.
        height: `calc(${STAGE_H} + ${BOTTOM_DROP}px)`,
        // Inline rather than in the stylesheet because INSET, RADIUS and BORDER
        // are one set — they have to be read and tuned together.
        borderRadius: RADIUS,
        // ⚠ THE GRADIENT OUTLINE. A transparent border of this width reveals
        // the border-box background beneath it; the stylesheet supplies both
        // layers. Set here so the width and the radius stay adjacent.
        border: `${BORDER}px solid transparent`,
        // ⚠ BEHIND the row's controls, which carry no z-index of their own and
        // would otherwise be painted under this in DOM order.
        zIndex: 0,
        // The decoration must never eat a tap. Only the button below opts back
        // in, which is what confines every press to the safe region.
        pointerEvents: 'none',
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        aria-pressed={recording}
        aria-label={
          recording ? 'Stop recording'
          : parked  ? 'Continue recording'
          : 'Record a voice message'
        }
        className="yp-voicey-stage-face"
        style={{
          position: 'absolute', left: 0, right: 0, top: 0,
          // ⚠ STOPS SHORT OF THE ROW. `bottom` is the row's own height plus the
          // gap, so the button never reaches the camera, the + or the field.
          // ⚠ `+ BOTTOM_DROP` because this offset is measured UP FROM THE FOOT,
          // and the foot now sits below the row. Without it the dead zone
          // shrinks by exactly the drop and the button creeps toward the camera
          // — the one thing this must never do.
          bottom: ROW_H + SAFE_GAP + BOTTOM_DROP,
          pointerEvents: raised ? 'auto' : 'none',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14,
        }}
      >
        {/* ⛔ NO CIRCLE. The glyph alone — see the stylesheet for why the ring
            went. Larger than it was (48, up from 38) because losing the ring
            lost the mass that made it read as a target from across the room. */}
        <span className="yp-voicey-stage-mic">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2" width="6" height="11" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v5" />
          </svg>
        </span>

        {/* One row in both states — see StageWave. It does not swap components
            when recording starts; the bars it already drew begin to move. */}
        <span className="yp-voicey-stage-wave" aria-hidden="true">
          <StageWave getLevel={getLevel} recording={recording} />
        </span>
      </button>
    </div>
  );
}
