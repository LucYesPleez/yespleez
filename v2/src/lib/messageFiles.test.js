import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const CONV    = '11111111-1111-1111-1111-111111111111';
const PROFILE = '22222222-2222-2222-2222-222222222222';
const USER    = '33333333-3333-3333-3333-333333333333';

let uploads  = [];
let signs    = [];
let inserted = [];
let uploadResult = { error: null };

mock.module('./supabase', {
  exports: {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
      storage: {
        from(bucket) {
          return {
            upload: async (path, file, opts) => {
              uploads.push({ bucket, path, file, opts });
              return uploadResult;
            },
            createSignedUrl: async (path, expiresIn, opts) => {
              signs.push({ bucket, path, expiresIn, opts });
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
  uploadMessageFile, downloadUrlFor, sendFile,
  safeName, bodyForFile, formatBytes, formatToken, isLosslessAudio, MAX_BYTES, WAVE_CEILING_BYTES,
} = await import('./messageFiles.js');

beforeEach(() => {
  uploads = [];
  signs = [];
  inserted = [];
  uploadResult = { error: null };
});

function fakeFile(over = {}) {
  return { name: 'rider-2026.pdf', type: 'application/pdf', size: 240_000, ...over };
}

// ── THE FILENAME IS ATTACKER-CONTROLLED ───────────────────────────────
//
// It is chosen by the SENDER and rendered to the RECIPIENT. Every other value
// in this module comes from us or from the platform; this one does not.

test('⚠ path separators are neutralised — a name is a label, never a location', () => {
  assert.equal(safeName('../../etc/passwd'), '.._.._etc_passwd');
  assert.equal(safeName('folder\\file.pdf'), 'folder_file.pdf');
});

test('⚠ a bidi override cannot make a filename lie about its type', () => {
  // U+202E reverses what follows, so this renders as "docexe.pdf" in any UI
  // honouring it — an executable that reads as a document.
  const deceptive = 'doc\u202Efdp.exe';
  const safe = safeName(deceptive);

  assert.ok(!safe.includes('\u202E'), 'the override must be stripped');
  assert.equal(safe, 'docfdp.exe', 'what is left must read as what it is');
});

test('control characters are stripped', () => {
  assert.equal(safeName('re\u0000port\u001F.pdf'), 'report.pdf');
});

test('⚠ a very long name is truncated — the bubble cannot be made screen-sized', () => {
  const long = `${'a'.repeat(400)}.pdf`;
  const safe = safeName(long);

  assert.ok(safe.length <= 120, `got ${safe.length} characters`);
  assert.ok(safe.endsWith('a.pdf') || safe.includes('…'), 'the tail is kept so the type stays visible');
});

test('an empty or missing name never becomes an empty body', () => {
  // messages_body_not_blank would reject the row.
  assert.equal(bodyForFile(''), 'Attachment');
  assert.equal(bodyForFile(null), 'Attachment');
  assert.ok(bodyForFile('  ').trim().length > 0);
});

// ── THE STORAGE PATH ──────────────────────────────────────────────────

test('⚠ the object path STARTS with the conversation id — M12 policies read it', async () => {
  await uploadMessageFile({ conversationId: CONV, file: fakeFile() });

  const [segment] = uploads[0].path.split('/');
  assert.equal(segment, CONV, 'the first segment must be the conversation or RLS can never match');
});

test('⚠ the stored key is a uuid, NOT the user-supplied filename', async () => {
  await uploadMessageFile({ conversationId: CONV, file: fakeFile({ name: 'rider-2026.pdf' }) });

  const key = uploads[0].path.split('/')[1];
  assert.ok(!key.includes('rider'), 'an attacker-controlled value must not decide where an object lands');
  assert.ok(key.endsWith('.pdf'), 'the extension is kept so a bucket listing stays readable');
});

test('it uploads to the private message-files bucket, not the image one', async () => {
  await uploadMessageFile({ conversationId: CONV, file: fakeFile() });

  assert.equal(uploads[0].bucket, 'message-files');
  assert.notEqual(uploads[0].bucket, 'message-images');
});

test('upsert is false — a sent attachment cannot be swapped after the fact', async () => {
  await uploadMessageFile({ conversationId: CONV, file: fakeFile() });
  assert.equal(uploads[0].opts.upsert, false);
});

test('⚠ an oversized file is refused BEFORE the upload starts', async () => {
  const { path, error } = await uploadMessageFile({
    conversationId: CONV, file: fakeFile({ size: MAX_BYTES + 1 }),
  });

  assert.equal(path, null);
  assert.ok(error);
  assert.match(error.message, /limit/i, 'the message has to say what went wrong');
  assert.equal(uploads.length, 0, 'nothing may be sent before the size is known to fit');
});

test('a file with no type still uploads, as a generic binary', async () => {
  await uploadMessageFile({ conversationId: CONV, file: fakeFile({ type: '' }) });
  assert.equal(uploads[0].opts.contentType, 'application/octet-stream');
});

// ── THE MESSAGE ROW ───────────────────────────────────────────────────

test('the payload carries the path and the real name, never a url', async () => {
  await sendFile({ conversationId: CONV, fromProfileId: PROFILE, file: fakeFile() });

  const { payload, kind, body } = inserted[0].row;
  assert.equal(kind, 'file');
  assert.ok(payload.path.startsWith(`${CONV}/`));
  assert.equal(payload.name, 'rider-2026.pdf');
  assert.equal(payload.bytes, 240_000);
  assert.equal(payload.url, undefined, 'a persisted url would outlive its signature');
  assert.equal(body, 'rider-2026.pdf', 'the inbox and push read the filename');
});

test('the body is the SANITISED name, not the raw one', async () => {
  await sendFile({
    conversationId: CONV, fromProfileId: PROFILE,
    file: fakeFile({ name: '../secret\u202Egnp.exe' }),
  });

  const { body, payload } = inserted[0].row;
  assert.ok(!body.includes('\u202E'), 'the inbox preview must not render an override either');
  assert.ok(!payload.name.includes('/'));
});

test('⚠ a failed upload sends NO message at all', async () => {
  uploadResult = { error: { message: 'storage refused' } };

  const { message, error } = await sendFile({
    conversationId: CONV, fromProfileId: PROFILE, file: fakeFile(),
  });

  assert.equal(message, null);
  assert.ok(error);
  assert.equal(inserted.length, 0, 'no row may point at a file that was never stored');
});

// ── READING IT BACK ───────────────────────────────────────────────────

test('⚠ the download url asks for an attachment header, so nothing renders in place', async () => {
  await downloadUrlFor(`${CONV}/abc.pdf`, 'rider-2026.pdf');

  assert.equal(signs[0].bucket, 'message-files');
  assert.ok(signs[0].opts?.download, 'without this a PDF or HTML file opens on our storage origin');
  assert.ok(signs[0].expiresIn > 0, 'a non-expiring url would defeat the private bucket');
});

test('signing without a path is refused rather than sent to storage', async () => {
  const { url, error } = await downloadUrlFor(null, 'x.pdf');

  assert.equal(url, null);
  assert.ok(error);
  assert.equal(signs.length, 0);
});

// ── PRESENTATION ──────────────────────────────────────────────────────

test('sizes read the way a person expects', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(900), '900 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});

// ── HD AUDIO (M13's label, M12's storage) ─────────────────────────────
//
// "Upload HD audio" is a LABEL, not a mechanism: the file takes the identical
// path a document takes. These pin that down, because the obvious mistake later
// is to give it an expiry to match image originals — and an audio master sent
// to a promoter has to still be there next month.

test('an HD audio file is marked, so the bubble can say how it was sent', async () => {
  await sendFile({
    conversationId: CONV, fromProfileId: PROFILE,
    file: fakeFile({ name: 'master.wav', type: 'audio/wav', size: 31_000_000 }),
  });

  assert.equal(inserted[0].row.payload.hd, true);
});

test('an ordinary file carries no hd flag at all, rather than false', async () => {
  await sendFile({ conversationId: CONV, fromProfileId: PROFILE, file: fakeFile() });
  assert.equal(inserted[0].row.payload.hd, undefined,
    'absent beats a key holding false — the renderer asks "is this HD", and both answer identically while one costs bytes on every read');
});

test('⚠ HD audio does NOT expire — only image originals are temporary', async () => {
  await sendFile({
    conversationId: CONV, fromProfileId: PROFILE,
    file: fakeFile({ name: 'master.wav', type: 'audio/wav' }),
  });

  const { payload } = inserted[0].row;
  assert.equal(payload.expires_at, undefined);
  assert.equal(payload.original, undefined);
  assert.ok(!inserted.some(i => i.table === 'message_originals'),
    'no window row: an audio master has no permanent optimised copy standing in for it');
});

test('⚠ a 30MB lossless master fits — the row exists precisely for these', async () => {
  const { path, error } = await uploadMessageFile({
    conversationId: CONV,
    file: fakeFile({ name: 'master.wav', type: 'audio/wav', size: 31_457_280 }),
  });

  assert.ok(path, `a three-minute WAV must not be refused: ${error?.message}`);
  assert.ok(MAX_BYTES >= 31_457_280, 'the client cap has to clear real lossless audio');
});

test('the stored extension survives for audio, so a bucket listing stays readable', async () => {
  await uploadMessageFile({
    conversationId: CONV, file: fakeFile({ name: 'master.wav', type: 'audio/wav' }),
  });
  assert.ok(uploads[0].path.endsWith('.wav'));
});

// ── THE CHIP IS A VERIFIED CLAIM ──────────────────────────────────────
//
// It used to follow which menu row was tapped, so an MP3 through "Upload HD
// audio" wore the chip while being lossy. Now the FILE decides.

test('⚠ an MP3 never gets the chip, whichever row it came through', async () => {
  await sendFile({
    conversationId: CONV, fromProfileId: PROFILE,
    file: fakeFile({ name: 'bounce.mp3', type: 'audio/mpeg' }),
  });

  assert.equal(inserted[0].row.payload.hd, undefined,
    'a chip on lossy audio certifies nothing');
});

test('⚠ a WAV through the ORDINARY file row still earns the chip', async () => {
  // The row chooses the picker; the file earns the mark.
  await sendFile({
    conversationId: CONV, fromProfileId: PROFILE,
    file: fakeFile({ name: 'master.wav', type: 'audio/wav' }),
  });

  assert.equal(inserted[0].row.payload.hd, true);
});

test('every lossless format is recognised, by extension alone if need be', () => {
  // Browsers routinely report no mime for these.
  assert.ok(isLosslessAudio('master.wav', ''));
  assert.ok(isLosslessAudio('take3.aiff', ''));
  assert.ok(isLosslessAudio('take3.aif', ''));
  assert.ok(isLosslessAudio('album.flac', ''));
  assert.ok(isLosslessAudio('noext', 'audio/x-wav'), 'mime rescues a missing extension');
});

test('⚠ m4a is NEVER lossless here — the container hides whether it is ALAC or AAC', () => {
  assert.equal(isLosslessAudio('song.m4a', 'audio/mp4'), false,
    'a chip that is right most of the time is a chip that lies some of the time');
});

test('the metadata line has a format token for anything with a name', () => {
  assert.equal(formatToken('master.wav', ''), 'WAV');
  assert.equal(formatToken('rider.pdf', ''), 'PDF');
  assert.equal(formatToken('noext', 'application/zip'), 'ZIP');
  assert.equal(formatToken('', ''), '');
});

// ── PLAYBACK vs DOWNLOAD: TWO URLS WITH ONE DIFFERENCE ────────────────

const { playbackUrlFor, isPlayableAudio: playable } = await import('./messageFiles.js');

test('⚠ the playback url has NO attachment header — an <audio> element refuses one', async () => {
  await playbackUrlFor(`${CONV}/abc.wav`);

  assert.equal(signs[0].bucket, 'message-files');
  assert.equal(signs[0].opts, undefined,
    'the download disposition is exactly what stops streaming from working');
});

test('WAV, FLAC and MP3 play inline; AIFF does not', () => {
  assert.ok(playable('master.wav', ''));
  assert.ok(playable('album.flac', ''));
  assert.ok(playable('bounce.mp3', ''));
  // Chrome and Android cannot decode AIFF at all. A play button that works on
  // the sender's iPhone and silently fails on the recipient's Pixel is worse
  // than a download card that works for both.
  assert.equal(playable('take.aiff', ''), false);
  assert.equal(playable('rider.pdf', 'application/pdf'), false);
});

// ── SENDER-CONTROLLED DOWNLOAD, AND THE WAVEFORM ──────────────────────

test('⚠ downloadable is ABSENT when allowed — only a refusal is stored', async () => {
  await sendFile({ conversationId: CONV, fromProfileId: PROFILE, file: fakeFile() });

  assert.equal(inserted[0].row.payload.downloadable, undefined,
    'every file sent before this existed must stay downloadable, not silently lock');
});

test('a refusal is recorded so the recipient hides the affordance', async () => {
  await sendFile({
    conversationId: CONV, fromProfileId: PROFILE,
    file: fakeFile({ name: 'master.wav', type: 'audio/wav' }),
    downloadable: false,
  });

  assert.equal(inserted[0].row.payload.downloadable, false);
});

test('⚠ refusing download changes NOTHING about how the file is stored', async () => {
  // It is a courtesy, not a control: the bytes sit in the same bucket, readable
  // by every participant, because that is what makes playback work.
  await sendFile({
    conversationId: CONV, fromProfileId: PROFILE,
    file: fakeFile({ name: 'master.wav', type: 'audio/wav' }),
    downloadable: false,
  });

  assert.equal(uploads[0].bucket, 'message-files');
  assert.equal(uploads[0].opts.upsert, false);
});

test('peaks travel in the payload, so a recipient never decodes 30MB to draw one', async () => {
  const wave = { v: 2, peaks: [0.1, 0.9, 0.4] };
  await sendFile({
    conversationId: CONV, fromProfileId: PROFILE,
    file: fakeFile({ name: 'master.wav', type: 'audio/wav' }), wave,
  });

  assert.deepEqual(inserted[0].row.payload.wave, wave);
});

test('no wave is carried when none was computed', async () => {
  await sendFile({ conversationId: CONV, fromProfileId: PROFILE, file: fakeFile() });
  assert.equal(inserted[0].row.payload.wave, undefined);
});

test('⚠ the decode ceiling sits well under the upload limit', () => {
  // Above it, a file still sends and simply has no waveform. If the two were
  // equal, every sendable file would be decoded and the largest would kill the
  // tab mid-send.
  assert.ok(WAVE_CEILING_BYTES < MAX_BYTES,
    'a file can be sendable without being safe to decode on a phone');
});
