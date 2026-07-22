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

// ── the duration readout ────────────────────────────────────────────

test('durations pad the seconds and never go negative', async () => {
  const { formatDuration } = await import('./voiceNotes.js');
  assert.equal(formatDuration(7),    '0:07', 'unpadded seconds read as 0:7');
  assert.equal(formatDuration(0),    '0:00');
  assert.equal(formatDuration(65),   '1:05');
  assert.equal(formatDuration(600),  '10:00');
  assert.equal(formatDuration(-5),   '0:00', 'a negative position must not render as -0:-5');
  assert.equal(formatDuration(NaN),  '0:00', 'audio duration is NaN until metadata loads');
  assert.equal(formatDuration(undefined), '0:00');
});

/* ── §6.2's bitrate is per CODEC, not one constant ──────────────────── */

test('⚠ AAC gets a higher bitrate than Opus for the same quality bar', async () => {
  // 32 kbps was ratified against Opus, where 48 kHz mono speech is near
  // transparent. Safari cannot record Opus — it produces AAC-LC — and AAC at
  // 32 kbps mono is audibly poor. Reported from an iPhone 14 Pro 2026-07-22:
  // recording worked and sounded bad, on hardware whose mic is not the problem.
  const { bitrateFor } = await import('./voiceNotes.js');

  assert.equal(bitrateFor('audio/webm;codecs=opus'), 48000);
  assert.equal(bitrateFor('audio/ogg;codecs=opus'),  48000);
  assert.equal(bitrateFor('audio/mp4'),              64000);
  assert.equal(bitrateFor('audio/mpeg'),             64000);
});

test('the codec is matched on the BASE type, so parameters cannot defeat it', async () => {
  // Safari negotiates 'audio/mp4;codecs=mp4a.40.2'. Keying on the full string
  // would miss it and silently hand AAC the Opus rate — which is precisely the
  // bug, restored.
  const { bitrateFor } = await import('./voiceNotes.js');
  assert.equal(bitrateFor('audio/mp4;codecs=mp4a.40.2'), 64000);
});

test('an unknown codec falls back to the ratified Opus rate', async () => {
  const { bitrateFor } = await import('./voiceNotes.js');
  assert.equal(bitrateFor('audio/flac'), 48000);
  assert.equal(bitrateFor(undefined),    48000);
});

/* ── the iOS capture rule ───────────────────────────────────────────── */

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC    = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36';

test('iPhone and iPad are iOS; Android and a real Mac are not', async () => {
  const { isIOS } = await import('./voiceNotes.js');

  assert.equal(isIOS({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 }), true);
  assert.equal(isIOS({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5 }), false);

  // ⚠ iPadOS 13+ reports a desktop Mac UA. Touch points are the only tell.
  assert.equal(isIOS({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5 }), true, 'an iPad must be caught');

  // ⚠ And a REAL Mac must not match — Safari on macOS does not have this fault,
  // so matching it would give desktop users the degraded-insurance path for no
  // reason at all.
  assert.equal(isIOS({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0 }), false, 'a real Mac must not be caught');
});

test('no navigator is not iOS, and does not throw', async () => {
  // node:test imports this module with no DOM at all.
  const { isIOS } = await import('./voiceNotes.js');
  assert.equal(isIOS(null), false);
  assert.equal(isIOS({}), false);
});

/* ── §6.1 amendment: iOS asks for nothing about DSP ─────────────────── */

test('⚠ iOS requests NO dsp constraints, so Apple picks its own speech path', async () => {
  // The point is the OMISSION. Naming `echoCancellation: true` would be us
  // choosing a configuration; asking for nothing takes the platform's own tuned
  // default, which is what iMessage and WhatsApp effectively get and the thing
  // actually being copied.
  //
  // Measured 2026-07-22: with `echoCancellation: false` — the one DSP
  // constraint Safari honours — an iPhone 14 Pro rated 1/5 against a Galaxy's
  // 5/5 on identical codec, bitrate and sample rate.
  const { IOS_CAPTURE_CONSTRAINTS } = await import('./voiceNotes.js');

  // The rate and channel hints were dropped after "better, but a bit hissy": a
  // rate hint can force iOS to resample or decline its voice-processing unit,
  // and neither bought anything (iOS reports mono already, and Opus stores
  // 48 kHz regardless of what the microphone track says).
  //
  // ⚠ TOTAL. Not an object with the DSP keys left out — `true`, every
  // constraint surrendered.
  //
  // `noiseSuppression: true` was tried here on 2026-07-22 and reverted the same
  // day: a fresh iOS note came back `noise_suppression: null` with the
  // constraint explicitly requested, proving Safari ignores it. The same note
  // showed `echo_cancellation: true`, so Apple's NR was already on — there was
  // never a second switch to throw. Do not add it back.
  assert.equal(IOS_CAPTURE_CONSTRAINTS, true,
    'any object here is us describing the capture again, which is what kept making it worse');
});

test('⚠ every OTHER platform keeps C20 exactly as ratified', async () => {
  // The amendment is iOS-only. A change that quietly enabled DSP on Android
  // would undo the single largest quality decision in this file, on the
  // platform where the raw path measures WELL.
  const src = await import('node:fs').then(fs => fs.readFileSync('src/lib/voiceNotes.js', 'utf8'));
  const exact = src.slice(src.indexOf('const EXACT_CAPTURE_CONSTRAINTS'), src.indexOf('const EXACT_CAPTURE_CONSTRAINTS') + 320);

  assert.match(exact, /echoCancellation: { exact: false }/);
  assert.match(exact, /noiseSuppression: { exact: false }/);
  assert.match(exact, /autoGainControl:  { exact: false }/);
});
