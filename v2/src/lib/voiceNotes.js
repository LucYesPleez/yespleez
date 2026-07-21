import { supabase } from './supabase';
import { sendMessage } from './messaging';

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
 * Preferred capture format, best first.
 *
 * Opus in WebM is small and universally decodable on the browsers this app
 * targets; Safari records mp4/aac instead and cannot produce WebM at all, so
 * the list is a negotiation rather than a preference. Every entry here must
 * also appear in M9b's `allowed_mime_types` or the upload is refused by the
 * bucket after a successful recording — the worst moment to discover it.
 */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg;codecs=opus',
  'audio/ogg',
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
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];
  recorder.addEventListener('dataavailable', e => {
    if (e.data?.size > 0) chunks.push(e.data);
  });
  recorder.start();

  const startedAt = Date.now();
  let released = false;

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
        resolve({ blob, durationMs: Date.now() - startedAt });
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
export async function sendVoiceNote({ conversationId, fromProfileId, blob, durationMs } = {}) {
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
    },
  });
}
