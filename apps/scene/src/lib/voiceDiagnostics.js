/**
 * VOICE INTERRUPTION DIAGNOSTICS — observation only, never behaviour.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 *
 * A real phone call arrived mid-Voicey on iOS (2026-07-25) and appeared not
 * to be noticed: capture seemed to keep running, silent, for the length of
 * the call. Rather than guess between an iOS limitation, a Safari/PWA
 * limitation, a bug in our detection, or something firing that we ignore —
 * each of which implies a DIFFERENT fix — this was built to measure it.
 *
 * ── WHAT THE MEASUREMENT SHOWED (iPhone, iOS 26.5.2, installed PWA) ──
 *
 * Detection works, and is fast. Across three real incoming calls the
 * sequence was, every time:
 *
 *   track `mute`  → flagInterrupt('track-muted')  ACCEPTED, within ~1ms
 *   final dataavailable (the salvaged tail) → stop → release
 *
 * Note preserved and parked in every case. The original "it kept recording
 * silently" report was the separate mic-button defect — a parked note being
 * discarded and restarted from zero — being read as a capture failure.
 *
 * FOUR PLATFORM FACTS WORTH KEEPING:
 *   1. The track MUTES but does not END — readyState stays 'live' with
 *      muted=true. Anything watching only for `ended` misses a call.
 *   2. ⚠ THE AudioContext IS NON-DETERMINISTIC. It reported 'interrupted'
 *      on ONE call of three; on the other two it stayed 'running' through
 *      the entire seizure. `track.mute` fired 3 of 3. Trust the track.
 *   3. visibilityState stayed 'visible' FOR THE WHOLE CALL, every time. A
 *      visibility-based interruption check would have caught nothing —
 *      which is exactly why voiceNotes parks on the audio pipeline.
 *   4. `navigator.userActivation.isActive` drops to false a few seconds
 *      into ANY normal recording. It says nothing about interruption and
 *      must not be read as if it did.
 *
 * The capture stack is still the most fragile code here (voiceys-m9 §6.1:
 * every time we described the capture we wanted, iOS gave us something
 * worse), and the remaining scenarios are unmeasured. Keep measuring before
 * changing anything.
 *
 * ⚠ THIS MODULE MUST NEVER AFFECT RECORDING. It records what happened and
 * nothing else — no parking, no teardown, no flags the recorder reads. If a
 * future edit makes an interruption decision here, that decision belongs in
 * voiceMachine.decideInterrupt instead, where it is testable.
 *
 * ── WHY localStorage AND NOT JUST MEMORY ─────────────────────────────
 *
 * The interesting scenarios are exactly the ones that can kill the page:
 * an incoming call, a lock screen, iOS discarding a backgrounded tab. An
 * in-memory log would be destroyed by the very event it is trying to
 * describe. Persisting each entry as it happens means the evidence survives
 * even when the app does not.
 */

const KEY = 'yp_voice_diag';

/**
 * Bounded so a forgotten diagnostic session cannot grow without limit.
 * Oldest entries drop first.
 *
 * Sized for the HEARTBEAT (below), not for discrete events: one sample per
 * second means a 3-minute scenario is ~180 entries on its own. At 400 the
 * ring would eat its own SCENARIO marker and the early events — exactly the
 * part of the timeline that says what happened first. 2000 covers several
 * full-length runs and is a few hundred KB against a ~5MB localStorage
 * budget.
 */
const MAX_ENTRIES = 2000;

/** Session-stable clock origin, so deltas within one scenario are readable. */
let originMs = null;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch { /* quota or private mode — diagnostics must never break the app */ }
}

/**
 * Record one observed signal.
 *
 * @param {string} source  where it came from — 'track' | 'recorder' | 'context' | 'page' | 'marker' | 'phase'
 * @param {string} event   the event name exactly as the platform names it
 * @param {object} [detail] any extra state worth knowing at that instant
 */
export function logVoiceSignal(source, event, detail = {}) {
  try {
    const now = Date.now();
    if (originMs == null) originMs = now;
    const entries = read();
    entries.push({
      t: now,
      // Milliseconds since the first signal of this session — what actually
      // answers "did the track mute BEFORE or AFTER the context suspended?",
      // which wall-clock timestamps make you compute by hand.
      dt: now - originMs,
      source,
      event,
      detail,
    });
    write(entries);
  } catch { /* never throw into the audio path */ }
}

/**
 * Start a labelled scenario. Resets the relative clock so each run's deltas
 * read from zero, and writes a divider the matrix can be built from.
 */
export function markScenario(label) {
  originMs = Date.now();
  logVoiceSignal('marker', 'SCENARIO', {
    label,
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    standalone: isStandalone(),
  });
}

/** True when running as an installed PWA rather than a browser tab. */
export function isStandalone() {
  try {
    return Boolean(
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.navigator?.standalone,
    );
  } catch {
    return false;
  }
}

export function getVoiceSignals() {
  return read();
}

export function clearVoiceSignals() {
  originMs = null;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * Flatten to text for pasting into a report. Deliberately plain: this gets
 * copied out of a phone and into a chat window, where JSON would be unreadable.
 */
/** mm:ss.s from a millisecond offset — a timeline is read in seconds, not ms. */
function clock(ms) {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

export function formatVoiceSignals() {
  const entries = read();
  if (!entries.length) return 'No voice signals recorded.';

  const out = [];
  let prevTickDt = null;

  for (const e of entries) {
    const at = clock(e.dt);

    if (e.source === 'marker') {
      out.push(`\n=== ${e.detail?.label ?? 'SCENARIO'} ===`);
      out.push(`    ${e.detail?.ua ?? ''}`);
      out.push(`    standalone=${e.detail?.standalone}`);
      prevTickDt = null;
      continue;
    }

    // ⚠ A RECORDING BOUNDARY IS NOT A SUSPENSION.
    //
    // The heartbeat only runs while recording, so the quiet between one
    // release and the next start is silence by design. Comparing ticks
    // ACROSS that boundary reported ordinary idle time as a frozen page —
    // which the very first real log did, twice, and which would have put
    // two invented suspensions into the matrix. Reset the reference at
    // every boundary so a gap can only ever mean "samples stopped while
    // recording was supposed to be running".
    if (e.source === 'recorder' && (e.event === 'started' || e.event === 'release')) {
      prevTickDt = null;
    }

    if (e.source === 'tick') {
      // A GAP MEANS THE PAGE WAS SUSPENDED. Called out explicitly rather
      // than left for someone to notice by subtracting timestamps — it is
      // the single most diagnostic thing in the log, and the easiest to miss.
      if (prevTickDt !== null && e.dt - prevTickDt > 2000) {
        out.push(`    ~~~~ NO SAMPLES FOR ${((e.dt - prevTickDt) / 1000).toFixed(1)}s — PAGE SUSPENDED ~~~~`);
      }
      prevTickDt = e.dt;
      const d = e.detail || {};
      out.push(
        `${d.changed ? '  * ' : '    '}${at}  ` +
        `vis=${d.vis} ctx=${d.ctx} rec=${d.rec} ` +
        `track=${d.trk}/muted=${d.muted}/en=${d.enabled} ` +
        `focus=${d.focus} act=${d.act}`,
      );
      continue;
    }

    const detail = e.detail && Object.keys(e.detail).length ? ' ' + JSON.stringify(e.detail) : '';
    out.push(`>>> ${at}  ${e.source}/${e.event}${detail}`);
  }

  return out.join('\n');
}

/**
 * THE HEARTBEAT — one sample per second for the life of a recording.
 *
 * ⚠ THE GAPS ARE THE POINT, AS MUCH AS THE VALUES.
 *
 * A discrete event log only shows what the platform chose to announce. This
 * shows what was TRUE every second, whether anything was announced or not —
 * which is the only way to catch the failure actually observed on iOS: the
 * timer counting up while nothing was being captured and no event fired.
 *
 * And when the OS suspends the page, this interval stops running. A HOLE in
 * the timeline is therefore itself a finding: it dates the moment the page
 * was frozen, which no event inside the page could have reported. Do not
 * "fix" a gap by moving this to a worker — the gap is evidence.
 *
 * @param {() => object} sample returns the values to record
 * @param {number} [intervalMs]
 * @returns {() => void} stop
 */
export function startHeartbeat(sample, intervalMs = 1000) {
  let last = null;
  const beat = () => {
    let s;
    try { s = sample(); } catch { return; }
    // Mark samples that DIFFER from the previous one, so a long steady run
    // can be skimmed and the transitions found by eye. The unchanged rows
    // still get written — proving the recorder was alive at that second is
    // the other half of the measurement.
    const key = JSON.stringify(s);
    const changed = last !== null && key !== last;
    last = key;
    logVoiceSignal('tick', 'sample', changed ? { ...s, changed: true } : s);
  };
  beat();                                   // t=0, before anything can go wrong
  const id = setInterval(beat, intervalMs);
  return () => clearInterval(id);
}

/**
 * Attach page-lifecycle observers for the duration of a recording.
 *
 * These are the signals that are NOT part of the audio graph but describe
 * what the OS did to the page around it — which is the half we currently
 * cannot see at all. `freeze`/`resume` in particular are how a mobile
 * browser says it suspended the page entirely, and are prime suspects for
 * "the timer kept counting but nothing was captured".
 *
 * Returns an unsubscribe function. Observation only — none of these do
 * anything but write a line.
 *
 * @param {() => object} [snapshot] called to capture recorder state per event
 */
export function observePageLifecycle(snapshot) {
  if (typeof window === 'undefined') return () => {};

  const take = () => {
    try { return snapshot ? snapshot() : {}; } catch { return {}; }
  };

  const handlers = [
    ['visibilitychange', document, () => logVoiceSignal('page', 'visibilitychange', { state: document.visibilityState, ...take() })],
    ['pagehide',   window, () => logVoiceSignal('page', 'pagehide',   take())],
    ['pageshow',   window, () => logVoiceSignal('page', 'pageshow',   take())],
    ['freeze',     document, () => logVoiceSignal('page', 'freeze',   take())],
    ['resume',     document, () => logVoiceSignal('page', 'resume',   take())],
    ['blur',       window, () => logVoiceSignal('page', 'blur',       take())],
    ['focus',      window, () => logVoiceSignal('page', 'focus',      take())],
  ];

  for (const [name, target, fn] of handlers) {
    try { target.addEventListener(name, fn); } catch { /* unsupported event */ }
  }

  return () => {
    for (const [name, target, fn] of handlers) {
      try { target.removeEventListener(name, fn); } catch { /* ignore */ }
    }
  };
}
