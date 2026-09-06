/**
 * UI SOUND — the tick a reaction makes when it lands.
 *
 * One sound, one code path. This is deliberately not a "sound engine": the
 * product has exactly one UI sound, and building a registry for one entry
 * would be inventing a subsystem to hold a single file.
 *
 * ── WHY WEB AUDIO AND NOT AN <audio> ELEMENT ─────────────────────────
 *
 * `new Audio(url).play()` has to hit the media pipeline on every call, which
 * on a phone is tens of milliseconds and audibly late for something meant to
 * coincide with a finger landing. Decoding once into an AudioBuffer and
 * firing a source node is effectively instant, and can overlap itself if
 * someone taps twice quickly.
 *
 * ── ⚠ SILENT MODE: WHAT IS AND IS NOT POSSIBLE ───────────────────────
 *
 * There is NO web API that reports the state of a phone's silent switch, on
 * any platform. Nothing here can read it, and any claim to "detect silent
 * mode" would be a lie.
 *
 * What is true: on iOS, Web Audio output is routed through a session that
 * the hardware mute switch silences, so a muted iPhone is silent WITHOUT
 * this code doing anything — the platform enforces it. Android and desktop
 * have no equivalent switch; there, the `Message Sounds` setting below is
 * the only control, which is why it exists and why it is honoured before
 * anything is decoded.
 *
 * ── AUTOPLAY ─────────────────────────────────────────────────────────
 *
 * An AudioContext created before a user gesture starts `suspended`. Every
 * call site here is a tap, so resuming on demand is safe — but it must be
 * attempted every time, because the context can be suspended again when the
 * page is backgrounded and would otherwise stay silent for the rest of the
 * session.
 */

/**
 * The sounds, and their levels.
 *
 * Both assets are normalised to the SAME PEAK (0.9) so one level constant
 * means the same thing for both, and neither jumps out against the other.
 * Level lives here rather than baked into the file, so it is tunable without
 * re-encoding — which is exactly what happened when 0.16 turned out to be
 * inaudible.
 *
 * ⚠ Peak-matched is not loudness-matched. The tick is 80ms of shaker (RMS
 * .18); the arrival is 260ms of synth with a decay (RMS .12). They read as
 * comparable because the arrival is longer — if either is ever re-cut,
 * compare RMS, not peak, or one will start to dominate.
 */
const SOUNDS = {
  /* The tick a reaction makes as it lands. ⚠ NOT a notification — feedback for
     something the user just did, which is why it is the shortest thing here. */
  reaction: { src: '/sfx/reaction-land.wav', gain: 0.32 },

  /**
   * ⭐⭐ FIVE NOTIFICATION SOUNDS FOR THIRTY TYPES (owner, 2026-09-06).
   *
   * `lib/notifMeta.jsx` catalogues thirty notification types. They do NOT get
   * thirty sounds: a sound you cannot name the instant you hear it is noise,
   * and thirty of them would teach the ear nothing. They are grouped by what
   * the sound ASKS OF YOU, and `lib/notificationSound.js` owns that map.
   *
   * ⛔ `arrive` KEEPS ITS NAME. It is the message sound and `playMessageArrive`
   * is called from the shell; renaming the key to `talk` would rename a
   * published contract for a tidier table.
   *
   * ── ⚠⚠ THE GAINS ARE RMS-MATCHED, ⛔ NOT PEAK-MATCHED ─────────────────────
   *
   * Every one of these was measured, and they arrived at wildly different
   * levels: rms .058 to .176, a factor of three. Peak says almost nothing —
   * three of them peak at exactly 1.00 and are nowhere near equally loud.
   *
   * Each gain lifts its sample to the SAME effective loudness the shipping
   * reaction already has (rms .176 × 0.32 = .0576), then is clamped so
   * peak × gain never exceeds 0.98 and nothing can clip.
   *
   *   file              peak    rms    gain
   *   reaction-land     0.90   .176    0.32
   *   notif-talk        0.82   .132    0.44
   *   notif-ask         0.82   .114    0.50
   *   notif-yes         1.00   .082    0.70
   *   notif-no          1.00   .058    0.98   ← at the clamp; cannot go louder
   *   notif-moved       1.00   .116    0.50
   *
   * ⚠ `notif-no` SITS ON THE CEILING. Its rms is the lowest here and its peak
   * is already full scale, so if it ever reads as too quiet the fix is a
   * shorter file, ⛔ not a bigger number — there is no headroom left.
   *
   * ⚠ If any file is re-cut, RE-MEASURE and recompute. A replacement at the
   * same peak will not be at the same loudness.
   */
  arrive:   { src: '/sfx/notif-talk.wav',  gain: 0.44 },
  ask:      { src: '/sfx/notif-ask.wav',   gain: 0.50 },
  yes:      { src: '/sfx/notif-yes.wav',   gain: 0.70 },
  no:       { src: '/sfx/notif-no.wav',    gain: 0.98 },
  moved:    { src: '/sfx/notif-moved.wav', gain: 0.50 },
};


const SETTINGS_KEY = 'yp_settings';
const SOUND_FIELD  = 'messageSounds';

let ctx = null;
const buffers = new Map();   // name → AudioBuffer
const loading = new Map();   // name → Promise

/** Message sounds are ON by default; the setting stores only a refusal. */
export function messageSoundsEnabled() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return s?.[SOUND_FIELD] !== false;
  } catch {
    return true;
  }
}

export function setMessageSoundsEnabled(on) {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    s[SOUND_FIELD] = Boolean(on);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch { /* private mode — the sound simply stays at its default */ }
}

function audioContext() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try { ctx = new Ctx(); } catch { return null; }
  return ctx;
}

/**
 * ⚠ iOS WILL NOT PLAY ANYTHING UNTIL A CONTEXT IS UNLOCKED INSIDE A REAL
 * USER GESTURE. This is why sound worked on desktop and was silent on a
 * phone.
 *
 * Two separate mistakes were being made:
 *
 *   1. The context was created during app start — no gesture — so it began
 *      `suspended` and stayed that way.
 *   2. `resume()` is ASYNCHRONOUS, and playback started immediately after
 *      calling it. On desktop the context is usually already running so the
 *      race is invisible; on iOS the source starts while still suspended and
 *      produces nothing, every time.
 *
 * The fix is the standard unlock: on the FIRST real gesture, resume and play
 * one silent sample. iOS marks the context as user-activated and everything
 * after it is free to play. Bound with `once` and on three event types
 * because a phone may never fire `click` before a `touchstart` that matters.
 */
let unlocked = false;

export function armAudioUnlock() {
  if (typeof window === 'undefined' || unlocked) return;

  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    const c = audioContext();
    if (!c) return;
    try {
      c.resume().catch(() => {});
      // One sample of silence. The point is not the sound — it is that a
      // source has been started from within a gesture, which is what iOS
      // actually checks.
      const s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, 22050);
      s.connect(c.destination);
      s.start(0);
    } catch { /* nothing to be done; sound simply stays off */ }
  };

  for (const ev of ['pointerdown', 'touchstart', 'keydown']) {
    window.addEventListener(ev, unlock, { once: true, passive: true });
  }
}

/**
 * Fetch and decode ahead of the first tap.
 *
 * Called at app start. Without it the FIRST reaction of a session would
 * wait on a network round trip and land silently — the one instance where
 * the sound matters most, because it is the one that tells the user the
 * interaction has a sound at all.
 *
 * Failure is silent by design: a missing tick must never surface as an error
 * or block a reaction from being written.
 */
export function preloadUiSounds() {
  if (typeof window === 'undefined' || !messageSoundsEnabled()) return null;
  return Promise.all(Object.keys(SOUNDS).map(load));
}

function load(name) {
  if (buffers.has(name)) return Promise.resolve(buffers.get(name));
  if (loading.has(name)) return loading.get(name);

  const def = SOUNDS[name];
  if (!def) return Promise.resolve(null);

  const p = (async () => {
    try {
      const res = await fetch(def.src);
      if (!res.ok) return null;
      const bytes = await res.arrayBuffer();
      const c = audioContext();
      if (!c) return null;
      const decoded = await c.decodeAudioData(bytes);
      buffers.set(name, decoded);
      return decoded;
    } catch {
      return null;
    } finally {
      loading.delete(name);
    }
  })();

  loading.set(name, p);
  return p;
}

/**
 * Play the landing tick. Safe to call from anywhere; does nothing at all if
 * sounds are off, the buffer is not ready, or audio is unavailable.
 *
 * Never awaited by a caller: a reaction must be written whether or not a
 * sound plays, so this is fire-and-forget by contract.
 */
function play(name) {
  if (!messageSoundsEnabled()) return;

  const def = SOUNDS[name];
  const c = audioContext();
  const buffer = buffers.get(name);

  if (!c || !def || !buffer) {
    // Not decoded yet — start it, but do not try to play late. A sound that
    // arrives 300ms after the event is worse than no sound, because it reads
    // as the app lagging rather than as feedback.
    load(name);
    return;
  }

  const fire = () => {
    try {
      const src = c.createBufferSource();
      src.buffer = buffer;
      const gain = c.createGain();
      gain.gain.value = def.gain;
      src.connect(gain).connect(c.destination);
      src.start(0);
    } catch { /* an audio failure must never break an interaction */ }
  };

  // ⚠ START ONLY ONCE THE CONTEXT IS ACTUALLY RUNNING.
  //
  // This used to call resume() and then start() on the next line. resume()
  // is async, so on iOS the source started while the context was still
  // suspended and produced silence — the desktop/phone split that made this
  // look like a device problem rather than a code one.
  //
  // A context can also be suspended AGAIN after the page is backgrounded, so
  // this is checked on every play rather than trusted from startup.
  if (c.state === 'suspended') c.resume().then(fire).catch(() => {});
  else fire();
}

/** The tick a reaction makes as it lands. */
export function playReactionLand() { play('reaction'); }

/**
 * A message arriving while the app is OPEN.
 *
 * ⚠ THIS IS NOT THE PUSH NOTIFICATION SOUND, AND CANNOT BE.
 *
 * When the app is closed, the notification is drawn by the operating system
 * from the service worker, and the OS chooses the sound. The Web Notification
 * API's `sound` property was removed from the specification and is supported
 * by no major browser — there is no way for web code to set the sound an
 * OS-level notification makes. That is a platform limit, not an omission
 * here.
 *
 * What this covers is the case that IS ours: the app is on screen, a message
 * arrives over realtime, and no OS notification is shown at all.
 */
export function playMessageArrive() { play('arrive'); }

/**
 * ⭐ The four non-message notification sounds. `arrive` has its own exported
 * function above because the shell has always called it by name.
 *
 * ⛔ FIRE-AND-FORGET, like every other sound here. A notification is written,
 * badged and listed whether or not anything is audible.
 */
export function playNotificationSound(key) {
  if (!key || key === 'arrive') return;   // messages go through playMessageArrive
  if (!SOUNDS[key]) return;
  play(key);
}
