import { useState, useRef, useEffect } from 'react';
import { signedUrlFor, formatDuration } from '../lib/voiceNotes';
import { isRenderablePeaks, PEAK_MAX } from '../lib/voicePeaks';

/**
 * THE `voice` RENDERER — the inside of a bubble, and nothing else.
 *
 * `MessageBubble` is untouched by this file. It owns alignment, the tail, burst
 * grouping and tap-to-reveal, identically for every kind; this owns a play
 * button, a duration and a progress bar. The registry is what joins them.
 *
 * ── THE URL IS FETCHED ON PLAY, NOT ON RENDER ────────────────────────
 *
 * A thread of thirty voice notes would otherwise mint thirty signed urls on
 * scroll — thirty storage round-trips for audio nobody has asked to hear, and
 * thirty credentials handed out to satisfy a render. So the url is requested
 * on the first press and then kept for the life of the component.
 *
 * That also puts the failure where it belongs. A signed url can fail because
 * you are no longer a participant, and discovering that silently at render
 * time would just show a dead button; discovering it on press shows a reason
 * next to the thing you pressed.
 *
 * ── DURATION COMES FROM THE PAYLOAD, THEN FROM THE AUDIO ─────────────
 *
 * `payload.duration_ms` is written at record time so the bubble can show a
 * length before anything is downloaded. Once the element has metadata its own
 * duration wins — it is the truth about the file, and the recorded value is a
 * measurement of wall-clock time that a paused or throttled tab can overstate.
 */
export default function VoiceMessage({ message }) {
  const path       = message?.payload?.path ?? null;
  const storedMs   = Number(message?.payload?.duration_ms ?? 0);
  const peaks      = message?.payload?.peaks ?? null;

  const audioRef   = useRef(null);
  const [url,      setUrl]      = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [playing,  setPlaying]  = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(storedMs / 1000);

  // Pause on unmount. Closing a drawer mid-playback must stop the audio — an
  // element that outlives its bubble keeps playing with nothing on screen to
  // stop it.
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  async function ensureUrl() {
    if (url) return url;
    setLoading(true);
    setError(null);
    const { url: signed, error: signError } = await signedUrlFor(path);
    setLoading(false);
    if (signError || !signed) {
      // RLS is what refuses here, so this is a real possibility rather than a
      // defensive branch: a participant removed from the conversation still
      // has the message rendered from local state.
      setError('Cannot play this right now');
      return null;
    }
    setUrl(signed);
    return signed;
  }

  async function toggle(e) {
    // The bubble is itself a button (tap-to-reveal the timestamp). Without
    // this, pressing play would also toggle the time.
    e.stopPropagation();

    if (playing) {
      audioRef.current?.pause();
      return;
    }
    const src = await ensureUrl();
    if (!src) return;

    const el = audioRef.current;
    if (!el) return;
    if (el.src !== src) el.src = src;
    try {
      await el.play();
    } catch {
      // Autoplay policy, a decode failure, or an expired url. All present the
      // same way to the person pressing the button.
      setError('Cannot play this right now');
    }
  }

  if (!path) {
    // A voice message whose payload lost its path. body is still legible —
    // M9a guarantees it — so show that rather than an empty bubble.
    return (
      <div style={{ color: 'var(--muted)', fontSize: 13, fontStyle: 'italic' }}>
        {message?.body || 'Voice message'} — unavailable
      </div>
    );
  }

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  // Deliberately NOT branched on which side sent it. The registry calls
  // renderers as `renderer(message)`, and widening that signature would mean
  // editing MessageBubble — which has to stay generic across every kind. A
  // near-white tint reads on both the sent gradient and the received .085
  // fill, so the branch would buy nothing worth that coupling.
  const tint  = 'rgba(255,255,255,.92)';
  const track = 'rgba(255,255,255,.22)';

  return (
    // 168 → 244, and the gap opened up with it. A player that sizes itself to
    // the smallest thing it can contain reads as a control someone dropped into
    // a message; a consistent, deliberate footprint reads as a component. The
    // container's own padding and min-height (KIND_SHAPE.voice) do the rest.
    <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 244 }}>
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        style={{
          width: 32, height: 32, flexShrink: 0, borderRadius: 999,
          border: '1px solid rgba(255,255,255,.28)',
          background: 'rgba(255,255,255,.10)',
          color: tint, cursor: loading ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, lineHeight: 1, padding: 0,
        }}
      >
        {loading ? '…' : playing ? '❚❚' : '▶'}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* §6.4 — drawn from peaks stored at record time. Nothing is decoded
            and no audio is fetched to render this.

            Notes recorded before M9f have no peaks and never will (they cannot
            be retrofitted without re-downloading every one), so the plain bar
            is a permanent state rather than a loading one. */}
        {isRenderablePeaks(peaks) ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 1.5, height: 22 }} aria-hidden="true">
            {peaks.map((p, i) => (
              <span
                key={i}
                style={{
                  flex: 1,
                  // Floor at 2px: a near-silent bucket must still read as a bar,
                  // or a pause in speech looks like a gap in the file.
                  height: Math.max(2, (p / PEAK_MAX) * 22),
                  borderRadius: 999,
                  background: (i / peaks.length) <= progress ? tint : track,
                  transition: 'background .12s linear',
                }}
              />
            ))}
          </div>
        ) : (
          <div style={{ height: 3, borderRadius: 999, background: track, overflow: 'hidden' }}>
            <div style={{ width: `${progress * 100}%`, height: '100%', background: tint, borderRadius: 999 }} />
          </div>
        )}
        <div style={{ marginTop: 5, fontSize: 11, color: 'rgba(255,255,255,.62)' }}>
          {error ?? formatDuration(playing || position > 0 ? position : duration)}
        </div>
      </div>

      {/* preload="none" so a thread of voice notes downloads nothing until
          asked. The src is set on first play, not here. */}
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPosition(0); }}
        onTimeUpdate={e => setPosition(e.currentTarget.currentTime)}
        onLoadedMetadata={e => {
          // The file's own duration beats the recorded one. See header.
          const real = e.currentTarget.duration;
          if (Number.isFinite(real) && real > 0) setDuration(real);
        }}
        onError={() => setError('Cannot play this right now')}
      />
    </div>
  );
}
