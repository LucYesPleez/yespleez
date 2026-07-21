import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const CONV    = '11111111-1111-1111-1111-111111111111';
const PROFILE = '22222222-2222-2222-2222-222222222222';
const USER    = '33333333-3333-3333-3333-333333333333';

let uploads   = [];
let signs     = [];
let inserted  = [];
let uploadResult = { error: null };

mock.module('./supabase', {
  exports: {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
      storage: {
        from(bucket) {
          return {
            upload: async (path, blob, opts) => {
              uploads.push({ bucket, path, blob, opts });
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
  uploadVoiceNote, signedUrlFor, sendVoiceNote,
  baseMimeType, VOICE_FALLBACK_BODY,
} = await import('./voiceNotes.js');

beforeEach(() => {
  uploads = [];
  signs = [];
  inserted = [];
  uploadResult = { error: null };
});

/** Node has no Blob-from-recorder; size and type are all this code reads. */
function fakeBlob(type = 'audio/webm', size = 2048) {
  return { size, type };
}

// ── the path IS the access control (M9b) ────────────────────────────

test('the conversation id is the first path segment', async () => {
  // M9b's policies read (storage.foldername(name))[1] to decide who may write
  // and who may read. Any other shape is refused by the bucket — so this is an
  // access-control assertion, not a naming convention.
  const { path, error } = await uploadVoiceNote({ conversationId: CONV, blob: fakeBlob() });

  assert.equal(error, null);
  assert.equal(path.split('/')[0], CONV);
  assert.equal(uploads.at(-1).bucket, 'voice-notes');
});

test('the upload never overwrites', async () => {
  // upsert would let a second upload replace audio an existing message points
  // at — editing a sent message through the back door.
  await uploadVoiceNote({ conversationId: CONV, blob: fakeBlob() });
  assert.equal(uploads.at(-1).opts.upsert, false);
});

test('the content type is stripped of codec parameters', async () => {
  // The bucket's allowed_mime_types has no parameters. MediaRecorder reports
  // 'audio/webm;codecs=opus', which storage would reject as a type it allows.
  await uploadVoiceNote({ conversationId: CONV, blob: fakeBlob('audio/webm;codecs=opus') });
  assert.equal(uploads.at(-1).opts.contentType, 'audio/webm');
  assert.equal(baseMimeType('audio/webm;codecs=opus'), 'audio/webm');
});

test('an empty recording is refused before it reaches storage', async () => {
  const { path, error } = await uploadVoiceNote({ conversationId: CONV, blob: fakeBlob('audio/webm', 0) });
  assert.equal(path, null);
  assert.ok(error);
  assert.equal(uploads.length, 0, 'a zero-byte upload should never be attempted');
});

// ── the payload stores a path, never a url ──────────────────────────

test('the stored payload holds a path and no url', async () => {
  // A signed url expires. Persisting one puts a value in a never-updated row
  // that is correct for an hour and permanently wrong afterwards — the message
  // would play on the day it was sent and be broken by morning.
  await sendVoiceNote({ conversationId: CONV, fromProfileId: PROFILE, blob: fakeBlob(), durationMs: 4200 });

  const { payload } = inserted.at(-1).row;
  assert.ok(payload.path, 'payload must carry the storage path');
  assert.equal(payload.duration_ms, 4200);

  const serialised = JSON.stringify(payload);
  assert.doesNotMatch(serialised, /^.*https?:\/\//, 'no url may be persisted in the payload');
  assert.equal(signs.length, 0, 'sending must not mint a signed url at all');
});

test('a playback url is minted on demand and expires', async () => {
  const { url, error } = await signedUrlFor(`${CONV}/abc.webm`);
  assert.equal(error, null);
  assert.match(url, /^https:\/\/signed\.example\//);
  assert.ok(signs.at(-1).expiresIn > 0, 'a url with no expiry is a public url with extra steps');
});

// ── a voice note is a message, not a special case ───────────────────

test('a voice note sends through the normal message path with kind voice', async () => {
  await sendVoiceNote({ conversationId: CONV, fromProfileId: PROFILE, blob: fakeBlob(), durationMs: 1000 });

  const { table, row } = inserted.at(-1);
  assert.equal(table, 'messages');
  assert.equal(row.kind, 'voice');
  assert.equal(row.from_profile_id, PROFILE);
  assert.equal(row.from_user_id, USER, '§A3 — the audit identity is still the session user');
});

test('a voice note carries legible fallback text', async () => {
  // M9a keeps body non-blank for every kind because an inbox preview, a push
  // notification and a screen reader only ever see text. An empty body is
  // silent in all three.
  await sendVoiceNote({ conversationId: CONV, fromProfileId: PROFILE, blob: fakeBlob(), durationMs: 1000 });
  assert.equal(inserted.at(-1).row.body, VOICE_FALLBACK_BODY);
  assert.ok(VOICE_FALLBACK_BODY.trim().length > 0);
});

test('a failed upload sends no message at all', async () => {
  // Upload first, insert second. A row pointing at audio that never arrived
  // renders as a broken player while the sender believes it went.
  uploadResult = { error: { message: 'storage exploded' } };

  const { message, error } = await sendVoiceNote({
    conversationId: CONV, fromProfileId: PROFILE, blob: fakeBlob(), durationMs: 1000,
  });

  assert.equal(message, null);
  assert.ok(error, 'the failure must reach the caller');
  assert.equal(inserted.length, 0, 'no row may exist for audio that failed to upload');
});
