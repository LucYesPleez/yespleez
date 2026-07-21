import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { signedUrlFor, formatDuration } from '../lib/voiceNotes';
import { toDisplayPeaks } from '../lib/voicePeaks';
import { timeOf } from '../lib/clock';
import { claimPlayback, releasePlayback } from '../lib/voicePlayback';

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
/** Taller than the old 22, so the peaks have somewhere to go. */
const WAVE_HEIGHT = 27;

/**
 * PLAYED and REMAINING, interpolated per bar.
 *
 * Played is the brand purple at full strength; remaining is a muted white that
 * sits back without disappearing. Kept as component channels rather than CSS
 * strings so the two can be mixed — a binary swap at the playhead is what made
 * the old waveform look like a progress bar wearing bars.
 */
const PLAYED = { r: 191, g: 95, b: 255, a: 1 };
const REST   = { r: 255, g: 255, b: 255, a: 0.26 };

const rgba = c => `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${c.a.toFixed(3)})`;
const PLAYED_CSS = rgba(PLAYED);
const REST_CSS   = rgba(REST);
const PLAY_TINT  = 'rgba(255,255,255,.92)';

/**
 * The colour fade is exactly ONE bar wide, and that is not an aesthetic choice.
 *
 * A bar represents a slice of audio. One bar of fade means each bar fills in
 * across precisely the time its own audio is playing — so the colour is
 * synchronised to what you are hearing rather than smeared decoratively across
 * it. The softness comes free: at 36 bars over a ten-second note, one bar is
 * about a quarter of a second of gradual fill.
 *
 * Wider was tried and measured wrong. At 2.5 the last bar reached only 40% by
 * the end of playback, because the fade trails the head and never catches up.
 */
const FADE_BARS = 1;

/**
 * The colour of bar `i`, given where the playhead is.
 *
 * The fade TRAILS the playhead rather than straddling it. An earlier version
 * centred the blend on the head (`+ 0.5`), which meant the first bar rendered
 * half-lit at progress 0 — measured as rgba(223,175,255,.63) on an untouched
 * note. A waveform that looks partly played before you press play is telling
 * you something untrue about the audio.
 */
function barColour(i, count, progress) {
  const head = progress * count;
  const t = Math.max(0, Math.min(1, (head - i) / FADE_BARS));
  return rgba({
    r: REST.r + (PLAYED.r - REST.r) * t,
    g: REST.g + (PLAYED.g - REST.g) * t,
    b: REST.b + (PLAYED.b - REST.b) * t,
    a: REST.a + (PLAYED.a - REST.a) * t,
  });
}

/**
 * THE BARS, AND NOTHING THAT CHANGES WHILE THEY PLAY.
 *
 * Memoised on the heights alone, so the readout ticking four times a second
 * cannot re-render 36 nodes with it.
 *
 * Crucially the spans carry NO background in their style object. React only
 * manages properties it sets, so leaving colour out means the frame loop's
 * direct writes survive every re-render. Had it been declared here, React would
 * re-apply a stale colour on each readout tick and visibly fight the playhead.
 */
const Waveform = memo(function Waveform({ bars, settle, register }) {
  return (
    <div
      className={settle ? 'yp-wave-settle' : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 2, height: WAVE_HEIGHT }}
      aria-hidden="true"
    >
      {bars.map((v, i) => (
        <span
          key={i}
          ref={el => register(i, el)}
          style={{
            flex: 1,
            // Floor at 2px: a near-silent bucket must still read as a bar, or a
            // pause in speech looks like a gap in the file.
            height: Math.max(2, v * WAVE_HEIGHT),
            borderRadius: 999,
          }}
        />
      ))}
    </div>
  );
});

export default function VoiceMessage({ message }) {
  const path       = message?.payload?.path ?? null;
  const storedMs   = Number(message?.payload?.duration_ms ?? 0);
  const peaks      = message?.payload?.peaks ?? null;

  const audioRef   = useRef(null);
  // The frame loop writes fills here directly; React owns everything else
  // about these nodes.
  const barsRef    = useRef([]);
  const [url,      setUrl]      = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [playing,  setPlaying]  = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(storedMs / 1000);
  // Playback reached the end. Only changes the LABEL — the control stays the
  // play triangle, because replay is play, and the brief rules out adding
  // icons. A screen reader still hears the difference.
  const [finished, setFinished] = useState(false);

  const registerBar = useCallback((i, el) => { barsRef.current[i] = el; }, []);

  /** Paint every bar for a given progress. One function, two callers. */
  const paintBars = useCallback(p => {
    const nodes = barsRef.current;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i]) nodes[i].style.backgroundColor = barColour(i, nodes.length, p);
    }
  }, []);

  // Computed once per payload, not per frame. The playhead re-renders this
  // component every frame while playing, and re-deriving 36 bars each time
  // would put avoidable work in exactly the wrong place.
  const bars = useMemo(() => toDisplayPeaks(peaks), [peaks]);

  // Pause on unmount. Closing a drawer mid-playback must stop the audio — an
  // element that outlives its bubble keeps playing with nothing on screen to
  // stop it.
  useEffect(() => () => {
    const el = audioRef.current;
    el?.pause();
    releasePlayback(el);
  }, []);

  /**
   * THE PLAYHEAD RUNS ON FRAMES, NOT ON `timeupdate`.
   *
   * `timeupdate` fires about four times a second, which is fine for a numeric
   * readout and visibly steppy on a waveform — the colour would jump several
   * bars at a time. Reading `currentTime` each frame instead makes the leading
   * edge travel continuously, which is the whole of the animation: the bars
   * themselves never move.
   *
   * Bound only while playing, so a thread of paused voice notes costs nothing.
   */
  useEffect(() => {
    if (!playing) return undefined;

    // Reduced motion: no frame loop at all. `timeupdate` still drives the
    // readout roughly four times a second, so progress is still shown — it
    // simply steps instead of gliding. A continuous 60fps repaint IS the
    // "unnecessary continuous animation" the preference exists to switch off.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;

    let frame;
    const tick = () => {
      const el = audioRef.current;
      if (el && !el.paused && el.duration > 0) {
        // WRITTEN STRAIGHT TO THE DOM, NOT THROUGH STATE.
        //
        // setPosition here re-rendered the whole component every frame, which
        // meant recomputing and re-diffing 36 bars sixty times a second to move
        // one colour boundary. The bars never change shape while playing — only
        // their fill — so the frame loop touches exactly that and nothing else.
        //
        // The readout keeps its own path (timeupdate, ~4/s), which is ample for
        // a m:ss display and costs four renders a second instead of sixty.
        paintBars(Math.min(1, el.currentTime / el.duration));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, paintBars]);

  /**
   * The bars' resting colour, painted from state rather than declared in JSX.
   *
   * Runs on mount, on pause, on reset, and roughly four times a second while
   * playing — where the frame loop has already written a fresher value, so this
   * is harmless redundancy rather than a fight. Both callers write the same
   * property through the same function.
   *
   * It also IS the progress indicator under reduced motion, where the frame
   * loop never starts: the leading edge steps four times a second instead of
   * gliding, which is exactly the trade that preference asks for.
   */
  useEffect(() => {
    paintBars(duration > 0 ? Math.min(1, position / duration) : 0);
  }, [position, duration, bars, paintBars]);

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
    setFinished(false);
    const src = await ensureUrl();
    if (!src) return;

    const el = audioRef.current;
    if (!el) return;
    if (el.src !== src) el.src = src;
    // Silences any other note first. Before play(), not after — after would
    // let both sound for a frame.
    claimPlayback(el);

    try {
      await el.play();
    } catch (err) {
      // AbortError IS NOT A FAILURE. `play()` rejects with it whenever the load
      // is interrupted — pausing while it buffers, pressing play twice, or the
      // element being torn down. All of those are the user doing something
      // ordinary, and surfacing "Cannot play this right now" for them tells
      // people the audio is broken when they simply changed their mind.
      //
      // Found while instrumenting playback: pausing 1.4s into a load put that
      // error on screen for a file that was completely intact.
      if (err?.name === 'AbortError') return;

      // What remains is real: autoplay policy, a decode failure, an expired
      // url. Those present the same way to the person pressing the button.
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

  return (
    // 168 → 244, and the gap opened up with it. A player that sizes itself to
    // the smallest thing it can contain reads as a control someone dropped into
    // a message; a consistent, deliberate footprint reads as a component. The
    // container's own padding and min-height (KIND_SHAPE.voice) do the rest.
    <div style={{ display: 'flex', alignItems: 'center', gap: 15, minWidth: 252 }}>
      {/* THE ANCHOR. 32 → 44, which is also the first size that is a genuine
          touch target rather than one you aim at. Everything else in the
          component steps down from here — button, then waveform, then the
          duration line — so the eye starts in one place and travels left to
          right. */}
      <button
        type="button"
        className="yp-voice-play"
        onClick={toggle}
        disabled={loading}
        aria-label={
          loading ? 'Loading voice message'
          : playing ? 'Pause voice message'
          : finished ? 'Replay voice message'
          : 'Play voice message'
        }
        style={{
          width: 44, height: 44, flexShrink: 0, borderRadius: 999,
          position: 'relative',
          // The bubble's material, one step brighter: same glass, lifted enough
          // to read as the thing you press.
          border: '1px solid rgba(255,255,255,.24)',
          background: 'linear-gradient(160deg, rgba(255,255,255,.17) 0%, rgba(255,255,255,.07) 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.20), 0 4px 12px -7px rgba(0,0,0,.9)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          color: PLAY_TINT,
          cursor: loading ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0,
          opacity: loading ? .55 : 1,
        }}
      >
        {/* Both glyphs are always mounted and cross-faded. Swapping them would
            blink; fading means the control CHANGES rather than flickers.
            The play triangle is nudged a pixel right — an equilateral triangle
            centred by its bounding box always reads as sitting left. */}
        <span className="yp-voice-glyph" style={{
          opacity: playing ? 0 : 1,
          transform: playing ? 'scale(.7)' : 'scale(1)',
        }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
               style={{ marginLeft: 2 }}>
            <path d="M8 5.2v13.6a1 1 0 0 0 1.53.85l10.7-6.8a1 1 0 0 0 0-1.7L9.53 4.35A1 1 0 0 0 8 5.2z" />
          </svg>
        </span>
        <span className="yp-voice-glyph" style={{
          opacity: playing ? 1 : 0,
          transform: playing ? 'scale(1)' : 'scale(.7)',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="4.5" width="4.4" height="15" rx="1.6" />
            <rect x="13.6" y="4.5" width="4.4" height="15" rx="1.6" />
          </svg>
        </span>
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* §6.4 — drawn from peaks stored at record time. Nothing is decoded
            and no audio is fetched to render this.

            Notes recorded before M9f have no peaks and never will (they cannot
            be retrofitted without re-downloading every one), so the plain bar
            is a permanent state rather than a loading one. */}
        {bars ? (
          <Waveform bars={bars} settle={!playing} register={registerBar} />
        ) : (
          <div style={{ height: 3, borderRadius: 999, background: REST_CSS, overflow: 'hidden' }}>
            <div style={{ width: `${progress * 100}%`, height: '100%', background: PLAYED_CSS, borderRadius: 999 }} />
          </div>
        )}
        {/* LENGTH LEFT, CLOCK RIGHT, ONE LINE.
            The bubble stands down from drawing the timestamp for this kind
            (KIND_SHAPE.ownsTimestamp) — otherwise the clock landed on a second
            line below, two timings stacked saying different things inside a
            component whose whole point is that it is one object. */}
        <div style={{
          marginTop: 6,
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
        }}>
          {/* SECONDARY — the duration. Readable at a glance and clearly below
              the waveform: heavier than the timestamp, lighter than the wave.

              TABULAR FIGURES. This counts up during playback, and proportional
              digits are different widths — a '1' is narrower than a '0', so the
              readout shifts left and right as the seconds tick. Tabular locks
              every digit to one width and the number stays still. */}
          <span style={{
            fontSize: 11.5,
            fontWeight: 500,
            lineHeight: 1,
            letterSpacing: '.01em',
            fontVariantNumeric: 'tabular-nums',
            color: error ? 'var(--neon)' : 'rgba(255,255,255,.74)',
          }}>
            {error ?? formatDuration(playing || position > 0 ? position : duration)}
          </span>

          {/* TERTIARY — the clock. Deliberately quieter and smaller than the
              duration: they sit on one line, and at equal weight the eye cannot
              tell which one it is meant to read.

              10px and this alpha match the timestamp inside a TEXT bubble, so
              the clocks line up in weight down the whole thread rather than the
              Voicey having its own. Tabular here too, so times of different
              digits do not shuffle the right edge between messages. */}
          {message?.created_at && (
            <span style={{
              flexShrink: 0,
              fontSize: 10,
              lineHeight: 1,
              letterSpacing: '.02em',
              fontVariantNumeric: 'tabular-nums',
              color: 'rgba(255,255,255,.46)',
              userSelect: 'none',
            }}>
              {timeOf(message.created_at)}
            </span>
          )}
        </div>
      </div>

      {/* preload="none" so a thread of voice notes downloads nothing until
          asked. The src is set on first play, not here. */}
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={e => { releasePlayback(e.currentTarget); setPlaying(false); }}
        onEnded={e => { releasePlayback(e.currentTarget); setPlaying(false); setPosition(0); setFinished(true); }}
        // Keeps the readout honest while PAUSED and on seek; the frame loop
        // above owns it during playback.
        // Drives the DURATION READOUT only. The waveform is painted by the
        // frame loop above, which needs no state — so this fires at its own
        // lazy rate without the bars caring.
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
