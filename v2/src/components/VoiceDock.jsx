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
const VoiceDock = forwardRef(function VoiceDock({ size = 40, active = false, locking = false }, ref) {
  return (
    <span
      ref={ref}
      className={`yp-dock${locking ? ' yp-dock-lock' : ''}`}
      role="img"
      aria-label={active ? 'Recording' : 'Drag the microphone here to lock recording'}
      style={{
        width: size, height: size, flexShrink: 0, borderRadius: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
      }}
    >
      {/* A static glyph, not a live meter. The live audio is drawn across the
          text field where there is room for it; here it only has to READ as a
          waveform so the control is recognisable at a glance. */}
      {[.42, .72, 1, .58, .86, .34].map((h, i) => (
        <span
          key={i}
          style={{
            width: 2.5,
            height: Math.round(18 * h),
            borderRadius: 999,
            background: active ? '#E9D5FF' : 'rgba(233,213,255,.82)',
          }}
        />
      ))}
    </span>
  );
});

export default VoiceDock;
