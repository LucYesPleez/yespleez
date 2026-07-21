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
 * §6.2 — Opus VBR 32–48 kbps at 48 kHz mono. Bottom of the ratified range:
 * speech at 48 kHz mono Opus is transparent well below the top of it, and the
 * saving is paid by every listener on every playback.
 *
 * Ignored by browsers that will not honour it, which is why the NEGOTIATED
 * values are read back and persisted rather than assumed (`C21`).
 */
const TARGET_BITS_PER_SECOND = 32000;

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

  const recorder = new MediaRecorder(recordStream, {
    mimeType,
    audioBitsPerSecond: TARGET_BITS_PER_SECOND,
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
            channels:        downmixed ? 1 : (settings.channelCount ?? null),
            source_channels: settings.channelCount ?? null,
            downmixed,
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
export async function sendVoiceNote({ conversationId, fromProfileId, blob, durationMs, capture } = {}) {
  // §6.6's pipeline order: record → compute peaks → upload → message.
  //
  // Peaks are computed BEFORE the upload, not after, so a peak failure costs
  // nothing: at this point no object exists and no row exists, so degrading to
  // a note without a waveform is free. Computing after the upload would mean a
  // decorative step could fail with an orphan already written.
  const peaks = await computePeaks(blob);

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
