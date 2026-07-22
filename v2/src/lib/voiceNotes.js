import { supabase } from './supabase';
import { sendMessage } from './messaging';
import { computePeaks } from './voicePeaks';

/**
 * VOICE NOTES — recording, storage and playback URLs.
 *
 * A voice note is a message with `kind = 'voice'`. It is not a special case,
 * and nothing in the messaging layer knows it exists: it sends through
 * `sendMessage` like anything else, and renders through the registry like
 * anything else. This module owns only the parts text does not have — capture,
 * upload, and getting a playable URL back out of a private bucket.
 *
 * ── THE PAYLOAD STORES A PATH, NEVER A URL ───────────────────────────
 *
 * M9b's bucket is private, so playback needs a SIGNED url — and a signed url
 * expires. Writing one into `payload` would store a value that is correct for
 * an hour and then permanently wrong, in a row that is never updated again.
 * The message would play on the day it was sent and be broken by morning.
 *
 * So the payload holds the storage PATH, and a signed url is minted on demand
 * at playback. The path is stable forever; the url is derived and disposable.
 *
 * ── body IS NOT DECORATION ───────────────────────────────────────────
 *
 * Every voice note writes 'Voice message' to `body`. M9a keeps that column
 * non-blank for every kind because three surfaces only ever see text: an
 * inbox preview, a push notification, and a screen reader. A voice note with
 * an empty body is silent in all three.
 */

/** M9b. Private; reads are signed, writes are participant-scoped. */
const BUCKET = 'voice-notes';

/**
 * How long a playback url lives. Short on purpose — the url is the only thing
 * standing between private conversation audio and anyone it gets pasted to,
 * and it is cheap to mint another.
 */
const SIGNED_URL_TTL_SECONDS = 3600;

/** What `body` says for a voice note. See header. */
export const VOICE_FALLBACK_BODY = 'Voice message';

/**
 * m:ss. Voice notes are short; anything needing hours is not this feature.
 *
 * Lives here rather than beside the player so it can be tested — a component
 * file cannot be imported by `node --test`, and a duration that renders
 * "0:07" as "0:7" is exactly the kind of thing worth a test.
 */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * ══ §6.1 AMENDMENT — iOS TAKES APPLE'S SPEECH PROCESSING (2026-07-22) ══
 *
 * `C20` below is unchanged for every other platform and its reasoning still
 * holds there. On iOS it is now measured to be actively harmful, and the
 * evidence is in the `C21` readback rather than in anyone's ears:
 *
 *   · iPhone 14 Pro and a Galaxy recorded the same words seconds apart. Both
 *     produced Opus, 48 kHz, 32 kbps. IDENTICAL settings, and the iPhone note
 *     was rated 1/5 against the Galaxy's 5/5 — quiet, muffled, and worse than
 *     WhatsApp from the same handset.
 *   · So the fault was never the codec, the container, the bitrate, the sample
 *     rate, or the WebAudio downmix — each was ruled out by measurement, not by
 *     argument. What differs is the analogue capture path.
 *   · The readback also shows `auto_gain: null` and `noise_suppression: null`
 *     on iOS while `echo_cancellation: false` comes back populated. Safari
 *     SUPPORTS the echo constraint and IGNORES the other two — so `C20` was
 *     only ever half-applied there, and `echoCancellation` is the switch that
 *     actually moves capture off Apple's voice-processing unit.
 *
 * ── WHY THE ANSWER IS TO STOP OPTING OUT, NOT TO COMPENSATE ──────────
 *
 * The alternative considered was hand-rolled gain: keep the raw path and lift
 * the level ourselves. Rejected. It has to survive whispers, shouting, and
 * every microphone in the wild without pumping or clipping, which is a decade
 * of tuning that Apple has already done and we would be guessing at.
 *
 * ── WHAT §6.1 WAS PROTECTING, AND WHY IT SURVIVES ────────────────────
 *
 * §6.1 protects venue ambience: these users are in rooms where the room is
 * sometimes the point. That is real, and it is now understood to be a SEPARATE
 * FEATURE — a "record the room" mode someone deliberately chooses — rather than
 * something to defend by degrading every message. The actual traffic is "I'll
 * take the 9:30 slot" and "running ten minutes late": those are voice
 * COMMUNICATIONS, and the promoter needs the words, not the crowd.
 *
 * ⚠ This does NOT license enabling DSP anywhere else. Android and desktop keep
 * `C20` exactly as ratified, because there the raw path measures well.
 */

/**
 * THE CAPTURE PROFILE — `C20`, and the single largest quality decision here.
 *
 * `getUserMedia` defaults every one of these to TRUE, and those defaults are
 * tuned for telephony: aggressive gain riding, noise gating, and effective
 * bandwidth at or below 16 kHz. Correct for a noisy phone call, destructive for
 * a voice message — it pumps, swallows room tone, and mangles anything musical
 * behind the speaker. Communication v1.0 §6.1 records that this matters MORE
 * than the codec choice, and that it is written as architecture precisely
 * because it looks like a detail and gets defaulted away.
 *
 * The cost is accepted deliberately (§6.1): without noise suppression, a noisy
 * room sounds noisy. These users are in venues, and the room is often the point.
 *
 * Flipping any of these to `true` is a change to ratified architecture, not a
 * tuning decision.
 */
const CAPTURE_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl:  false,
  channelCount:     1,       // §6.3 — voice is not stereo content
  sampleRate:       48000,   // preferred; see SAMPLE RATE below
};

/**
 * The same profile, demanded rather than requested.
 *
 * Plain values are ADVISORY — Chrome accepted `channelCount: 1` and handed back
 * a stereo track anyway, measured on a real device. At ~32 kbps that is not
 * cosmetic: Opus spends part of the budget coding a stereo image of one voice,
 * so the bits `C20` was protecting go to a channel that carries no information.
 *
 * `exact` makes them mandatory — the request fails rather than being silently
 * downgraded. DSP is included because getting it back ON is the one failure
 * `C20` exists to prevent, and it must never happen quietly.
 *
 * NOT sampleRate. `exact: 48000` fails outright on a device whose microphone
 * runs at 44.1 kHz, which is most of them — and it would buy nothing, because
 * **Opus has no rate other than 48 kHz**: it is defined at 48 k and the encoder
 * resamples whatever it is given. The stored file is full-band 48 kHz Opus
 * either way. `C20`'s target is telephony bandwidth limiting (16 kHz and
 * below); a 44.1 kHz capture track is not that.
 */
const EXACT_CAPTURE_CONSTRAINTS = {
  echoCancellation: { exact: false },
  noiseSuppression: { exact: false },
  autoGainControl:  { exact: false },
  channelCount:     { exact: 1 },
  sampleRate:       48000,   // advisory — see above
};

/**
 * iOS. §6.1 AMENDMENT — see the block above `C20`.
 *
 * ⚠ THE POINT IS THE OMISSION, AND IT IS NOW TOTAL. Literally `true` — every
 * constraint surrendered, the platform's own default taken whole. Naming a
 * constraint asks for SOME configuration that satisfies it; naming nothing is
 * the only way to ask for the one Apple tuned, which is what iMessage and
 * WhatsApp effectively get and the thing actually being copied.
 *
 * ── WHY §6.3 AND §6.2's HINTS WENT TOO ───────────────────────────────
 *
 * `channelCount: 1` and `sampleRate: 48000` survived the first pass on the
 * grounds that they are not `C20` and do not touch the processing path. That
 * was reasoning, not measurement, and the owner's next listen said "better, but
 * starting to get a bit hissy" — better because Apple's processing was finally
 * on, hissy because something was still not the plain path.
 *
 * A rate hint is a plausible culprit: iOS's voice-processing unit runs at its
 * own rate, so asking for 48 kHz can force a resample or decline the unit
 * outright. Neither hint bought anything real — iOS reports mono already, and
 * Opus is defined at 48 kHz and resamples whatever it is handed, so the stored
 * file is 48 kHz regardless of what the microphone track says.
 *
 * The lesson of this whole investigation, twice over: every time we described
 * the capture we wanted, iOS gave us something worse than if we had not asked.
 *
 * ── THE ONE NAMED CONSTRAINT, AND WHY IT IS PROBABLY A NO-OP ─────────
 *
 * `noiseSuppression: true` is here at the owner's instruction, to chase the
 * remaining hiss. It is a deliberate exception to everything above and it is
 * expected NOT to work, for two reasons that the readback already gives:
 *
 *   · Safari does not appear to support the constraint. `C21` reports
 *     `noise_suppression: null` and `auto_gain: null` on iOS while
 *     `echo_cancellation` comes back populated — the signature of a user agent
 *     silently ignoring what it cannot do.
 *   · Noise suppression is almost certainly ON ALREADY. `echoCancellation` is
 *     the master switch for Apple's voice-processing unit and NR and AGC come
 *     bundled with it; letting it default is what turned the bundle on, and is
 *     why the note improved at all. There is no separate switch left.
 *
 * So the likely cause of the hiss is not absent NR. It is the gain doing its
 * job: a quiet room turned up is a louder quiet room, and its noise floor
 * becomes audible. Apple's NR is already working against that.
 *
 * ⚠ THIS CHANGE IS THEREFORE A MEASUREMENT. Re-run the `capture` query after a
 * fresh iOS note: if `noise_suppression` comes back `true`, Safari honours the
 * constraint and this was worth doing. If it is still `null`, the constraint is
 * ignored, the hypothesis is dead, and this line should be reverted to `true`
 * rather than left as decoration implying a control we do not have.
 *
 * Exported so the rule is testable without a device or a fake navigator.
 */
export const IOS_CAPTURE_CONSTRAINTS = { noiseSuppression: true };

/**
 * Open the microphone on the ratified profile, demanding it first.
 *
 * Falls back to the advisory form ONLY on OverconstrainedError — a device that
 * genuinely cannot deliver the profile. Every other error (denial, no device)
 * propagates, because retrying a permission refusal just prompts twice.
 *
 * The fallback still records: `C21`'s readback means a note captured in stereo,
 * or with DSP forced on, says so in its own payload rather than being
 * indistinguishable from a compliant one.
 */
async function openMicrophone() {
  if (isIOS()) {
    return await navigator.mediaDevices.getUserMedia({ audio: IOS_CAPTURE_CONSTRAINTS });
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: EXACT_CAPTURE_CONSTRAINTS });
  } catch (err) {
    if (err?.name !== 'OverconstrainedError') throw err;
    return await navigator.mediaDevices.getUserMedia({ audio: CAPTURE_CONSTRAINTS });
  }
}

/**
 * Force the capture to mono, rather than asking for it.
 *
 * Measured on a real device: Chrome accepts `channelCount: { exact: 1 }`
 * WITHOUT raising, and hands back a stereo track anyway. That is spec-correct —
 * a user agent that does not *support* a constraint ignores it silently, and
 * only an unsatisfiable *supported* constraint raises OverconstrainedError. So
 * there is no version of asking that gets mono here, and no error to catch.
 *
 * Routing the track through a one-channel destination node downmixes it
 * deterministically, on every browser, regardless of what the device reports.
 *
 * ── IS THIS WORTH AN AUDIOCONTEXT IN THE RECORD PATH? ────────────────
 *
 * On the measured device, nearly nothing: a mono microphone exposed as
 * dual-channel produces identical L and R, Opus codes the side channel as
 * near-silence, and the result was 25 kbps either way. The reason to do it
 * anyway is that this is a venue app — a stereo interface or a stereo mic
 * produces two genuinely different channels, and then §6.3's "stereo doubles
 * storage for no perceptual gain" is a real cost paid by every listener.
 *
 * Guaranteeing it costs one node and one context. Hoping for it costs nothing
 * until the day someone plugs in an interface.
 *
 * Returns the ORIGINAL stream unchanged if WebAudio is unavailable — a
 * recording in stereo is far better than no recording, and `C21`'s readback
 * records which one happened.
 */
/**
 * Is this an iOS device — including an iPad pretending to be a Mac?
 *
 * ⚠ A UA SNIFF, AND IT SHOULD BE READ AS ONE. Nothing else identifies the fault
 * it guards: iOS's voice-processing microphone path is not exposed as a
 * capability, produces no error, and reports the same track settings as a good
 * capture. There is nothing to feature-detect, so the alternative to sniffing is
 * not a cleaner check — it is shipping degraded audio to every iPhone.
 *
 * iPadOS 13+ reports a desktop Mac UA, so `MacIntel` WITH touch points is the
 * only reliable tell for an iPad; a real Mac has no touch and must not match,
 * because Safari on macOS does not have this fault.
 *
 * Exported so the platform rule is testable without a device.
 */
export function isIOS(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav) return false;
  const ua = String(nav.userAgent ?? '');
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
}

function forceMono(stream) {
  const Ctx = typeof window !== 'undefined' && (window.AudioContext ?? window.webkitAudioContext);
  if (!Ctx) return { stream, context: null, downmixed: false };

  try {
    const context = new Ctx();
    const source  = context.createMediaStreamSource(stream);
    // channelCount 1 + explicit mode is what performs the downmix; the default
    // 'max' mode would simply follow the source and stay stereo.
    const dest    = context.createMediaStreamDestination();
    dest.channelCount          = 1;
    dest.channelCountMode      = 'explicit';
    dest.channelInterpretation = 'speakers';   // proper L/R fold, not L-only
    source.connect(dest);
    return { stream: dest.stream, context, downmixed: true };
  } catch {
    return { stream, context: null, downmixed: false };
  }
}

/**
 * §6.2 — Opus VBR 32–48 kbps at 48 kHz mono. TOP of the ratified range.
 *
 * Was 32000, the bottom, on the reasoning that speech is transparent well below
 * the top and the saving is paid by every listener. Moved to the top 2026-07-22
 * after a real-device comparison: an owner rated a 32 kbps Galaxy note 5/5 and
 * the iPhone equivalent 1/5, and while the gap was the capture path rather than
 * the bitrate, "transparent" was a claim nobody had actually listened to. At
 * these lengths the difference is a few kilobytes a note.
 *
 * No amendment needed — 48 was always inside the ratified range.
 *
 * Ignored by browsers that will not honour it, which is why the NEGOTIATED
 * values are read back and persisted rather than assumed (`C21`).
 */
const TARGET_BITS_PER_SECOND = 48000;

/**
 * ⚠ 32 kbps IS AN OPUS NUMBER, AND ONLY AN OPUS NUMBER.
 *
 * §6.2 ratified it against Opus, where 48 kHz mono speech at 32 kbps is very
 * close to transparent. Safari cannot record Opus — it produces AAC-LC in MP4 —
 * and AAC-LC at 32 kbps mono is audibly poor: swimmy, with a metallic edge on
 * sibilants. Applying one number to both codecs was reading the constant as
 * "the quality we agreed on" when it is really "the rate at which THAT codec
 * reaches it".
 *
 * Found on an iPhone 14 Pro, 2026-07-22: recording worked and sounded bad, on
 * hardware whose microphone is not the problem.
 *
 * 64 kbps is the equivalent operating point for AAC-LC mono speech. It is still
 * well under half of what an uncompressed note would cost, and it is paid only
 * by devices that cannot give us Opus in the first place.
 *
 * Keyed on the BASE type, because the negotiated string carries parameters and
 * `audio/mp4;codecs=mp4a.40.2` must resolve the same as `audio/mp4`.
 */
const BITS_PER_SECOND_BY_TYPE = {
  'audio/mp4':  64000,   // AAC-LC — needs more than Opus for the same bar
  'audio/mpeg': 64000,   // MP3, if a browser ever offers it
};

/** The rate this codec needs to hit §6.2's quality bar, not a single constant. */
export function bitrateFor(mimeType) {
  return BITS_PER_SECOND_BY_TYPE[baseMimeType(mimeType)] ?? TARGET_BITS_PER_SECOND;
}

/**
 * Preferred capture format, best first.
 *
 * `C21` — record natively, store the source, never transcode. Every re-encode
 * is generational loss, so the platform stores whatever the device produced:
 * Opus where available, AAC-LC where not. Chromium and Firefox give Opus in
 * WebM or Ogg; Safari's recorder produces AAC in MP4 and cannot make WebM at
 * all. This list is a negotiation, not a preference.
 *
 * Every entry must also appear in M9b's `allowed_mime_types`, or the upload is
 * refused by the bucket after a successful recording — the worst possible
 * moment to find out.
 *
 * ⚠ §6.2 requires the recording AND PLAYBACK support matrix to be re-measured
 * rather than assumed from a document's date. The open item is whether an
 * Android-recorded WebM/Opus note plays in an `<audio>` element on iOS Safari;
 * if it does not, Ogg/Opus moves above WebM here. `D6`.
 */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
];

/** Can this browser record at all, in a format the bucket accepts? */
export function canRecordVoice() {
  return Boolean(
    typeof MediaRecorder !== 'undefined' &&
    navigator?.mediaDevices?.getUserMedia &&
    pickMimeType(),
  );
}

/** The first supported format, or null when the browser can do none of them. */
export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return PREFERRED_MIME_TYPES.find(t => MediaRecorder.isTypeSupported?.(t)) ?? null;
}

/**
 * The bucket's `allowed_mime_types` has no parameters — 'audio/webm', not
 * 'audio/webm;codecs=opus'. MediaRecorder reports the full string, so the
 * parameters must be stripped before upload or storage rejects a file it
 * actually allows.
 */
export function baseMimeType(mimeType) {
  return String(mimeType ?? '').split(';')[0].trim();
}

/**
 * Start recording. Returns a handle with stop() and cancel().
 *
 * The caller owns the lifetime, because the UI does: a press-and-hold gesture
 * ends on pointerup, on pointercancel, and on the component unmounting
 * mid-press. All three must release the microphone, so BOTH stop() and
 * cancel() stop the tracks — a recorder that only releases on the happy path
 * leaves the browser's recording indicator lit after the user let go.
 */
export async function startRecording() {
  const mimeType = pickMimeType();
  if (!mimeType) {
    throw new Error('This browser cannot record audio in a supported format');
  }

  // Throws on denial. Left to the caller: "you declined the microphone" and
  // "your browser cannot record" need different words, and only the caller
  // knows where to put them.
  //
  // Demands the profile, falls back only if the device genuinely cannot meet
  // it. Even then the result is read back rather than assumed (`C21`) — a
  // browser can still hand back something other than what it agreed to.
  const stream = await openMicrophone();

  // Settings come from the ORIGINAL microphone track — the downmix destination
  // below is a synthetic track that knows nothing about echo cancellation or
  // the device's sample rate. Reading them off the wrong track would report a
  // DSP state that was never asked of the hardware.
  const settings = stream.getAudioTracks()[0]?.getSettings?.() ?? {};

  const { stream: recordStream, context: mixContext, downmixed } = forceMono(stream);

  /**
   * ⚠ AN AUDIOCONTEXT DOES NOT NECESSARILY START RUNNING.
   *
   * On iOS Safari a new context begins SUSPENDED, and a suspended context does
   * not process its graph. Everything below hangs off this one: the mono
   * destination that MediaRecorder is about to record, and the analyser that
   * drives the live waveform. So a context left suspended costs the meter AND
   * degrades the audio — two symptoms, one cause, and neither of them looks
   * like "the AudioContext never started".
   *
   * Reported from an iPhone 14 Pro, 2026-07-22: microphone appeared, recording
   * functioned, no waveform while recording, and the result sounded poor.
   *
   * Chromium resumes on its own once a gesture has occurred, which is exactly
   * why this survived every desktop and Android test. `startRecording` is
   * always reached from a tap, so the gesture requirement is already satisfied
   * — the resume simply has to be ASKED for.
   *
   * Awaited before `recorder.start()`, deliberately. Starting into a context
   * that has not finished resuming records the beginning of the note through a
   * graph that is not running yet, which clips the first word — the failure
   * mode most likely to be blamed on the user for talking too early.
   */
  if (mixContext?.state === 'suspended') {
    // Never fatal. A recording through the original stream is worth far more
    // than no recording, and `C21`'s readback records what actually happened.
    try { await mixContext.resume(); } catch { /* fall through to the check below */ }
  }

  /**
   * ⚠ IF THE GRAPH IS STILL NOT RUNNING, DO NOT RECORD THROUGH IT.
   *
   * `forceMono` is an optimisation — it guarantees §6.3's mono rather than
   * hoping for it. A suspended context turns that optimisation into SILENCE,
   * because `dest.stream` carries whatever the graph produced and a stopped
   * graph produces nothing. Stereo audio is a cost; a silent voice note is a
   * lost message, and the sender has no way to tell the difference until
   * someone tells them the note was empty.
   *
   * So the fallback is the microphone's own stream, unprocessed. `downmixed`
   * goes false with it, which keeps `C21`'s readback honest instead of claiming
   * a downmix that did not survive.
   */
  const contextRunning = !mixContext || mixContext.state === 'running';

  /**
   * ⚠ ON iOS, DO NOT RECORD THROUGH THE WEBAUDIO GRAPH.
   *
   * Measured on an iPhone 14 Pro, 2026-07-22, against a Galaxy recording of the
   * same words: the iOS note is quiet and muffled, and worse than a WhatsApp
   * note from the same handset. The Android note through the identical code path
   * sounds excellent, and both files play back correctly on both devices — so
   * this is Safari's CAPTURE, not the codec, the container or the player.
   *
   * "Quiet and muffled" is the signature of iOS's voice-processing microphone
   * path — the narrow-band, gain-managed mode intended for calls. Routing
   * capture through `MediaStreamAudioDestinationNode` is a known way to land in
   * it, and a native app like WhatsApp does not because it sets its own audio
   * session. A bitrate fault sounds different: watery or metallic, never quiet.
   *
   * So iOS records the microphone's own stream, untouched. The cost is §6.3's
   * mono GUARANTEE on that platform — but iOS reports a mono track to begin
   * with, so what is given up is insurance against a case iOS does not present,
   * paid for in the quality of every note. `C21`'s readback reports
   * `downmixed: false` honestly rather than claiming a downmix that was skipped.
   *
   * ── THE ANALYSER DELIBERATELY STAYS ─────────────────────────────────
   *
   * The context is still created and still resumed, so the live meter survives
   * — and this is what makes the change a TEST rather than a guess. If the
   * audio improves, the destination node was the fault. If it does not, merely
   * HAVING a context is enough to flip the audio session, the meter cannot
   * coexist with good audio on iOS, and that is a real trade to put to the
   * owner rather than one to make quietly here.
   */
  const bypassGraph = isIOS();

  const safeStream      = (contextRunning && !bypassGraph) ? recordStream : stream;
  const reallyDownmixed = downmixed && contextRunning && !bypassGraph;

  /**
   * LIVE LEVEL, for the recording waveform in the composer.
   *
   * Taps the AudioContext the downmix already created rather than opening a
   * second one — contexts are limited, and a recorder that needed two would
   * halve how many can exist.
   *
   * An AnalyserNode is read-only and sits on a branch of the graph, so it
   * cannot colour what is recorded. `fftSize` is small because this drives ~17
   * bars a second, not a spectrum: 512 samples is plenty for an amplitude
   * reading and costs almost nothing.
   *
   * Returns null when there is no context (WebAudio unavailable), and the UI
   * simply shows no live waveform — recording still works.
   */
  let analyser = null;
  let levelBuffer = null;
  if (mixContext) {
    try {
      analyser = mixContext.createAnalyser();
      analyser.fftSize = 512;
      mixContext.createMediaStreamSource(stream).connect(analyser);
      levelBuffer = new Float32Array(analyser.fftSize);
    } catch {
      analyser = null;   // metering is decoration; never fail a recording for it
    }
  }

  const recorder = new MediaRecorder(safeStream, {
    mimeType,
    audioBitsPerSecond: bitrateFor(mimeType),
  });
  const chunks = [];
  recorder.addEventListener('dataavailable', e => {
    if (e.data?.size > 0) chunks.push(e.data);
  });
  recorder.start();

  const startedAt = Date.now();
  let released = false;


  /**
   * Idempotent: stop() then unmount must not release twice.
   *
   * Releases THREE things now, not one — the microphone, the synthetic downmix
   * track, and the AudioContext. Missing the first leaves the browser's
   * recording indicator lit; missing the third leaks a context per recording,
   * and contexts are limited, so that failure only appears after heavy use and
   * then refuses to record at all.
   */
  function release() {
    if (released) return;
    released = true;
    stream.getTracks().forEach(t => t.stop());
    if (downmixed) recordStream.getTracks().forEach(t => t.stop());
    mixContext?.close?.().catch(() => { /* already closed */ });
  }

  return {
    mimeType,

    /** Elapsed ms, for a live duration readout while held. */
    elapsedMs: () => Date.now() - startedAt,

    /**
     * Current loudness, 0..1, for the live recording waveform.
     *
     * RMS rather than peak, for the same reason the stored peaks are RMS: peak
     * follows clicks, RMS follows how loud it actually sounds. Returns 0 when
     * there is no analyser, which draws a flat line rather than throwing.
     *
     * Scaled by 2.2 because speech RMS sits low — around .1 to .25 — and an
     * unscaled meter would sit flat against the bottom of the composer for a
     * normal voice. Clamped so a shout cannot overflow the bar.
     */
    level: () => {
      if (!analyser || !levelBuffer) return 0;
      analyser.getFloatTimeDomainData(levelBuffer);
      let sum = 0;
      for (let i = 0; i < levelBuffer.length; i++) sum += levelBuffer[i] * levelBuffer[i];
      return Math.min(1, Math.sqrt(sum / levelBuffer.length) * 2.2);
    },

    /** Finish and return the audio. Resolves after the recorder flushes. */
    stop: () => new Promise((resolve, reject) => {
      if (recorder.state === 'inactive') {
        release();
        reject(new Error('Recording already stopped'));
        return;
      }
      recorder.addEventListener('stop', () => {
        release();
        // Blob type from the recorder, not from `mimeType` — they can differ,
        // and the blob's own type is what actually gets uploaded.
        const blob = new Blob(chunks, { type: baseMimeType(recorder.mimeType || mimeType) });
        resolve({
          blob,
          durationMs: Date.now() - startedAt,
          // What was negotiated, for the payload. See `C21` above.
          capture: {
            mime:        recorder.mimeType || mimeType,
            bitrate:     recorder.audioBitsPerSecond ?? null,
            sample_rate: settings.sampleRate ?? null,
            // What was RECORDED, which after a downmix is not what the device
            // reported. `source_channels` keeps the device's own answer so a
            // support-matrix question can still be asked of the data.
            channels:        reallyDownmixed ? 1 : (settings.channelCount ?? null),
            source_channels: settings.channelCount ?? null,
            downmixed: reallyDownmixed,
            // `D6` diagnostics: which of the two iOS faults, if either, was hit.
            context_state: mixContext?.state ?? null,
            dsp: {
              echo_cancellation: settings.echoCancellation ?? null,
              noise_suppression: settings.noiseSuppression ?? null,
              auto_gain:         settings.autoGainControl ?? null,
            },
          },
        });
      }, { once: true });
      recorder.addEventListener('error', e => { release(); reject(e.error ?? e); }, { once: true });
      recorder.stop();
    }),

    /** Abandon it. Releases the microphone and keeps nothing. */
    cancel: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      release();
      chunks.length = 0;
    },
  };
}

/** File extension matching a mime type, so the object is recognisable in the bucket. */
function extensionFor(mimeType) {
  switch (baseMimeType(mimeType)) {
    case 'audio/webm': return 'webm';
    case 'audio/mp4':  return 'm4a';
    case 'audio/mpeg': return 'mp3';
    case 'audio/ogg':  return 'ogg';
    default:           return 'bin';
  }
}

/**
 * Upload audio for a conversation and return its storage path.
 *
 * The path's FIRST SEGMENT IS THE CONVERSATION ID and that is not cosmetic:
 * M9b's policies read it to decide who may write and who may read. A path in
 * any other shape is refused by the bucket rather than stored somewhere
 * unreachable.
 *
 * The filename is random rather than the message id, because the row does not
 * exist yet — its payload has to point at something. A failed insert after a
 * successful upload therefore orphans the object; that is the deliberate
 * choice, because the alternative is a row pointing at audio that may not be
 * there.
 */
export async function uploadVoiceNote({ conversationId, blob } = {}) {
  if (!conversationId) return { path: null, error: { message: 'uploadVoiceNote: conversationId is required' } };
  if (!blob?.size)     return { path: null, error: { message: 'uploadVoiceNote: nothing was recorded' } };

  const path = `${conversationId}/${crypto.randomUUID()}.${extensionFor(blob.type)}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: baseMimeType(blob.type),
    // No upsert. A random filename cannot collide, and allowing overwrite
    // would let a second upload replace audio a message already points at —
    // editing a sent message through the back door.
    upsert: false,
  });

  return error ? { path: null, error } : { path, error: null };
}

/**
 * A playable url for a stored voice note.
 *
 * Minted per playback and never persisted. RLS decides here, not the caller:
 * a non-participant's request fails at the storage API, so there is no access
 * check in this function to disagree with M9b's policy.
 */
export async function signedUrlFor(path, expiresIn = SIGNED_URL_TTL_SECONDS) {
  if (!path) return { url: null, error: { message: 'signedUrlFor: path is required' } };

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  return error ? { url: null, error } : { url: data?.signedUrl ?? null, error: null };
}

/**
 * Record → upload → send, as one message.
 *
 * Upload FIRST, insert second. The reverse would put a row in the thread
 * pointing at audio that might never arrive, and a message that renders as a
 * broken player is worse than one that was never sent — the sender believes it
 * went.
 */
export async function sendVoiceNote({ conversationId, fromProfileId, blob, durationMs, capture, peaks: precomputed } = {}) {
  // §6.6's pipeline order: record → compute peaks → upload → message.
  //
  // Peaks are computed BEFORE the upload, not after, so a peak failure costs
  // nothing: at this point no object exists and no row exists, so degrading to
  // a note without a waveform is free. Computing after the upload would mean a
  // decorative step could fail with an orphan already written.
  // Accepts peaks the caller already computed. The optimistic bubble needs them
  // before this is ever called — a placeholder without peaks renders a collapsed
  // waveform, which is what an iPhone 14 Pro showed on 2026-07-22 — and decoding
  // the same blob twice to draw the same picture is pure waste.
  const peaks = precomputed ?? await computePeaks(blob);

  const { path, error: uploadError } = await uploadVoiceNote({ conversationId, blob });
  if (uploadError) return { message: null, error: uploadError };

  return sendMessage({
    conversationId,
    fromProfileId,
    body: VOICE_FALLBACK_BODY,   // the three text-only surfaces. See header.
    kind: 'voice',
    payload: {
      path,                                        // stable; the url is derived
      duration_ms: Math.max(0, Math.round(durationMs ?? 0)),
      mime: baseMimeType(blob?.type),
      // §6.4 — the waveform, computed once. Omitted entirely when it could not
      // be computed, so `peaks` is absent rather than null: the renderer's test
      // is "can I draw this", and a key holding null answers that identically
      // to no key at all while costing bytes on every read.
      ...(peaks && { peaks }),
      // `C21` — what the device actually produced. Answers support-matrix
      // questions from the data instead of from assumptions about a browser.
      ...(capture && { capture }),
    },
  });
}
