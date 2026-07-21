import { forwardRef } from 'react';

/**
 * THE DOCK — a permanent control, and the target of the record gesture.
 *
 * It is on screen before anything happens, which is the whole point: you cannot
 * drag something into a place that only appears once you have started dragging.
 * A destination that exists in advance is what makes the gesture guessable
 * without a tutorial.
 *
 * ── WHY IT IS NOT A BUTTON ───────────────────────────────────────────
 *
 * Nothing happens when you press it. It is a place, not an action — a `<button>`
 * would promise a click that does nothing, which is the padlock defect again.
 * `role="img"` with a label means a screen reader announces what it is without
 * inviting a press it cannot honour.
 *
 * Once recording locks it stops being a target and becomes the indicator: the
 * bars animate, and the composer's left side carries the live waveform.
 */
const VoiceDock = forwardRef(function VoiceDock({ size = 46, active = false, locking = false }, ref) {
  return (
    <span
      ref={ref}
      className={`yp-dock${locking ? ' yp-dock-lock' : ''}`}
      role="img"
      aria-label={active ? 'Recording' : 'Drag the microphone here to lock recording'}
      style={{
        // THE SAME SIZE AND SHAPE AS THE MICROPHONE, deliberately. They are a
        // pair — one you press, one you drag onto — and a smaller dock read as
        // an indicator sitting beside a control rather than as its counterpart.
        // Matching them makes the relationship the geometry's job instead of
        // something the interface has to explain.
        width: size, height: size, flexShrink: 0, borderRadius: 999,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2.5,
      }}
    >
      {/* A static glyph, not a live meter. The live audio is drawn across the
          text field where there is room for it; here it only has to READ as a
          waveform so the control is recognisable at a glance.

          Heights are proportional to the button, so the pair still matches if
          either is ever resized. */}
      {[.42, .72, 1, .58, .86, .34].map((h, i) => (
        <span
          key={i}
          style={{
            width: Math.max(2, size * .058),
            height: Math.round(size * .44 * h),
            borderRadius: 999,
            background: active ? '#E9D5FF' : 'rgba(233,213,255,.82)',
          }}
        />
      ))}
    </span>
  );
});

export default VoiceDock;
