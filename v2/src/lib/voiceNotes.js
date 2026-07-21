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
  sampleRate:       48000,   // §6.2 — full-band, not telephony bandwidth
};

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
  // The constraints are ADVISORY — a browser may silently ignore any of them,
  // which is exactly why what was actually negotiated is read back below rather
  // than assumed (`C21`).
  const stream = await navigator.mediaDevices.getUserMedia({ audio: CAPTURE_CONSTRAINTS });

  const recorder = new MediaRecorder(stream, {
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

  // `C21` — what the browser ACTUALLY gave us, not what we asked for. Every
  // constraint above is advisory and any of them may be silently ignored, so
  // the negotiated settings are read from the live track and persisted with the
  // message. Without this the payload would record an intention rather than a
  // fact, and a future support-matrix question ("do our iOS notes have DSP on?")
  // would be unanswerable from the data.
  const settings = stream.getAudioTracks()[0]?.getSettings?.() ?? {};

  /** Idempotent: stop() then unmount must not stop the tracks twice. */
  function release() {
    if (released) return;
    released = true;
    stream.getTracks().forEach(t => t.stop());
  }

  return {
    mimeType,

    /** Elapsed ms, for a live duration readout while held. */
    elapsedMs: () => Date.now() - startedAt,

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
            channels:    settings.channelCount ?? null,
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
