import { LONG } from './mediaSession';

/**
 * RESUMABLE LONG-FORM SOURCES — the layer between a provider and the manager.
 *
 * The Media Session Manager decides WHEN something pauses and resumes. It must
 * never learn HOW: no `if (soundcloud)`, no widget handles, no postMessage. A
 * provider that needs special handling in the manager has been wired at the
 * wrong level, and every future provider — Spotify, YouTube Music, a livestream
 * — would need the arbitration logic edited to accommodate it.
 *
 * So a provider supplies four primitives and gets resumability for free:
 *
 *   pause()               stop where you are
 *   play()                start or continue
 *   getPosition()         → ms, or a promise of ms
 *   seekTo(ms)            move the playhead
 *   whenReady()           → promise resolving when the provider can be driven
 *
 * Everything else — capturing state, waiting for readiness, restoring position
 * — happens once, here, and is tested once, here.
 *
 * ── ⚠ RESUME IS STATE-DRIVEN, NEVER TIMER-DRIVEN ─────────────────────
 *
 * An iframe provider is not ready the instant it is told to do something. The
 * tempting fix is `setTimeout(500)` before `play()`, and it is wrong twice: on
 * a slow connection 500ms is not enough and playback silently never resumes,
 * and on a fast one it is 500ms of dead air. `whenReady()` makes resumption
 * wait for the actual condition rather than a guess about it.
 *
 * ── ⚠ POSITION IS CAPTURED, NEVER ASSUMED ────────────────────────────
 *
 * Widget APIs do not reliably hold their playhead across a pause, and an iframe
 * that reloads for any reason loses it entirely. So the position is read at the
 * moment of parking and written back on resume. A provider that happens to
 * preserve it anyway is merely seeked to where it already was.
 */

/** The real clock. Swapped out only by tests — see `fadesSettled`. */
const realDelay = ms => new Promise(r => setTimeout(r, ms));

/**
 * Wrap a provider's primitives into a source the manager can park and resume.
 *
 * @param {object} adapter
 * @param {string} adapter.id            which provider — diagnostics only
 * @param {() => void} adapter.pause
 * @param {() => void} adapter.play
 * @param {() => number|Promise<number>} adapter.getPosition   ms
 * @param {(ms: number) => void} adapter.seekTo
 * @param {() => Promise<void>} [adapter.whenReady]  defaults to ready now
 * @param {() => object} [adapter.extraState]  provider-specific session state
 * @param {object} [options]
 * @param {(ms: number) => Promise<void>} [options.delay]  how the fade ramp
 *        waits between steps. Defaults to a real timer; see `fadesSettled`.
 */
export function createResumableSource(adapter, { delay = realDelay } = {}) {
  const {
    id, pause, play, getPosition, seekTo,
    whenReady = () => Promise.resolve(),
    extraState,
  } = adapter;

  // The parked session. Null whenever this source is not parked.
  let state = null;

  /**
   * ── THE INTERRUPTION FADE ────────────────────────────────────────────
   *
   * When a Voicey takes audio, the mix should DUCK out over a couple of
   * hundred milliseconds rather than snap to silence — a hard cut mid-track is
   * jarring, and the natural sound is a quick fade like a phone call ducking
   * music.
   *
   * ⚠ THIS ONLY APPLIES TO INTERRUPTION, NOT TO MANUAL PAUSE. The manager calls
   * `pause()`/`resume()` here; a user tapping the player's own pause goes
   * straight to `adapter.pause()` and stops instantly, which is what "stop"
   * should feel like. So the fade lives in exactly the two methods the manager
   * drives.
   *
   * ⚠ VOLUME MECHANICS ARE THE PROVIDER'S. `setVolume(0..1)` differs per
   * provider (a widget's 0–100 vs a media element's 0–1), so each adapter owns
   * it and this factory only decides WHEN to ramp. A provider without
   * `setVolume` simply cuts, which is the old behaviour — nothing breaks, it is
   * only less smooth.
   *
   * A generation token supersedes an in-flight fade: interrupt, then resume
   * before the duck completes, and the stale ramp must not fight the new one.
   *
   * ⚠ THE RAMP IS A DURATION, SO A TEST MUST NOT GUESS AT IT. Sampling the
   * volume after a fixed sleep asks "has 240ms of ramp happened in 350ms of
   * wall clock", which is true on a quiet machine and false on a loaded one —
   * the assertion measures the CI box, not the fade. Hence two seams:
   * `delay` lets a test own the clock, and `fadesSettled` lets it wait for the
   * ramp to actually END. Production passes neither and is unchanged.
   */
  const FADE_MS = 240;
  const FADE_STEPS = 6;
  let fadeToken = 0;

  // Every ramp currently in flight, INCLUDING superseded ones — a stale duck
  // keeps stepping until it notices it lost the token, and a test that stops
  // waiting before then would race the very supersession it is checking.
  const inFlight = new Set();

  function track(promise) {
    inFlight.add(promise);
    promise.then(() => inFlight.delete(promise), () => inFlight.delete(promise));
    return promise;
  }

  // Returns true only if the ramp finished WITHOUT a newer fade superseding it.
  // The caller uses that to decide whether its terminal action (pause, reset)
  // still applies — a resume that interrupts a park's fade must cancel the
  // pause that fade was about to perform.
  async function ramp(from, to) {
    if (typeof adapter.setVolume !== 'function') return false;
    const mine = ++fadeToken;
    for (let i = 1; i <= FADE_STEPS; i++) {
      if (mine !== fadeToken) return false;        // a newer op took over
      adapter.setVolume(from + (to - from) * (i / FADE_STEPS));
      await delay(FADE_MS / FADE_STEPS);
    }
    return mine === fadeToken;
  }

  /**
   * Everything needed to put playback back exactly where it was.
   *
   * `provider` and `media` are recorded even though nothing reads them yet:
   * when a second provider can be playing, restoring into the WRONG one is the
   * failure that will happen, and the state has to be able to say so.
   */
  function captureState() {
    const positionMs = getPosition();
    const base = {
      provider: id,
      media: adapter.media?.() ?? null,
      positionMs,
      ...(extraState ? extraState() : null),
    };
    // getPosition may be async (a widget callback). Normalised here so callers
    // never have to care which kind of provider they hold.
    return positionMs && typeof positionMs.then === 'function'
      ? positionMs.then(ms => ({ ...base, positionMs: ms }))
      : base;
  }

  async function restoreState(saved) {
    if (!saved) return;
    // ⚠ WAIT FIRST. Seeking a provider that is not ready is silently ignored by
    // every widget API tried, which produces the worst possible symptom:
    // playback resumes from zero rather than not at all.
    await whenReady();
    if (Number.isFinite(saved.positionMs) && saved.positionMs > 0) {
      seekTo(saved.positionMs);
    }
    // Come back UP, mirroring the duck: start silent, play, fade in. The seek
    // and the start therefore happen under cover of silence, so a provider that
    // blips at the seam is not heard doing it.
    if (typeof adapter.setVolume === 'function') adapter.setVolume(0);
    play();
    track(ramp(0, 1));
  }

  return {
    kind: LONG,

    /** Called by the manager when something else takes audio. */
    pause() {
      // Captured BEFORE pausing: a provider that resets its playhead on pause
      // would otherwise be recorded at zero, and resume would restart the set.
      const captured = captureState();

      // ⚠ DUCK, THEN STOP. Fade the volume down and pause at the bottom, rather
      // than cutting mid-track. Fire-and-forget: the manager's arbitration is
      // synchronous and must not wait on a 240ms ramp, and the interrupting
      // Voicey starts immediately — a brief natural overlap as the mix ducks
      // under it. A provider without setVolume falls straight through to pause.
      if (typeof adapter.setVolume === 'function') {
        track(ramp(1, 0).then(finished => {
          // If a resume started mid-duck, IT owns fadeToken now and is ramping
          // back up — pausing here would stop audio the newer op just started.
          if (finished) { pause(); adapter.setVolume(1); }
        }));
      } else {
        pause();
      }

      // Async captures settle into `state` without blocking the pause itself —
      // stopping the sound must never wait on a widget callback.
      if (captured && typeof captured.then === 'function') {
        captured.then(s => { state = s; });
      } else {
        state = captured;
      }
    },

    /** Called by the manager when the interruption completes. */
    resume() {
      const saved = state;
      state = null;
      // Deliberately not awaited by the manager: arbitration is synchronous,
      // and restoration takes as long as the provider takes.
      return restoreState(saved);
    },

    // Exposed for the MiniPlayer and for tests. The manager never calls these.
    captureState,
    restoreState,
    parkedState: () => state,

    /**
     * Resolves once no ramp is still stepping — including one that has been
     * superseded and is on its way out.
     *
     * ⚠ THIS IS HOW A TEST WAITS FOR A FADE. `pause()` is deliberately
     * fire-and-forget (arbitration must not block on 240ms), so there is
     * otherwise no handle on when the duck — and the pause it performs at the
     * bottom — has actually happened. Sleeping instead makes the assertion a
     * measurement of machine load.
     */
    async fadesSettled() {
      // Looped rather than a single `all`: a settling ramp can start the next
      // one (duck → pause → reset), and the set is empty only when the whole
      // chain is done.
      while (inFlight.size) await Promise.all([...inFlight]);
    },
  };
}

/**
 * SOUNDCLOUD — the widget API.
 *
 * `getPosition` is callback-based, hence the promise. Everything else is a
 * direct call.
 */
export function soundcloudAdapter(widget, { media } = {}) {
  return {
    id: 'soundcloud',
    media: () => media ?? null,
    pause: () => widget.pause(),
    play:  () => widget.play(),
    seekTo: ms => widget.seekTo(ms),
    // 0..1, converted to the widget's 0..100 by the shim that owns the real
    // widget — the interface here stays uniform across providers.
    setVolume: v => widget.setVolume?.(v),
    getPosition: () => new Promise(resolve => {
      try { widget.getPosition(ms => resolve(Number(ms) || 0)); }
      catch { resolve(0); }
    }),
    // The widget is bound before this adapter is built, so it is ready by
    // construction. Kept explicit so the contract is visible rather than
    // assumed — and so a future lazy-loading path has somewhere to go.
    whenReady: () => Promise.resolve(),
  };
}

/**
 * MIXCLOUD — postMessage, with no way to ASK for the position.
 *
 * ⚠ THE POSITION MUST BE OBSERVED, NOT REQUESTED. Mixcloud's widget emits
 * progress events and answers no queries, so the caller tracks the latest
 * reported position and hands it in through `getPosition`. Without that this
 * provider can only ever resume from zero.
 */
export function mixcloudAdapter({ post, getPosition, media } = {}) {
  return {
    id: 'mixcloud',
    media: () => media ?? null,
    pause: () => post({ method: 'pause' }),
    play:  () => post({ method: 'play' }),
    seekTo: ms => post({ method: 'seek', value: Math.round(ms / 1000) }),
    getPosition,
    whenReady: () => Promise.resolve(),
  };
}
