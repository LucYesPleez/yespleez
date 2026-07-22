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
 */
export function createResumableSource(adapter) {
  const {
    id, pause, play, getPosition, seekTo,
    whenReady = () => Promise.resolve(),
    extraState,
  } = adapter;

  // The parked session. Null whenever this source is not parked.
  let state = null;

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
    play();
  }

  return {
    kind: LONG,

    /** Called by the manager when something else takes audio. */
    pause() {
      // Captured BEFORE pausing: a provider that resets its playhead on pause
      // would otherwise be recorded at zero, and resume would restart the set.
      const captured = captureState();
      pause();
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
