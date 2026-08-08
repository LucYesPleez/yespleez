import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const CONV    = '11111111-1111-1111-1111-111111111111';
const PROFILE = '22222222-2222-2222-2222-222222222222';
const USER    = '33333333-3333-3333-3333-333333333333';

let uploads  = [];
let signs    = [];
let inserted = [];
let uploadResult = { error: null };
let failBucket = null;

mock.module('./supabase', {
  exports: {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
      storage: {
        from(bucket) {
          return {
            upload: async (path, blob, opts) => {
              uploads.push({ bucket, path, blob, opts });
              // Per-bucket failure, so a test can break the ORIGINAL upload
              // without also breaking the optimised one. Without this the
              // "degrades gracefully" test cannot be written at all — every
              // upload fails together and the assertion becomes vacuous.
              if (failBucket === bucket) return { error: { message: `${bucket} refused` } };
              return uploadResult;
            },
            createSignedUrl: async (path, expiresIn) => {
              signs.push({ bucket, path, expiresIn });
              return { data: { signedUrl: `https://signed.example/${path}` }, error: null };
            },
          };
        },
      },
      from(table) {
        const q = {
          insert(row) { inserted.push({ table, row }); q.row = row; return q; },
          select() { return q; },
          single: async () => ({ data: { id: 'new-message', ...q.row }, error: null }),
          then(resolve) { resolve({ data: [], error: null }); },
        };
        return q;
      },
    },
  },
});

const {
  uploadMessageImage, signedUrlFor, sendImage, IMAGE_FALLBACK_BODY,
} = await import('./messageImages.js');

beforeEach(() => {
  uploads = [];
  signs = [];
  inserted = [];
  uploadResult = { error: null };
  failBucket = null;
});

/** What `prepareImage` returns. Node has no canvas; these are all the fields
 *  the upload and send paths actually read. */
function preparedImage(over = {}) {
  return {
    blob: { size: 40960, type: 'image/webp' },
    ext: 'webp', mime: 'image/webp',
    width: 1600, height: 1200,
    ...over,
  };
}

// ── THE PATH LAYOUT IS A SECURITY BOUNDARY, NOT A CONVENTION ──────────
//
// M11's read AND write policies both pull the conversation id out of the first
// folder segment of the object name. A path that does not start with it uploads
// a file no participant can ever read back — and the failure is silent, because
// the upload itself succeeds.

test('⚠ the object path STARTS with the conversation id — M11 policies read it', async () => {
  await uploadMessageImage({ conversationId: CONV, blob: preparedImage().blob, ext: 'webp' });

  assert.equal(uploads.length, 1);
  const [conversationSegment] = uploads[0].path.split('/');
  assert.equal(conversationSegment, CONV,
    'the first path segment must be the conversation id or RLS can never match it');
});

test('it uploads to the PRIVATE message-images bucket, never to a public one', async () => {
  await uploadMessageImage({ conversationId: CONV, blob: preparedImage().blob, ext: 'webp' });

  assert.equal(uploads[0].bucket, 'message-images');
  assert.notEqual(uploads[0].bucket, 'avatars');
  assert.notEqual(uploads[0].bucket, 'posters');
});

test('⚠ upsert is false — a sent photo cannot be swapped after the fact', async () => {
  await uploadMessageImage({ conversationId: CONV, blob: preparedImage().blob, ext: 'webp' });
  assert.equal(uploads[0].opts.upsert, false);
});

test('two uploads to one conversation never collide', async () => {
  const blob = preparedImage().blob;
  await uploadMessageImage({ conversationId: CONV, blob, ext: 'webp' });
  await uploadMessageImage({ conversationId: CONV, blob, ext: 'webp' });

  assert.notEqual(uploads[0].path, uploads[1].path);
});

test('a missing conversation id is refused before anything is uploaded', async () => {
  const { path, error } = await uploadMessageImage({ blob: preparedImage().blob, ext: 'webp' });

  assert.equal(path, null);
  assert.ok(error);
  assert.equal(uploads.length, 0, 'nothing may be written without a conversation to scope it to');
});

// ── THE MESSAGE ROW ───────────────────────────────────────────────────

test('the payload carries the PATH, never a url', async () => {
  await sendImage({ conversationId: CONV, fromProfileId: PROFILE, image: preparedImage() });

  const { payload } = inserted[0].row;
  assert.ok(payload.path.startsWith(`${CONV}/`));
  assert.equal(payload.url, undefined, 'a persisted url would outlive its signature');
  assert.equal(payload.localUrl, undefined, 'the local blob url must never reach the database');
});

test('⚠ dimensions are stored, so the bubble reserves its box before the pixels land', async () => {
  await sendImage({
    conversationId: CONV, fromProfileId: PROFILE,
    image: preparedImage({ width: 1600, height: 900 }),
  });

  const { payload } = inserted[0].row;
  assert.equal(payload.width, 1600);
  assert.equal(payload.height, 900);
});

test('body is never blank — the inbox, the push and a screen reader read only that', async () => {
  await sendImage({ conversationId: CONV, fromProfileId: PROFILE, image: preparedImage() });

  const { body, kind } = inserted[0].row;
  assert.equal(kind, 'image');
  assert.equal(body, IMAGE_FALLBACK_BODY);
  assert.ok(body.trim().length > 0, 'messages_body_not_blank would reject this row');
});

// ── ORDER: UPLOAD FIRST, INSERT SECOND ────────────────────────────────
//
// A row pointing at a picture that never arrived is worse than no row: the
// sender believes it went, and the thread renders a permanently broken image.

test('⚠ a failed upload sends NO message at all', async () => {
  uploadResult = { error: { message: 'storage refused' } };

  const { message, error } = await sendImage({
    conversationId: CONV, fromProfileId: PROFILE, image: preparedImage(),
  });

  assert.equal(message, null);
  assert.ok(error);
  assert.equal(inserted.length, 0, 'no row may point at a photo that was never stored');
});

test('an already-prepared image is uploaded as-is, so a retry never re-encodes', async () => {
  const image = preparedImage();
  await sendImage({ conversationId: CONV, fromProfileId: PROFILE, image });

  assert.equal(uploads[0].blob, image.blob, 'the identical blob must reach storage');
});

// ── READING IT BACK ───────────────────────────────────────────────────

test('a signed url is minted from the private bucket, with a finite lifetime', async () => {
  const { url, error } = await signedUrlFor(`${CONV}/abc.webp`);

  assert.equal(error, null);
  assert.ok(url.startsWith('https://signed.example/'));
  assert.equal(signs[0].bucket, 'message-images');
  assert.ok(signs[0].expiresIn > 0, 'a non-expiring url would defeat the private bucket');
});

test('signing without a path is refused rather than sent to storage', async () => {
  const { url, error } = await signedUrlFor(null);

  assert.equal(url, null);
  assert.ok(error);
  assert.equal(signs.length, 0);
});

// ══ M13 · HD ORIGINALS ════════════════════════════════════════════════
//
// The feature's promise is "you can download this until the window closes".
// What enforces it is M13's storage policy joining `message_originals`, NOT
// anything in this file — so these test the bookkeeping that makes the gate
// possible, plus the fail-closed ordering.

const { ORIGINAL_WINDOWS, DEFAULT_WINDOW, hasExpired, formatRemaining } =
  await import('./messageImages.js');

function preparedWithSource(over = {}) {
  return preparedImage({
    thumb: { blob: { size: 9000, type: 'image/webp' }, ext: 'webp', mime: 'image/webp', width: 720, height: 540 },
    source: { size: 4_800_000, type: 'image/jpeg', name: 'DSC_0001.jpg' },
    sourceBytes: 4_800_000, sourceMime: 'image/jpeg',
    sourceWidth: 4032, sourceHeight: 3024,
    ...over,
  });
}

test('⚠ preservation is OFF by default — no original is stored unasked', async () => {
  await sendImage({ conversationId: CONV, fromProfileId: PROFILE, image: preparedWithSource() });

  const originals = uploads.filter(u => u.bucket === 'message-originals');
  assert.equal(originals.length, 0, 'storage nobody agreed to pay for');
  assert.equal(inserted[0].row.payload.original, undefined);
  assert.ok(!inserted.some(i => i.table === 'message_originals'));
});

test('preserving stores the UNTOUCHED file, not the re-encoded one', async () => {
  const image = preparedWithSource();
  await sendImage({
    conversationId: CONV, fromProfileId: PROFILE, image, preserveOriginal: true,
  });

  const original = uploads.find(u => u.bucket === 'message-originals');
  assert.ok(original, 'the original must reach its own bucket');
  assert.equal(original.blob, image.source, 'the ORIGINAL bytes, never the optimised copy');
  assert.notEqual(original.blob, image.blob);
});

test('⚠ the original goes to its own bucket, never into message-images', async () => {
  await sendImage({
    conversationId: CONV, fromProfileId: PROFILE,
    image: preparedWithSource(), preserveOriginal: true,
  });

  const inImages = uploads.filter(u => u.bucket === 'message-images');
  // optimised + thumbnail, and nothing else: the 8MB cap must keep meaning
  // something for chat images.
  assert.equal(inImages.length, 2);
});

test('⚠ a window row is written — WITHOUT IT THE GATE DENIES EVERYONE', async () => {
  await sendImage({
    conversationId: CONV, fromProfileId: PROFILE,
    image: preparedWithSource(), preserveOriginal: true,
  });

  const row = inserted.find(i => i.table === 'message_originals');
  assert.ok(row, 'M13 signs nothing without a matching row');
  assert.equal(row.row.conversation_id, CONV);
  assert.ok(row.row.expires_at, 'a finite window — nothing in the app grants forever');
  assert.equal(row.row.bytes, 4_800_000);
  assert.equal(row.row.width, 4032, 'the FULL-resolution size, as the HD panel reports it');
});

test('the window row points at the object that was actually uploaded', async () => {
  await sendImage({
    conversationId: CONV, fromProfileId: PROFILE,
    image: preparedWithSource(), preserveOriginal: true,
  });

  const uploadedPath = uploads.find(u => u.bucket === 'message-originals').path;
  const row = inserted.find(i => i.table === 'message_originals').row;
  assert.equal(row.object_path, uploadedPath, 'a mismatch here silently makes the original unreadable');
});

test('the original path is scoped to the conversation, like every other bucket', async () => {
  await sendImage({
    conversationId: CONV, fromProfileId: PROFILE,
    image: preparedWithSource(), preserveOriginal: true,
  });

  const [segment] = uploads.find(u => u.bucket === 'message-originals').path.split('/');
  assert.equal(segment, CONV);
});

test('a chosen window is honoured, and an unknown one falls back rather than never expiring', async () => {
  await sendImage({
    conversationId: CONV, fromProfileId: PROFILE,
    image: preparedWithSource(), preserveOriginal: true, window: '24h',
  });
  const short = new Date(inserted.find(i => i.table === 'message_originals').row.expires_at).getTime();
  assert.ok(short - Date.now() < 25 * 3600_000);

  inserted = [];
  uploads = [];
  await sendImage({
    conversationId: CONV, fromProfileId: PROFILE,
    image: preparedWithSource(), preserveOriginal: true, window: 'nonsense',
  });
  const fallback = inserted.find(i => i.table === 'message_originals').row.expires_at;
  assert.ok(fallback, '⚠ an unrecognised window must NOT become a permanent original');
});

test('⚠ a failed ORIGINAL upload still sends the photo, without the badge', async () => {
  // Degrades rather than failing: losing a message because its optional extra
  // failed would be the wrong trade. Only the originals bucket refuses here.
  failBucket = 'message-originals';

  const { message } = await sendImage({
    conversationId: CONV, fromProfileId: PROFILE,
    image: preparedWithSource(), preserveOriginal: true,
  });

  assert.ok(message, 'the photo must still be sent');
  const row = inserted.find(i => i.table !== 'message_originals').row;
  assert.equal(row.payload.original, undefined, 'no badge may claim an original that was not stored');
  assert.ok(!inserted.some(i => i.table === 'message_originals'),
    'and no window row may point at an object that does not exist');
});

test('the payload keeps `path` meaning the OPTIMISED image', async () => {
  await sendImage({
    conversationId: CONV, fromProfileId: PROFILE,
    image: preparedWithSource(), preserveOriginal: true,
  });

  const { payload } = inserted.find(i => i.table !== 'message_originals').row;
  const optimisedPath = uploads.find(u => u.bucket === 'message-images').path;
  assert.equal(payload.path, optimisedPath,
    'every reader written before M13 resolves this key — it cannot start meaning the original');
  assert.ok(payload.thumb_path, 'the thumbnail is carried separately');
  assert.ok(payload.original.path, 'and the original separately again');
});

// ── EXPIRY ────────────────────────────────────────────────────────────

test('a passed timestamp has expired; a future one has not', () => {
  assert.equal(hasExpired({ expires_at: new Date(Date.now() - 1000).toISOString() }), true);
  assert.equal(hasExpired({ expires_at: new Date(Date.now() + 60000).toISOString() }), false);
});

test('⚠ a null expiry NEVER expires — that is the premium case, and the gate agrees', () => {
  assert.equal(hasExpired({ expires_at: null }), false);
  assert.equal(ORIGINAL_WINDOWS.forever, null);
});

test('the default window is finite', () => {
  assert.ok(ORIGINAL_WINDOWS[DEFAULT_WINDOW] > 0,
    'a default of "forever" would preserve everything by accident');
});

test('the countdown reads naturally and never shows a dead zero', () => {
  const now = Date.now();
  const at = ms => new Date(now + ms).toISOString();

  assert.equal(formatRemaining(at(61 * 3600_000), now), '2d 13h');
  assert.equal(formatRemaining(at(3 * 3600_000 + 20 * 60_000), now), '3h 20m');
  assert.equal(formatRemaining(at(4 * 60_000), now), '4m');
  assert.equal(formatRemaining(at(20_000), now), '1m', 'rounding down would show 0m while it still works');
  assert.equal(formatRemaining(at(-1000), now), null, 'expired reads as nothing, not as a negative');
  assert.equal(formatRemaining(null, now), null, 'never-expires has no countdown to draw');
});

// ── RAW AND TIFF: THE ORIGINAL WITH NO VIEWABLE VERSION ───────────────
//
// No browser decodes a camera raw. That is the HD case at its purest, not a
// failure of it — so the original is stored and the bubble draws a card.

const { sendOriginalOnly, describeOriginal } = await import('./messageImages.js');

const rawFile = (over = {}) => ({
  name: 'DSC_0001.NEF', type: 'application/octet-stream', size: 28_000_000, ...over,
});

test('⚠ a RAW reaches the ORIGINALS bucket even though it cannot be decoded', async () => {
  await sendOriginalOnly({ conversationId: CONV, fromProfileId: PROFILE, file: rawFile() });

  const up = uploads.find(u => u.bucket === 'message-originals');
  assert.ok(up, 'the file a photographer meant to send must be stored');
  assert.equal(up.path.split('/')[0], CONV);
  assert.ok(up.path.endsWith('.nef'), 'the vendor extension survives');
});

test('⚠ NO optimised copy and NO thumbnail are invented for it', async () => {
  await sendOriginalOnly({ conversationId: CONV, fromProfileId: PROFILE, file: rawFile() });

  assert.equal(uploads.filter(u => u.bucket === 'message-images').length, 0,
    'nothing can be re-encoded from a file that cannot be decoded');
});

test('⚠ the payload has NO path — its absence is what draws a card not a picture', async () => {
  await sendOriginalOnly({ conversationId: CONV, fromProfileId: PROFILE, file: rawFile() });

  const { payload, kind } = inserted.find(i => i.table !== 'message_originals').row;
  assert.equal(kind, 'image', 'it is a photograph and belongs with the others');
  assert.equal(payload.path, undefined);
  assert.equal(payload.thumb_path, undefined);
  assert.ok(payload.original.path, 'but the original is there, which is the point');
});

test('the body is the FILENAME — the inbox cannot show a thumbnail that never existed', async () => {
  await sendOriginalOnly({
    conversationId: CONV, fromProfileId: PROFILE, file: rawFile({ name: 'gig-shot.NEF' }),
  });

  assert.equal(inserted.find(i => i.table !== 'message_originals').row.body, 'gig-shot.NEF');
});

test('a RAW still gets its window row, so the gate can sign it', async () => {
  await sendOriginalOnly({ conversationId: CONV, fromProfileId: PROFILE, file: rawFile() });

  const row = inserted.find(i => i.table === 'message_originals');
  assert.ok(row, 'without this the original is unreadable by everyone');
  assert.ok(row.row.expires_at);
  assert.equal(row.row.bytes, 28_000_000);
});

test('⚠ dimensions are ABSENT rather than guessed for an undecodable file', async () => {
  await sendOriginalOnly({ conversationId: CONV, fromProfileId: PROFILE, file: rawFile() });

  const { payload } = inserted.find(i => i.table !== 'message_originals').row;
  assert.equal(payload.original.width, null,
    'a made-up size describes the picture wrongly to the one person who cannot see it');
  assert.equal(payload.original.height, null);
});

test('a failed upload sends no message at all', async () => {
  failBucket = 'message-originals';

  const { message, error } = await sendOriginalOnly({
    conversationId: CONV, fromProfileId: PROFILE, file: rawFile(),
  });

  assert.equal(message, null);
  assert.ok(error);
  assert.equal(inserted.length, 0);
});

// ── DESCRIBING WHAT IS BEING DOWNLOADED ───────────────────────────────


test('real dimensions win when we actually know them', () => {
  assert.equal(describeOriginal({ width: 4032, height: 3024 }, 'x.jpg'), '4032 × 3024');
});

test('⚠ a raw file is described by TYPE, never by an invented resolution', () => {
  // The embedded preview may be 1920×1280 while the file is 8256×5504. A
  // specific, checkable, wrong number is worse than no number.
  assert.equal(describeOriginal({ width: null, height: null }, 'DSC_0001.NEF'), 'Nikon RAW (.NEF)');
  assert.equal(describeOriginal({}, 'IMG_1234.CR3'), 'Canon RAW (.CR3)');
  assert.equal(describeOriginal({}, 'A7R00123.ARW'), 'Sony RAW (.ARW)');
  assert.equal(describeOriginal({}, 'DSCF8899.RAF'), 'Fujifilm RAW (.RAF)');
  assert.equal(describeOriginal({}, 'P1000123.RW2'), 'Panasonic RAW (.RW2)');
  assert.equal(describeOriginal({}, 'PA150001.ORF'), 'OM System RAW (.ORF)');
});

test('DNG is not attributed to a maker — anyone can write one', () => {
  assert.equal(describeOriginal({}, 'shot.dng'), 'Camera RAW (.DNG)');
});

test('other types still say something true', () => {
  assert.equal(describeOriginal({}, 'scan.tiff'), 'TIFF');
  assert.equal(describeOriginal({}, 'poster.png'), 'PNG');
});

test('it falls back to the stored path when no name is carried', () => {
  assert.equal(describeOriginal({ path: 'conv-id/abc.nef' }), 'Nikon RAW (.NEF)');
});

test('it never renders empty, whatever it is given', () => {
  assert.equal(describeOriginal({}, ''), 'Original file');
  assert.equal(describeOriginal(null), 'Original file');
});

test('a zero dimension is treated as unknown, not printed as 0', () => {
  assert.equal(describeOriginal({ width: 0, height: 0 }, 'x.NEF'), 'Nikon RAW (.NEF)');
});
