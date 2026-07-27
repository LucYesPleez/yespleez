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
 *
 * ── WHY EVERY UPLOADER PASSES `clientId: entry.id` ───────────────────
 *
 * ⚠ THIS IS WHAT STOPS A RETRY DUPLICATING A MESSAGE. A send whose insert lands
 * but whose response is lost looks exactly like a send that failed, so the entry
 * stays `failed` and the next flush runs the uploader again. Without a key that
 * second run writes a SECOND row, and a tester on flaky mobile data received the
 * same Voicey more than ten times.
 *
 * The entry id is the right key and needs no new field: it is generated once at
 * enqueue, is stable across every retry of that entry, and is unique per
 * message. sendMessage puts it in `client_id`, a unique index makes the second
 * insert impossible, and the violation is read as proof of delivery. Every kind
 * passes it, because every kind is retried by the same loop.
 */

import { sendMessage } from './messaging';
import { sendVoiceNote } from './voiceNotes';
import { sendImage, sendOriginalOnly } from './messageImages';
import { sendFile } from './messageFiles';
import { sendHand } from './hands';
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
    clientId: entry.id,
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
  if (!payload.segments?.length) throw new Error('voice draft has no audio');
  const { message, error } = await sendVoiceNote({
    conversationId,
    fromProfileId: payload.fromProfileId,
    segments:   payload.segments,  // every recording segment; the recipient sees one note
    segMs:      payload.segMs,      // per-segment durations, for the player's unified scrubber
    durationMs: payload.durationMs,
    wave:       payload.wave,       // one continuous waveform, computed at record time
    capture:    payload.capture,
    clientId:   entry.id,
  });
  if (error) throw new Error(error.message || 'voice send failed');
  return message;
}

/**
 * IMAGE — two shapes under one kind. A decodable photo carries the PREPARED
 * image (rotated, re-encoded once at pick time) so a retry re-uploads bytes
 * rather than redoing the work; a RAW/TIFF an no browser can decode carries the
 * original File and goes up on its own. subtype tells them apart.
 */
async function uploadImage(entry) {
  const p = entry.payload;
  if (p.subtype === 'original') {
    const { message, error } = await sendOriginalOnly({
      conversationId: entry.conversationId, fromProfileId: p.fromProfileId, file: p.file,
      clientId: entry.id,
    });
    if (error) throw new Error(error.message || 'image send failed');
    return message;
  }
  const { message, error } = await sendImage({
    conversationId: entry.conversationId, fromProfileId: p.fromProfileId,
    image: p.image, preserveOriginal: p.preserveOriginal,
    clientId: entry.id,
  });
  if (error) throw new Error(error.message || 'image send failed');
  return message;
}

/**
 * FILE — the picked bytes as-is; the waveform, when it is audio, was computed
 * once at pick time and rides along so the recipient never decodes a 30MB file.
 */
async function uploadFile(entry) {
  const p = entry.payload;
  const { message, error } = await sendFile({
    conversationId: entry.conversationId, fromProfileId: p.fromProfileId,
    file: p.file, downloadable: p.downloadable, wave: p.wave ?? null,
    clientId: entry.id,
  });
  if (error) throw new Error(error.message || 'file send failed');
  return message;
}

/**
 * HAND — the conversation acknowledgement ("Yes"), which is an ordinary message
 * with its own kind. It routes through the Outbox like everything else, so even
 * a Yes tapped with no reception queues and delivers on reconnect.
 */
async function uploadHand(entry) {
  const { message, error } = await sendHand({
    conversationId: entry.conversationId, fromProfileId: entry.payload.fromProfileId,
    clientId: entry.id,
  });
  if (error) throw new Error(error.message || 'hand send failed');
  return message;
}

let registered = false;

/** Register every kind's uploader with the Outbox. Idempotent. */
export function registerMessageUploaders() {
  if (registered) return;
  registered = true;
  registerUploader('text',  uploadText);
  registerUploader('voice', uploadVoice);
  registerUploader('image', uploadImage);
  registerUploader('file',  uploadFile);
  registerUploader('hand',  uploadHand);
}

/** Test seam. */
export function __resetUploadersRegistered() { registered = false; }
