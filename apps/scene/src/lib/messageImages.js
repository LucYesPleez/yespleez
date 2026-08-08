import { supabase } from './supabase';
import { sendMessage } from './messaging';
import { loadCorrectedCanvas, resizeCanvas, canvasToBlob, extractEmbeddedPreview } from './imageUtils';

/**
 * PHOTOS IN A CONVERSATION (M11).
 *
 * The direct sibling of `voiceNotes.js`, and deliberately the same shape:
 * prepare → upload → insert, with the payload holding a storage PATH and never
 * a URL. Read that file's headers for the reasoning; this one records only
 * where a photo differs from a voice note.
 *
 * ── THE BUCKET IS PRIVATE, AND THAT IS THE WHOLE POINT ───────────────
 *
 * `uploadImage.js` already uploads images, to `avatars` and `posters`. Both are
 * PUBLIC buckets returning permanent public URLs, which is correct for a
 * published avatar and wrong for private correspondence: a public URL is
 * readable by anyone who has it, forever, with no participation check. So a
 * photo sent in a thread goes to its own private bucket and is read back
 * through short-lived signed URLs, exactly as audio is. Same file type,
 * opposite visibility class.
 *
 * ── DIMENSIONS ARE STORED AT SEND TIME ───────────────────────────────
 *
 * `width` and `height` go in the payload so the bubble can reserve the right
 * box BEFORE the signed URL resolves and the pixels arrive. Without them every
 * photo in the thread would render at zero height and then shove the
 * conversation down as it loaded — the same reflow that storing `wave` at
 * record time exists to prevent for a Voicey.
 */

/** The private bucket from M11. Not `avatars`/`posters` — see header. */
const BUCKET = 'message-images';

/**
 * The private bucket from M13, holding untouched originals.
 *
 * Separate from `message-images` because the limits are opposite: an optimised
 * image is re-encoded and capped at 8 MB, an original is by definition
 * untouched and may be 50. Widening the image bucket to fit would remove the
 * guarantee that a chat photo cannot be enormous.
 *
 * ⚠ ITS READ POLICY IS TIME-GATED. Signing a url here consults
 * `message_originals.expires_at`, so a closed window fails at the storage API
 * rather than in this file. See M13.
 */
const ORIGINALS_BUCKET = 'message-originals';

/** Signed URLs are minted per view and never persisted. One hour, as M9b. */
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * The longest edge of the OPTIMISED image — what chat shows everywhere, and
 * what the full-screen viewer opens.
 *
 * 2560 (M13, up from 1600). The viewer now supports pinch-zoom, which changed
 * what "big enough" means: 1600 was sized against the screen, and a photo you
 * can magnify is no longer bounded by the screen. It still re-encodes to WebP,
 * so a phone photo stays under a megabyte.
 *
 * ⚠ EXISTING PHOTOS ARE 1600 AND STAY 1600. Variants are produced once, at send
 * time, exactly as a Voicey's peaks are computed once at record time. Nothing
 * upgrades a photo already in a thread.
 */
const MAX_EDGE = 2560;

/**
 * The longest edge of the THUMBNAIL — what a bubble draws.
 *
 * A bubble is at most 76% of a phone's width, so even at 3x it never needs more
 * than ~800 physical pixels. Drawing the 2560 there meant every photo scrolled
 * past cost a full-size decode for a picture displayed at a third of the size.
 *
 * ⚠ OPTIONAL ON READ. Photos sent before M13 have no thumbnail, and the
 * renderer must fall back to the optimised image for them — permanently.
 */
const THUMB_EDGE = 720;

/**
 * How long a preserved original stays downloadable, by name.
 *
 * ⚠ THE VALUES ARE ADVISORY HERE AND AUTHORITATIVE IN THE DATABASE. What
 * actually ends a window is `expires_at` in `message_originals`, which M13's
 * storage policy joins on every read. This map only decides what timestamp gets
 * written; a client that sends something else still cannot read past whatever
 * it wrote, and cannot rewrite it afterwards — there is no UPDATE policy.
 *
 * `forever` is the premium case and maps to NULL. NOTHING IN THE APP OFFERS IT
 * YET — it is here because the gate already honours NULL, and leaving it out
 * would invite someone to add premium by inventing a second mechanism.
 */
export const ORIGINAL_WINDOWS = {
  '24h':     24,
  '72h':     72,
  '7d':      168,
  forever:   null,
};

/** The default when preservation is on but nothing was chosen. */
export const DEFAULT_WINDOW = '72h';

/** WebP quality. 0.82 is `uploadImage.js`'s thumbnail value, and holds up here. */
const QUALITY = 0.82;

/**
 * What the three text-only surfaces show: the inbox preview, the push
 * notification, and a screen reader.
 *
 * `messages_body_not_blank` makes body mandatory for EVERY kind, and it is not
 * a formality — those three places read nothing else. A photo with an empty
 * body is a conversation whose inbox row says nothing.
 */
export const IMAGE_FALLBACK_BODY = 'Photo';

/**
 * A picked file becomes something sendable: EXIF-corrected, downscaled, and
 * re-encoded to WebP (or JPEG where WebP is unavailable).
 *
 * ⚠ THE EXIF STEP IS NOT OPTIONAL. A phone photo carries its rotation as
 * metadata rather than in the pixels, so uploading the raw file sends a picture
 * that is sideways for everyone but the person who took it. `loadCorrectedCanvas`
 * bakes the rotation in, which is also why this cannot simply upload the `File`.
 *
 * Re-encoding is what makes HEIC a non-issue: an iPhone hands over a file no
 * browser can decode, `loadCorrectedCanvas` fails on it, and the caller gets a
 * clean error instead of an upload the bucket would reject anyway.
 *
 * Returns the intrinsic size ALONGSIDE the blob, because it is known here and
 * nowhere else afterwards — reading it back off the uploaded object would mean
 * decoding the image a second time to learn something we already had.
 */
export async function prepareImage(file) {
  if (!file) return { image: null, error: { message: 'prepareImage: no file' } };

  let canvas;
  // True when the picture chat shows came from a JPEG embedded in a raw file
  // rather than from the file itself. It changes what we may CLAIM about the
  // original — see below.
  let fromEmbedded = false;

  try {
    canvas = await loadCorrectedCanvas(file);
  } catch {
    // ⚠ BEFORE GIVING UP: A RAW FILE HAS A JPEG INSIDE IT.
    //
    // Cameras embed a full-size preview so their own screens can show the shot.
    // Extracting it is what lets a photographer send a NEF and have it appear
    // in the thread as a photograph — with the untouched raw preserved
    // alongside — instead of as a card with a filename on it. The sender does
    // nothing and need not know any of this happened.
    const preview = await extractEmbeddedPreview(file);
    if (preview) {
      try {
        canvas = await loadCorrectedCanvas(preview);
        fromEmbedded = true;
      } catch { /* the embedded data was not usable either; fall through */ }
    }
  }

  if (!canvas) {
    // ⚠ NOT AN ERROR WHEN AN ORIGINAL IS BEING PRESERVED. A RAW or a TIFF is
    // exactly the file a photographer means by "HD" — and no browser can decode
    // either, so there is no optimised copy and no thumbnail to be had. The
    // caller decides what that means: an ordinary image send has nothing left
    // to show and fails, while an HD send stores the original anyway and
    // presents it as a download.
    //
    // Distinguished from a real failure by `undecodable`, so the two cannot be
    // confused by a caller that only checks `error`.
    return {
      image: null,
      undecodable: true,
      error: { message: 'That image cannot be previewed in a browser. Send it with Upload HD image to share the original.' },
    };
  }

  // Both variants come from the SAME corrected canvas, decoded once. A phone
  // photo is expensive to decode and doing it twice to make two sizes of the
  // same picture is the kind of waste that shows up as a stalled composer.
  const optimised = await variant(canvas, MAX_EDGE);
  const thumb     = await variant(canvas, THUMB_EDGE);

  return {
    image: {
      ...optimised,          // the shape M11 already returned: blob/ext/mime/w/h
      thumb,
      // The UNTOUCHED file, carried alongside. Only uploaded if the sender asks
      // for preservation — but it has to be held from here, because by the time
      // that choice is made the File is the only copy of the original bytes.
      source: file,
      sourceBytes: file.size,
      sourceMime:  file.type || null,
      // ⚠ NULL WHEN THE PREVIEW CAME OUT OF A RAW FILE, and that is a
      // correctness rule rather than caution. The embedded JPEG's size is the
      // camera's choice — often well under the sensor's — so reporting it as
      // the original's resolution would tell the recipient the wrong number
      // about the one thing they cannot check for themselves. The panel omits
      // a line it has no value for; it does not print a guess.
      sourceWidth:  fromEmbedded ? null : canvas.width,
      sourceHeight: fromEmbedded ? null : canvas.height,
      // Recorded so the sender can be told what actually happened, and so the
      // distinction survives into the payload rather than being inferred later
      // from a missing dimension.
      previewFromEmbedded: fromEmbedded,
    },
    error: null,
  };
}

/**
 * One size of a picture, fitted inside `edge`.
 *
 * NEVER scales up: a small image blown up is bigger bytes carrying no more
 * picture, and for the thumbnail it would also mean a "thumbnail" larger than
 * the photo it stands for.
 */
async function variant(canvas, edge) {
  const scale  = Math.min(1, edge / Math.max(canvas.width, canvas.height));
  const width  = Math.max(1, Math.round(canvas.width  * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));

  const sized = scale < 1 ? resizeCanvas(canvas, width, height) : canvas;
  const { blob, ext, type } = await canvasToBlob(sized, QUALITY);

  return { blob, ext, mime: type, width, height };
}

/**
 * Put a prepared image in the bucket.
 *
 * ⚠ THE FIRST PATH SEGMENT IS THE CONVERSATION ID, AND M11'S POLICIES READ IT.
 * Both the read and the write policy pull the conversation out of the object
 * name, so a flat path — or one nested a level deeper — uploads a file that no
 * participant can ever read back. This is the only place the path is built.
 *
 * The filename is random rather than the message id, because the row does not
 * exist yet: its payload has to point at something. A failed insert after a
 * successful upload therefore orphans the object, which is the deliberate
 * trade — the alternative is a row pointing at a picture that may not be there.
 */
export async function uploadMessageImage({ conversationId, blob, ext } = {}) {
  if (!conversationId) return { path: null, error: { message: 'uploadMessageImage: conversationId is required' } };
  if (!blob?.size)     return { path: null, error: { message: 'uploadMessageImage: nothing to upload' } };

  const path = `${conversationId}/${crypto.randomUUID()}.${ext || 'webp'}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type,
    // No upsert. A random filename cannot collide, and allowing overwrite would
    // let a second upload replace a picture a sent message already points at —
    // editing a sent message through the back door.
    upsert: false,
  });

  return error ? { path: null, error } : { path, error: null };
}

/**
 * A viewable url for a stored photo.
 *
 * Minted per view and never persisted. RLS decides here, not the caller: a
 * non-participant's request fails at the storage API, so there is no access
 * check in this function to disagree with M11's policy.
 */
export async function signedUrlFor(path, expiresIn = SIGNED_URL_TTL_SECONDS) {
  if (!path) return { url: null, error: { message: 'signedUrlFor: path is required' } };

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  return error ? { url: null, error } : { url: data?.signedUrl ?? null, error: null };
}

/**
 * Pick → prepare → upload → send, as one message.
 *
 * Upload FIRST, insert second, as `sendVoiceNote` does. The reverse would put a
 * row in the thread pointing at a picture that might never arrive, and a
 * message rendering as a broken image is worse than one that was never sent —
 * the sender believes it went.
 *
 * Accepts an already-prepared image so a RETRY does not re-encode: the compose
 * path prepares once to build the optimistic bubble, and the same blob is
 * uploaded on every attempt. Re-encoding per retry would burn a second or two
 * of phone CPU redrawing an identical picture.
 */
export async function sendImage({
  conversationId, fromProfileId, file, image: prepared,
  // M13. Off by default, deliberately — most photos are not worth preserving,
  // and an original that nobody asked for is storage nobody agreed to pay for.
  preserveOriginal = false,
  window: windowKey = DEFAULT_WINDOW,
  clientId,
} = {}) {
  let image = prepared;

  if (!image) {
    const { image: made, error } = await prepareImage(file);
    if (error) return { message: null, error };
    image = made;
  }

  const { path, error: uploadError } = await uploadMessageImage({
    conversationId, blob: image.blob, ext: image.ext,
  });
  if (uploadError) return { message: null, error: uploadError };

  // ⚠ THE THUMBNAIL IS ALLOWED TO FAIL. It is an optimisation, and the renderer
  // already falls back to the optimised image for every photo sent before M13 —
  // so losing it costs a little bandwidth, not the message. Failing the whole
  // send because a smaller copy of a picture we already uploaded did not upload
  // would be trading the feature for the optimisation.
  //
  // ⚠ AND IT IS ALLOWED TO BE ABSENT. A caller may hand over an image prepared
  // by an older code path — a retry of a send queued before M13 is the real
  // case — and `image.thumb.blob` on an undefined thumb throws, losing the
  // whole message to a missing optimisation. Optional means optional at both
  // ends.
  const { path: thumbPath } = image.thumb?.blob
    ? await uploadMessageImage({ conversationId, blob: image.thumb.blob, ext: image.thumb.ext })
    : { path: null };

  // The original goes up BEFORE the message row, like every other artefact
  // here: a row promising an HD original that never arrived is worse than a
  // message sent without one.
  let original = null;
  if (preserveOriginal && image.source) {
    const { original: stored, error: originalError } = await uploadOriginal({
      conversationId, image, windowKey,
    });
    // ⚠ DEGRADES, DOES NOT FAIL. If the original cannot be stored the photo is
    // still worth sending — it simply arrives without the HD badge. The
    // alternative is losing a message because its optional extra failed.
    if (!originalError) original = stored;
  }

  const { message, error } = await sendMessage({
    conversationId,
    fromProfileId,
    clientId,                    // idempotency — a retry re-uses it, so the row cannot double
    body: IMAGE_FALLBACK_BODY,   // the three text-only surfaces. See header.
    kind: 'image',
    payload: {
      // ⚠ `path` IS STILL THE OPTIMISED IMAGE. Every reader written before M13
      // resolves this key, so it must keep meaning exactly what it meant.
      path,
      ...(thumbPath && { thumb_path: thumbPath }),
      mime:   image.mime,
      width:  image.width,       // stored so the bubble reserves its box before
      height: image.height,      // the pixels land. See header.
      bytes:  image.blob.size,
      ...(original && { original: {
        path:       original.path,
        bytes:      original.bytes,
        width:      original.width,
        height:     original.height,
        mime:       original.mime,
        // Denormalised onto the message so the badge and countdown can draw
        // without a second query per photo. ⚠ IT IS A COPY, NOT THE AUTHORITY:
        // `message_originals.expires_at` is what the storage gate reads, and a
        // client editing this value changes what it DRAWS, never what it can
        // download.
        expires_at: original.expires_at,
      } }),
    },
  });

  // The window row is written LAST, because it needs the message id — and
  // because of that ordering it can fail after the message exists.
  //
  // ⚠ THAT FAILURE IS SAFE, AND DELIBERATELY SO. M13's gate requires a matching
  // row to sign a url, so an original with no window row is unreadable by
  // everyone, forever. The feature FAILS CLOSED: the worst case is an
  // inaccessible object and a badge that reports it expired, never an original
  // that outlives the window it promised.
  if (message && original) {
    await recordOriginal({ conversationId, messageId: message.id, original });
  }

  return { message, error };
}

/**
 * An original with NO viewable version — a RAW, a TIFF, anything the browser
 * cannot decode.
 *
 * ⚠ THIS IS THE HD CASE AT ITS PUREST, NOT A DEGRADED ONE. A photographer's
 * RAW is precisely the file worth preserving, and it has never been viewable in
 * a chat bubble — so there is nothing missing here, only nothing to draw. The
 * message carries the filename, the size and the window, and the recipient
 * downloads it.
 *
 * It is still `kind: 'image'` rather than `file`, deliberately: it IS a
 * photograph, it belongs in the Originals list with the others, and it needs
 * the expiry panel that `ImageMessage` already draws. Only the picture is
 * absent — and `ImageMessage` renders a card whenever `path` is missing and an
 * `original` is present.
 */
export async function sendOriginalOnly({
  conversationId, fromProfileId, file, window: windowKey = DEFAULT_WINDOW, clientId,
} = {}) {
  if (!file?.size) return { message: null, error: { message: 'sendOriginalOnly: nothing to send' } };

  const { original, error: uploadError } = await uploadOriginal({
    conversationId,
    // `uploadOriginal` reads its dimensions off a decoded canvas, which by
    // definition does not exist here. Absent rather than guessed: the panel
    // omits a line it has no value for, and inventing one would describe the
    // picture wrongly to the only person who cannot see it.
    image: { source: file, sourceWidth: null, sourceHeight: null },
    windowKey,
  });
  if (uploadError) return { message: null, error: uploadError };

  const name = originalName(file.name);

  const { message, error } = await sendMessage({
    conversationId,
    fromProfileId,
    clientId,                    // idempotency — a retry re-uses it, so the row cannot double
    // The FILENAME, not "Photo". This is the only kind of image message whose
    // content the three text-only surfaces cannot describe any other way — the
    // inbox cannot show a thumbnail that does not exist.
    body: name || IMAGE_FALLBACK_BODY,
    kind: 'image',
    payload: {
      // ⚠ NO `path`. Its absence is what tells `ImageMessage` to draw a card
      // instead of a picture, and it is the honest representation: there is no
      // optimised image, because none could be made.
      name,
      original: {
        path:       original.path,
        bytes:      original.bytes,
        width:      original.width,
        height:     original.height,
        mime:       original.mime,
        expires_at: original.expires_at,
      },
    },
  });

  // Fails closed, as the decodable path does: without this row M13's gate
  // signs nothing, so a missing row costs access rather than granting it.
  if (message && original) {
    await recordOriginal({ conversationId, messageId: message.id, original });
  }

  return { message, error };
}

/** A filename fit to render. Same reasoning as `messageFiles.safeName`. */
function originalName(name) {
  if (!name) return '';
  const flat = String(name).replace(/[/\\]/g, '_').trim();
  return flat.length > 90 ? `${flat.slice(0, 80)}…${flat.slice(-6)}` : flat;
}

/** Put the untouched file in the originals bucket. Same path rule as everything. */
async function uploadOriginal({ conversationId, image, windowKey }) {
  const file = image.source;
  const ext  = (file.name?.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] || 'jpg').toLowerCase();
  const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(ORIGINALS_BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) return { original: null, error };

  const hours = ORIGINAL_WINDOWS[windowKey] ?? ORIGINAL_WINDOWS[DEFAULT_WINDOW];

  return {
    original: {
      path,
      bytes:  file.size,
      width:  image.sourceWidth,
      height: image.sourceHeight,
      mime:   file.type || null,
      // null = never expires. Only reachable via the `forever` key, which
      // nothing in the app offers yet. See ORIGINAL_WINDOWS.
      expires_at: hours == null ? null : new Date(Date.now() + hours * 3600_000).toISOString(),
    },
    error: null,
  };
}

/** The row M13's storage gate joins against. Without it the object is dead. */
async function recordOriginal({ conversationId, messageId, original }) {
  return supabase.from('message_originals').insert({
    object_path:     original.path,
    conversation_id: conversationId,
    message_id:      messageId,
    bytes:           original.bytes,
    width:           original.width,
    height:          original.height,
    mime:            original.mime,
    expires_at:      original.expires_at,
  });
}

/**
 * A download url for a preserved original — or a refusal.
 *
 * ⚠ THE CLIENT-SIDE EXPIRY CHECK BELOW IS COURTESY, NOT ENFORCEMENT. It exists
 * so an expired badge explains itself instantly instead of after a round trip.
 * The REAL gate is M13's storage policy, which joins `message_originals` and
 * refuses to sign anything whose window has closed — so removing this check
 * would change the error message and nothing else.
 */
export async function downloadOriginalUrl(original, expiresIn = SIGNED_URL_TTL_SECONDS) {
  if (!original?.path) return { url: null, error: { message: 'No original was preserved' } };
  if (hasExpired(original)) return { url: null, error: { message: 'This original has expired' } };

  const { data, error } = await supabase.storage
    .from(ORIGINALS_BUCKET)
    .createSignedUrl(original.path, expiresIn, { download: true });

  if (error) {
    // The gate refusing is the EXPECTED path once a window closes, not an
    // exceptional one — the clock here and the clock in Postgres will not agree
    // to the second.
    return { url: null, error: { message: 'This original is no longer available' } };
  }
  return { url: data?.signedUrl ?? null, error: null };
}

/** null `expires_at` never expires — the premium case. */
export function hasExpired(original) {
  if (!original) return false;
  if (original.expires_at == null) return false;
  return new Date(original.expires_at).getTime() <= Date.now();
}

/**
 * "2d 13h", "13h 20m", "4m". Two units at most.
 *
 * Three units is a countdown nobody reads; one is a countdown that appears
 * stuck for a day at a time. The smaller unit is dropped once the larger makes
 * it noise — nobody needs the minutes on a two-day window.
 */
export function formatRemaining(expiresAt, now = Date.now()) {
  if (expiresAt == null) return null;                 // never expires
  const ms = new Date(expiresAt).getTime() - now;
  if (!(ms > 0)) return null;                          // expired

  const totalMinutes = Math.floor(ms / 60000);
  const days  = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const mins  = totalMinutes % 60;

  if (days  > 0) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins  ? `${hours}h ${mins}m` : `${hours}h`;
  return `${Math.max(1, mins)}m`;                      // never shows "0m"
}

/**
 * Raw extensions worth naming by their maker.
 *
 * ⚠ THE EXTENSION IS THE ONLY RELIABLE SIGNAL HERE. Browsers report camera raw
 * as `application/octet-stream` or as nothing at all, so the mime type cannot
 * answer this. That is also why the upload path lists these explicitly.
 */
const RAW_EXTENSIONS = {
  nef: 'Nikon', nrw: 'Nikon',
  cr2: 'Canon', cr3: 'Canon', crw: 'Canon',
  arw: 'Sony',  srf: 'Sony',  sr2: 'Sony',
  raf: 'Fujifilm',
  orf: 'OM System',
  rw2: 'Panasonic',
  pef: 'Pentax',
  x3f: 'Sigma',
  dng: 'DNG',
  raw: null,
};

/**
 * What the recipient is about to download, in one line.
 *
 * ⚠ DIMENSIONS ARE PREFERRED, AND THEIR ABSENCE IS NOT A GAP TO FILL WITH A
 * GUESS. When a preview came out of a raw file we deliberately do not know the
 * sensor's resolution — the embedded JPEG's size is the camera's choice and is
 * routinely a quarter of it. Printing that number would tell someone
 * `1920 × 1280` about a file that is actually `8256 × 5504`, which is worse
 * than saying nothing: it is a specific, checkable, wrong claim about the one
 * thing they cannot see for themselves.
 *
 * So the fallback describes the KIND instead — "Camera RAW (.NEF)" — which is
 * both true and more useful to a photographer than a pixel count would be.
 */
export function describeOriginal(original, name = '') {
  if (original?.width && original?.height) return `${original.width} × ${original.height}`;

  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name || original?.path || '')?.[1]?.toLowerCase();
  if (!ext) return 'Original file';

  if (ext in RAW_EXTENSIONS) {
    const maker = RAW_EXTENSIONS[ext];
    // The maker's name earns its place: a photographer reads "Canon RAW" as
    // "this opens in my software", where "RAW" alone leaves the question open.
    return maker && maker !== 'DNG'
      ? `${maker} RAW (.${ext.toUpperCase()})`
      : `Camera RAW (.${ext.toUpperCase()})`;
  }

  if (ext === 'tif' || ext === 'tiff') return 'TIFF';
  return ext.toUpperCase();
}

/** Bytes as a person reads them. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
