import { supabase } from './supabase';
import { sendMessage } from './messaging';

/**
 * DOCUMENTS IN A CONVERSATION (M12).
 *
 * The third member of the family after `voiceNotes.js` and `messageImages.js`,
 * and deliberately the same shape: upload → insert, payload holds a storage
 * PATH and never a URL. This file records only what a document does differently.
 *
 * ── NOTHING IS RE-ENCODED, SO NOTHING IS REPAIRED ────────────────────
 *
 * An image goes through a canvas, which incidentally normalises it: rotation is
 * baked in, the type becomes WebP, and the size collapses. A document has no
 * such step — the bytes the user picked are the bytes that are stored. That
 * makes the SERVER-side limits the only real protection, which is why M12's
 * mime allow-list and size cap matter more here than anywhere else.
 *
 * ── THE NAME IS THE ONLY THING A PERSON RECOGNISES ───────────────────
 *
 * A photo shows itself. A document is a rectangle with a filename in it, so the
 * original name is carried in the payload — the storage path is a uuid and
 * says nothing. It is also the one field here that is fully user-controlled,
 * hence `safeName` below.
 */

/** The private bucket from M12. */
const BUCKET = 'message-files';

/** Signed URLs are minted per download and never persisted. */
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Refused before upload as well as by the bucket.
 *
 * ⚠ THIS IS CONVENIENCE, NOT SECURITY. The real limit is M12's
 * `file_size_limit`, enforced by the storage API against every client. This
 * exists so a 40 MB file fails instantly with a sentence a person can act on,
 * rather than after a long upload with a 413.
 */
export const MAX_BYTES = 52428800;   // 50 MB — ⚠ MUST MATCH M12's file_size_limit

/**
 * What the three text-only surfaces show: the inbox preview, the push
 * notification, and a screen reader.
 *
 * The FILENAME, not a generic word — unlike a photo or a Voicey, a document's
 * name is its content as far as those surfaces are concerned. "Sent you
 * rider-2026.pdf" is useful in a way "Attachment" is not.
 */
export function bodyForFile(name) {
  return safeName(name) || 'Attachment';
}

/**
 * The filename, made safe to render and to store.
 *
 * ⚠ THE NAME IS ATTACKER-CONTROLLED. It comes from a file the sender chose and
 * is displayed to the RECIPIENT, so it is the one value in this module that
 * cannot be trusted. React escapes it on render, but the path separators matter
 * to storage and the length matters to the layout — a 400-character name would
 * be a message bubble the size of the screen.
 */
export function safeName(name) {
  if (!name) return '';
  // Path separators and control characters out: the name is only ever a label,
  // and one containing `../` invites a reader to treat it as a location.
  const flat = String(name)
    .replace(/[/\\]/g, '_')
    // Control characters, and the bidi overrides that let a filename LIE about
    // its type: a name carrying U+202E renders reversed, so ...fdp.exe displays
    // as ...exe.pdf in every UI that honours them. Stripped, not escaped —
    // none of them belong in a label.
    // IS the purpose here; they are precisely what is being removed.
    // eslint-disable-next-line no-control-regex -- matching control characters
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '')
    .trim();
  return flat.length > 120 ? `${flat.slice(0, 110)}…${flat.slice(-6)}` : flat;
}

/** The extension, for the storage path only. Never trusted for type. */
function extensionFor(name, mime) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  if (m) return m[1].toLowerCase();
  // No extension on the name: fall back to the mime's subtype, which at least
  // keeps the stored object recognisable in a bucket listing.
  return String(mime || '').split('/')[1]?.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
}

/** Bytes as something a person reads. 1 decimal place above KB, none below. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Put a file in the bucket.
 *
 * ⚠ THE FIRST PATH SEGMENT IS THE CONVERSATION ID, AND M12'S POLICIES READ IT.
 * Both policies pull the conversation out of the object name, so a flat path
 * uploads a file no participant can ever read back — and it fails SILENTLY,
 * because the upload itself succeeds. Built in exactly one place.
 *
 * The stored name is a uuid, NOT the user's filename. Two reasons: the original
 * may collide, and it is attacker-controlled, so keeping it out of the storage
 * key means it can never influence where an object lands. The real name travels
 * in the payload instead, where it is only ever a label.
 */
export async function uploadMessageFile({ conversationId, file } = {}) {
  if (!conversationId) return { path: null, error: { message: 'uploadMessageFile: conversationId is required' } };
  if (!file?.size)     return { path: null, error: { message: 'uploadMessageFile: nothing to upload' } };
  if (file.size > MAX_BYTES) {
    return { path: null, error: { message: `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_BYTES)}.` } };
  }

  const path = `${conversationId}/${crypto.randomUUID()}.${extensionFor(file.name, file.type)}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    // No upsert. A random filename cannot collide, and allowing overwrite would
    // let a second upload replace a document a sent message already points at —
    // editing a sent message through the back door.
    upsert: false,
  });

  return error ? { path: null, error } : { path, error: null };
}

/**
 * A download url for a stored file.
 *
 * RLS decides here, not the caller: a non-participant's request fails at the
 * storage API, so there is no access check in this function to disagree with
 * M12's policy.
 *
 * `download` asks storage for a Content-Disposition attachment header, so the
 * browser SAVES the file under its original name instead of navigating to it.
 * That matters beyond convenience: without it a PDF opens in place, and any
 * type the browser can render would be displayed from our storage origin.
 */
export async function downloadUrlFor(path, name, expiresIn = SIGNED_URL_TTL_SECONDS) {
  if (!path) return { url: null, error: { message: 'downloadUrlFor: path is required' } };

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresIn, { download: safeName(name) || true });

  return error ? { url: null, error } : { url: data?.signedUrl ?? null, error: null };
}

/**
 * Upload → send, as one message.
 *
 * Upload FIRST, insert second, as every sibling does. The reverse would put a
 * row in the thread pointing at a document that might never arrive, and an
 * attachment that cannot be opened is worse than one that was never sent — the
 * sender believes it went.
 */
export async function sendFile({ conversationId, fromProfileId, file, hd = false } = {}) {
  const { path, error: uploadError } = await uploadMessageFile({ conversationId, file });
  if (uploadError) return { message: null, error: uploadError };

  return sendMessage({
    conversationId,
    fromProfileId,
    body: bodyForFile(file.name),   // the filename. See `bodyForFile`.
    kind: 'file',
    payload: {
      path,                                     // stable; the url is derived
      name:  safeName(file.name),
      mime:  file.type || 'application/octet-stream',
      bytes: file.size,
      // ⚠ A LABEL, NOT A MECHANISM. Unlike an image's `original`, this changes
      // nothing about how the file is stored, gated or expired — a document and
      // an HD audio master take the identical path through this module. It
      // records which row the sender chose, so the bubble can say "this was
      // sent as a master, not as an attachment".
      //
      // There is deliberately NO expiry here: an audio file sent to a promoter
      // has to still be there next month. Only IMAGE originals are temporary,
      // because only they have a permanent optimised copy standing in for them.
      ...(hd && { hd: true }),
    },
  });
}
