/**
 * OUTBOX UPLOADERS — how each message kind actually reaches the server.
 *
 * The Outbox owns the lifecycle (draft → queued → uploading → sent, retry,
 * offline) and knows nothing about how any one kind is sent. These adapters are
 * that knowledge, one per kind, registered into the outbox's registry. A new
 * kind — a photo, a document — ships one function here and inherits the entire
 * reliability model with no change to the Outbox.
 *
 * ── THE CONTRACT ─────────────────────────────────────────────────────
 *
 * An uploader receives the whole outbox entry, does whatever its kind requires
 * to create the real server row, and either resolves (delivered — the outbox
 * removes the entry) or THROWS (kept as `failed`, shown with Retry). Both
 * sendMessage and sendVoiceNote report failure as a returned `{ error }` rather
 * than a rejection, so each adapter turns that error into the throw the outbox
 * expects — otherwise a failed send would look delivered and the message would
 * be dropped, the one thing that must never happen.
 *
 * ── WHY THE SENDER IS IN THE PAYLOAD ─────────────────────────────────
 *
 * `fromProfileId` is stored ON the entry at enqueue time, not read live. An
 * offline Voicey may flush twenty minutes later from a sweep that has no idea
 * which profile is on screen — the entry has to carry its own attribution.
 * §2.1 fixes the sending identity for the life of a conversation, so the stored
 * value cannot have drifted; storing it is what makes offline delivery possible
 * at all.
 */

import { sendMessage } from './messaging';
import { sendVoiceNote } from './voiceNotes';
import { registerUploader } from './outbox';

/**
 * TEXT — the simplest tenant, and the proof the Outbox is kind-agnostic. No
 * upload step; the whole act is one insert. It goes through the identical
 * lifecycle as a Voicey — queued, uploaded, retried, held offline — which is
 * the point: online and offline text now share one code path with everything
 * else, with no bypass.
 */
async function uploadText(entry) {
  const { conversationId, payload } = entry;
  const { message, error } = await sendMessage({
    conversationId,
    fromProfileId: payload.fromProfileId,
    body: payload.body,
  });
  if (error) throw new Error(error.message || 'send failed');
  return message;
}

/**
 * VOICE — compute already done at record time, so the uploader just uploads the
 * blob and inserts. The blob is `segments[0]`: v1 always has exactly one, and
 * reading the list here (not a bare `.blob`) is what keeps Resume Recording a
 * future addition rather than a rewrite of this function.
 */
async function uploadVoice(entry) {
  const { conversationId, payload } = entry;
  const blob = payload.segments?.[0];
  if (!blob) throw new Error('voice draft has no audio');
  const { message, error } = await sendVoiceNote({
    conversationId,
    fromProfileId: payload.fromProfileId,
    blob,
    durationMs: payload.durationMs,
    wave:       payload.wave,      // computed at record time; never re-decoded
    capture:    payload.capture,
  });
  if (error) throw new Error(error.message || 'voice send failed');
  return message;
}

let registered = false;

/** Register every kind's uploader with the Outbox. Idempotent. */
export function registerMessageUploaders() {
  if (registered) return;
  registered = true;
  registerUploader('text',  uploadText);
  registerUploader('voice', uploadVoice);
}

/** Test seam. */
export function __resetUploadersRegistered() { registered = false; }
