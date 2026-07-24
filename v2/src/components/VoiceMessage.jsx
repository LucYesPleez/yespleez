import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { signedUrlFor, formatDuration } from '../lib/voiceNotes';
import { toDisplayPeaks, barsForDuration } from '../lib/voicePeaks';
import { decodeWave, toDisplayWave } from '../lib/voiceWave';
import { timeOf } from '../lib/clock';
import { claimAudio, finishAudio, releaseAudio, SHORT } from '../lib/mediaSession';
import { playedAt } from '../lib/waveColour';
import { fractionFromPointer, seekTarget, stepFraction, ARROW_STEP } from '../lib/voiceScrub';
import { nextSpeed, formatSpeed, loadSpeed, saveSpeed } from '../lib/playbackSpeed';
import EqReceipt from './EqReceipt';

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
 * Bar width and the gap after it.
 *
 * FIXED, because a note draws a number of bars proportional to its LENGTH.
 *
 * ⚠ THE BINDING CONSTRAINT IS A 360px HANDSET, not the desktop player, and this
 * has now caught me twice. Wave width there is the frame's 76% of a 328px
 * content box, less 87px of chrome — 34 bubble padding, 5 player inset, 36 play
 * button, 12 gap — which leaves 162px. Desktop has far more, so anything sized
 * against it overflows a phone silently.
 *
 * 3.5 + 1.5 puts 32 bars in 158.5px, inside that 162. The width is the smallest
 * that still reads as audio: 3.2px is the measured floor below which varying
 * heights stop being visible, and 2.44px was reported as "compressed" on a real
 * Galaxy.
 */
const BAR_W = 3.5;
const BAR_GAP = 1.5;

/**
 * THE WAVEFORM CARRIES THE COLOUR (M9u).
 *
 * The bubble is smoked glass now, and the play button with it. This is the one
 * element in a Voicey allowed to be vivid — and only once it is playing.
 *
 * ── PLAYED IS A GRADIENT ACROSS THE WAVE, NOT ONE COLOUR ─────────────
 *
 * Every played bar used to be the same violet, so the "gradient" in the design
 * language existed everywhere except the one place with enough width to show
 * one. Played bars now run cyan at the start of the note to magenta at the end,
 * so the wave itself is the gradient and the playhead reveals it left to right.
 *
 * ── REST IS DIMMER THAN IT WAS ───────────────────────────────────────
 *
 * .26 → .17. An idle Voicey should settle into the thread rather than announce
 * itself; the colour arriving on play is the moment, and it only reads as a
 * moment if there is somewhere to arrive FROM.
 */
/**
 * REST — dimmer again, .17 → .13.
 *
 * The bubble is near-black now, so white bars gained contrast for free and were
 * reading louder than before at the same alpha. An idle Voicey should settle
 * into the thread; the colour arriving on play is the moment, and it only reads
 * as a moment if there is somewhere quiet to arrive from.
 */
const REST = { r: 255, g: 255, b: 255, a: 0.13 };

const rgba = c => `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${c.a.toFixed(3)})`;
const REST_CSS   = rgba(REST);
/** The fallback progress bar has no width to run a gradient across, so it takes
    the gradient's midpoint — derived, so it dims with WAVE_BRIGHTNESS too. */
const PLAYED_CSS = rgba(playedAt(0.58));
const PLAY_TINT  = '#FFFFFF';


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
  // This bar's own place in the gradient — fixed by WHERE it is, not by how far
  // playback has got. The colour a bar will become is decided before it lights,
  // so the wave reveals a gradient rather than sweeping one along with the head.
  const played = playedAt(count > 1 ? i / (count - 1) : 0);
  return rgba({
    r: REST.r + (played.r - REST.r) * t,
    g: REST.g + (played.g - REST.g) * t,
    b: REST.b + (played.b - REST.b) * t,
    a: REST.a + (played.a - REST.a) * t,
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
      // gap 2 → 1.5: at 42 bars the gaps would otherwise eat the width the
      // extra bars were added to use, and the wave would end up thinner in
      // ink rather than finer in detail.
      // ⚠ flex-start, NOT stretch. A short note draws fewer bars, and the wave
      // must simply END rather than spreading itself over the width — spreading
      // is the stretch this exists to remove.
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
        gap: BAR_GAP, height: WAVE_HEIGHT,
      }}
      aria-hidden="true"
    >
      {bars.map((v, i) => (
        <span
          key={i}
          ref={el => register(i, el)}
          style={{
            // ⚠ FIXED WIDTH, NEVER flex. While bars were `flex: 1` they shared
            // whatever width existed, so drawing fewer of them just made each
            // one fatter and the wave still filled the player — the note would
            // have looked the same length however short it was.
            width: BAR_W,
            flex: 'none',
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

export default function VoiceMessage({ message, receipt = null }) {
  const path       = message?.payload?.path ?? null;
  // Set only while a recording is in flight or has failed to send. `path` is
  // the stored object; this is the blob it was made from, still local. They are
  // never both meaningful — once the upload lands the message is replaced by
  // the server's row, which has a path and no url.
  const localUrl   = message?.payload?.localUrl ?? null;
  const storedMs   = Number(message?.payload?.duration_ms ?? 0);
  const peaks      = message?.payload?.peaks ?? null;
  // v2 envelope. See the branch in  — both formats are permanent.
  const wave       = message?.payload?.wave ?? null;

  const audioRef   = useRef(null);
  // ⚠ ONE STABLE OBJECT FOR THE LIFETIME OF THIS COMPONENT. The manager holds
  // this reference to decide what to pause and what to resume; a new object per
  // render would make every claim look like a different source and break the
  // guards that stop a stale release clearing a newer claim.
  const sessionRef = useRef(null);
  if (!sessionRef.current) {
    sessionRef.current = {
      kind: SHORT,   // a Voicey INTERRUPTS; it is never resumed after something else
      pause: () => { try { audioRef.current?.pause(); } catch { /* gone from the DOM */ } },
    };
  }
  // The frame loop writes fills here directly; React owns everything else
  // about these nodes.
  const barsRef    = useRef([]);
  // The scrub surface (for its bounding rect) and the drag's own bookkeeping.
  const surfaceRef   = useRef(null);
  const scrubbingRef = useRef(false);   // a drag is in progress — the frame loop yields the paint
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
  // Remembered across notes and reloads — a listening pace, not a per-note choice.
  const [speed,    setSpeed]    = useState(loadSpeed);

  const registerBar = useCallback((i, el) => { barsRef.current[i] = el; }, []);

  /**
   * Apply the playback rate, and KEEP THE PITCH.
   *
   * Without preservesPitch a sped-up voice chipmunks and a slowed one drones —
   * the browser resamples by default. `preservesPitch` is standard now;
   * `webkitPreservesPitch` covers older Safari. Runs on mount, on every speed
   * change, and after the element loads (which can reset the rate on some
   * engines), so the three cannot fall out of step.
   */
  const applySpeed = useCallback(s => {
    const el = audioRef.current;
    if (!el) return;
    el.preservesPitch = true;
    el.webkitPreservesPitch = true;
    el.playbackRate = s;
  }, []);

  useEffect(() => { applySpeed(speed); }, [speed, applySpeed]);

  function cycleSpeed(e) {
    e.stopPropagation();
    const s = nextSpeed(speed);
    setSpeed(s);
    saveSpeed(s);
    applySpeed(s);   // immediate, so a mid-playback tap changes pace at once
  }

  /** Paint every bar for a given progress. One function, two callers. */
  const paintBars = useCallback(p => {
    const nodes = barsRef.current;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i]) nodes[i].style.backgroundColor = barColour(i, nodes.length, p);
    }
  }, []);

  // Computed once per payload AND per bar count, not per frame. The playhead
  // re-renders this component every frame while playing, and re-deriving the
  // bars each time would put avoidable work in exactly the wrong place.
  //
  // ⚠ THE COUNT IS A JS DECISION, NOT A CSS ONE, and deliberately so. The bars
  // are DOM nodes derived from stored data — a media query can restyle them but
  // cannot make there be fewer of them, and drawing 42 where only 28 fit is what
  // produced the "compressed" report. The 640px threshold is the same one
  // `index.css` uses for the player's min-width, so the two cannot disagree
  // about what a phone is.
  // ⚠ FROM THE NOTE'S LENGTH, not a constant. A bar is a fixed slice of time,
  // so a three-second note draws a short wave and a seven-second one fills the
  // player. Uses the STORED duration rather than the audio element's, because
  // this has to be right before anything has been downloaded — and the element
  // has no duration until someone presses play.
  const barCount = barsForDuration(storedMs);

  /**
   * ⚠ TWO FORMATS, AND BOTH ARE PERMANENT.
   *
   * `payload.wave` is v2 — an envelope sampled at a fixed rate in TIME, so a bar
   * means the same 32ms whatever the recording's length. `payload.peaks` is v1 —
   * 56 RMS buckets regardless of duration, which is why long notes drew flat.
   *
   * v1 is NOT deprecated and cannot be. Peaks are computed once at record time
   * and frozen into the row, so every Voicey recorded before v2 carries only
   * that and can never be upgraded without re-downloading and rewriting every
   * message. This branch is the permanent shape of the code, not a migration
   * window.
   *
   * v2 first: a row could carry both if it were ever backfilled, and the better
   * one should win.
   */
  const bars = useMemo(() => {
    const decoded = decodeWave(wave);
    if (decoded) return toDisplayWave(decoded, barCount);
    return toDisplayPeaks(peaks, barCount);
  }, [wave, peaks, barCount]);

  // Pause on unmount. Closing a drawer mid-playback must stop the audio — an
  // element that outlives its bubble keeps playing with nothing on screen to
  // stop it.
  useEffect(() => () => {
    const el = audioRef.current;
    el?.pause();
    releaseAudio(sessionRef.current);
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
      // While a drag owns the playhead the scrub handlers paint; the loop keeps
      // spinning so it takes back over the instant the finger lifts, but it must
      // not fight the finger for the same bars in between.
      if (!scrubbingRef.current && el && !el.paused && el.duration > 0) {
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
    // A note that has not been uploaded yet plays from the recording still in
    // memory. There is no path to sign — the object exists nowhere but this
    // tab — so this returns BEFORE the storage call rather than falling through
    // to it and failing. This is what lets a failed Voicey be listened back to
    // before deciding whether to retry it.
    if (localUrl) return localUrl;
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

  /**
   * SCRUBBING — drag the playhead anywhere on the waveform.
   *
   * The visual is the same paintBars() the frame loop uses, so a scrubbed
   * position and a played one are drawn by one function and can never disagree.
   * currentTime is set live while the audio is loaded (the common case — you
   * scrub during or after playing), so scrubbing WHILE playing follows the
   * finger audibly. Before the first play there is no element duration yet, so
   * the drag moves the playhead visually and commitSeek loads-then-seeks on
   * release.
   */
  function currentDuration() {
    const d = audioRef.current?.duration;
    return Number.isFinite(d) && d > 0 ? d : (storedMs / 1000);
  }

  /** Paint + readout for a fraction, and seek live if the audio is loaded. */
  function scrubTo(fraction) {
    const el = audioRef.current;
    const t = seekTarget(fraction, currentDuration());
    if (el && Number.isFinite(el.duration) && el.duration > 0) el.currentTime = t;
    paintBars(fraction);
    setPosition(t);
  }

  /** Land the drag: ensure the audio is loaded, seek, and resume if it was playing. */
  async function commitSeek(fraction, resume) {
    const el = audioRef.current;
    if (!el) return;

    if (Number.isFinite(el.duration) && el.duration > 0) {
      el.currentTime = seekTarget(fraction, el.duration);
      if (resume && el.paused) { claimAudio(sessionRef.current); try { await el.play(); } catch { /* AbortError etc. */ } }
      return;
    }

    // Never played: load, then seek once the length is known.
    const src = await ensureUrl();
    if (!src) return;
    if (el.src !== src) el.src = src;
    const applyOnce = () => {
      el.currentTime = seekTarget(fraction, el.duration || (storedMs / 1000));
      if (resume) { claimAudio(sessionRef.current); el.play().catch(() => { /* policy/decode */ }); }
    };
    if (el.readyState >= 1) applyOnce();
    else el.addEventListener('loadedmetadata', applyOnce, { once: true });
  }

  function onScrubDown(e) {
    e.stopPropagation();                       // the bubble is a button (tap-to-reveal)
    scrubbingRef.current = true;
    setFinished(false);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* older engines */ }
    scrubTo(fractionFromPointer(e.clientX, surfaceRef.current?.getBoundingClientRect()));
  }

  function onScrubMove(e) {
    if (!scrubbingRef.current) return;
    scrubTo(fractionFromPointer(e.clientX, surfaceRef.current?.getBoundingClientRect()));
  }

  async function onScrubUp(e) {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    const frac = fractionFromPointer(e.clientX, surfaceRef.current?.getBoundingClientRect());
    await commitSeek(frac, playing);
  }

  /** Double-tap the waveform → back to the start, WhatsApp-style. */
  function onScrubDoubleClick(e) {
    e.stopPropagation();
    void commitSeek(0, playing);
    paintBars(0);
    setPosition(0);
    setFinished(false);
  }

  function onScrubKey(e) {
    let frac = null;
    if (e.key === 'ArrowRight')     frac = stepFraction(progress, ARROW_STEP);
    else if (e.key === 'ArrowLeft') frac = stepFraction(progress, -ARROW_STEP);
    else if (e.key === 'Home')      frac = 0;
    else if (e.key === 'End')       frac = 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    void commitSeek(frac, playing);
    paintBars(frac);
    setPosition(seekTarget(frac, currentDuration()));
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
    claimAudio(sessionRef.current);

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

  if (!path && !localUrl) {
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
    //
    // ⚠ THE MIN-WIDTH LIVES IN index.css, NOT HERE. It was `minWidth: 252`
    // inline, which beat the phone breakpoint and pushed the waveform out
    // through the side of the bubble on a Galaxy — the bubble is capped at 76%
    // of the thread, which on a narrow handset is less than 252px, and an
    // inline minimum cannot be told to yield. Reported 2026-07-22. This is the
    // fourth change caught by that rule; see the handover.
    <div className="yp-voice-player" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {/* THE ANCHOR. 32 → 44 → 36, which is the composer's control size:
          `SIZE` in VoicePill and `CONTROL` in Composer, the two constants that
          are already required to match each other. The mic you record with and
          the button you play back with are now the same object at the same
          size, which is the relationship the owner asked for.

          ⚠ 36 IS THE DISC, NOT THE TAP TARGET. 44 was chosen here as the first
          size that is a genuine touch target rather than one you aim at, and
          that reasoning does not stop being true because the disc got smaller.
          The HIT AREA STAYS 44 via `.yp-voice-play::before` in index.css — the
          composer's controls can be 36 because they sit in a capsule with 5px
          of inset around them, and a bubble gives this one no such margin.

          The 8px it gives up goes to the waveform, not to the gap. */}
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
          width: 36, height: 36, flexShrink: 0, borderRadius: 999,
          position: 'relative',
          boxSizing: 'border-box',
          // SMOKED BLACK WITH A GRADIENT RING (M9u).
          //
          // It used to be a pale glass disc — the brightest object inside the
          // bubble, which made the control louder than the content. Now the
          // disc is nearly black and the only colour is the ring around it, so
          // it reads as machined rather than lit.
          //
          // Two backgrounds on one element: the dark face clipped to the
          // padding box, the gradient to the border box, with a transparent
          // border letting it through as a ring. Same technique as the
          // composer's Hand, so the two rings are the same object.
          border: '1px solid transparent',
          background:
            // Nearly black, and NEUTRAL — five points of spread. The disc used
            // to be the brightest object inside the bubble, which made the
            // control louder than the content it plays.
            'linear-gradient(160deg, rgba(23,21,29,.96) 0%, rgba(10,9,13,.98) 100%) padding-box, '
            // A thin purple ring, warming to magenta where the light catches.
            + 'linear-gradient(140deg, rgba(191,95,255,.85) 0%, rgba(255,79,216,.95) 100%) border-box',
          // A tiny magenta bloom — barely a halo, just enough that the ring
          // looks lit rather than drawn. Small radius, low alpha: this repeats
          // once per voice note down the thread.
          boxShadow: '0 0 10px -3px rgba(255,79,216,.30), 0 4px 14px -8px rgba(0,0,0,.95)',
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
               style={{ marginLeft: 2 }}>
            <path d="M8 5.2v13.6a1 1 0 0 0 1.53.85l10.7-6.8a1 1 0 0 0 0-1.7L9.53 4.35A1 1 0 0 0 8 5.2z" />
          </svg>
        </span>
        <span className="yp-voice-glyph" style={{
          opacity: playing ? 1 : 0,
          transform: playing ? 'scale(1)' : 'scale(.7)',
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
        {/* THE SCRUB SURFACE. A slider by role now, not decoration — so it
            carries the pointer/keyboard seek and its own a11y. The vertical
            padding enlarges the touch target without moving anything (the
            negative margin gives the space back to layout). `touchAction:none`
            stops the browser claiming the drag as a scroll gesture — without it
            a horizontal scrub on a touch screen would fight the thread. */}
        <div
          ref={surfaceRef}
          role="slider"
          tabIndex={0}
          aria-label="Seek voice message"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          onDoubleClick={onScrubDoubleClick}
          onKeyDown={onScrubKey}
          style={{ cursor: 'pointer', touchAction: 'none', outline: 'none', padding: '5px 0', margin: '-5px 0' }}
        >
          {bars ? (
            <Waveform bars={bars} settle={!playing} register={registerBar} />
          ) : (
            <div style={{ height: 3, borderRadius: 999, background: REST_CSS, overflow: 'hidden' }}>
              <div style={{ width: `${progress * 100}%`, height: '100%', background: PLAYED_CSS, borderRadius: 999 }} />
            </div>
          )}
        </div>
        {/* LENGTH LEFT, CLOCK RIGHT, ONE LINE.
            The bubble stands down from drawing the timestamp for this kind
            (KIND_SHAPE.ownsTimestamp) — otherwise the clock landed on a second
            line below, two timings stacked saying different things inside a
            component whose whole point is that it is one object. */}
        <div style={{
          marginTop: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          {/* Duration and speed are one group on the LEFT; the clock stays on
              the right. Grouping them keeps the pill next to the length it
              modifies instead of floating in the middle of the row. */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {/* SECONDARY — the duration. Heavier than the timestamp, lighter
                than the wave. TABULAR FIGURES so the counting readout does not
                shuffle left and right as the seconds tick. */}
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

            {/* SPEED — 1× / 1.5× / 2×, tap to cycle. Part of the player's own
                controls, not the message chrome. Quiet at 1× (transparent), lit
                faintly once changed, so it never out-shouts the waveform. */}
            <button
              type="button"
              onClick={cycleSpeed}
              aria-label={`Playback speed ${formatSpeed(speed)}, tap to change`}
              style={{
                flexShrink: 0,
                padding: '2px 7px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,.16)',
                background: speed === 1 ? 'transparent' : 'rgba(191,95,255,.16)',
                color: speed === 1 ? 'rgba(255,255,255,.52)' : 'rgba(240,220,255,.92)',
                fontSize: 10.5,
                fontWeight: 600,
                lineHeight: 1,
                letterSpacing: '.01em',
                fontVariantNumeric: 'tabular-nums',
                cursor: 'pointer',
              }}
            >
              {formatSpeed(speed)}
            </button>
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
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 10,
              lineHeight: 1,
              letterSpacing: '.02em',
              fontVariantNumeric: 'tabular-nums',
              color: 'rgba(255,255,255,.46)',
              userSelect: 'none',
            }}>
              {timeOf(message.created_at)}
              {/* A Voicey claims its own timestamp line, so the bubble never
                  draws the row the receipt normally sits in. Without this it
                  would be the only kind in the app with no status glyph —
                  which is exactly what shipped, and what the owner spotted. */}
              <EqReceipt state={receipt} />
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
        // ⚠ GUARDED ON `ended`. Some browsers fire pause alongside a natural
        // finish; releasing here first would clear the claim and the parked
        // long-form source would never be resumed. A genuine manual pause is
        // the only case that reaches releaseAudio, which is correct: silence
        // was the request, so nothing comes back.
        onPause={e => { if (!e.currentTarget.ended) releaseAudio(sessionRef.current); setPlaying(false); }}
        // Completion — this is what resumes whatever this Voicey interrupted.
        onEnded={() => { finishAudio(sessionRef.current); setPlaying(false); setPosition(0); setFinished(true); }}
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
          // Loading a src resets playbackRate on some engines — reassert it so
          // the first press honours the remembered pace.
          applySpeed(speed);
        }}
        onError={() => setError('Cannot play this right now')}
      />
    </div>
  );
}
