/**
 * EVENT IMAGES MUST NOT OVERWRITE EACH OTHER — the storage-path invariant.
 *
 * ⚠⚠ THIS IS A DATA-LOSS REGRESSION TEST. Covers and posters were stored under
 * a literal `new` segment — `event_covers/<userId>/new/cover.webp` — and the
 * id in that path is the USER, not the event. One path therefore served every
 * event a person ever illustrated, and the upload is an upsert, so each new
 * cover destroyed the previous event's. Reported as covers going missing;
 * two of three were genuinely gone from the bucket.
 *
 * ⭐ IT LOOKED CORRECT IN THE EDITOR, WHICH IS WHY IT LIVED SO LONG. Every
 * upload returns a `?v=<stamp>` URL, so the browser cached each one separately
 * and every event showed the right picture for the rest of the session. Only a
 * reload — or a different person — read what was actually stored. So the test
 * that catches it has to assert on the PATH SENT TO STORAGE, never on the URL
 * handed back.
 *
 * ⛔ Do not relax this to "the URLs differ". The URLs differed throughout the
 * entire bug.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const uploads = [];   // every storage path written, in order
const resizes = [];   // every { outW, outH } asked for, to prove arg order

// uploadImage.js imports supabase at module scope, and that file reads
// import.meta.env — a Vite construct absent under plain Node.
mock.module('./supabase', {
  exports: {
    supabase: {
      storage: {
        from: () => ({
          upload: async (path) => { uploads.push(path); return { error: null }; },
          getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
        }),
      },
    },
  },
});

// Canvas work is browser-only; the geometry is what matters here, not pixels.
mock.module('./imageUtils', {
  exports: {
    resizeCanvas: (canvas, outW, outH) => { resizes.push({ outW, outH }); return canvas; },
    canvasToBlob: async () => ({ blob: { type: 'image/webp' }, ext: 'webp' }),
  },
});

const { uploadCover, uploadPoster } = await import('./uploadImage.js');

const canvas = (width, height) => ({ width, height });

test('two covers from ONE user never share a storage path', async () => {
  uploads.length = 0;
  await uploadCover(canvas(1800, 1200), 'user-1');
  await uploadCover(canvas(1800, 1200), 'user-1');

  assert.equal(uploads.length, 4, 'each cover writes a full-size and a thumb');
  assert.equal(new Set(uploads).size, 4,
    'Four uploads, four distinct paths. A collision here means the second ' +
    'event just overwrote the first event\'s cover in the bucket.');
});

test('no event image is stored under the shared `new` segment', async () => {
  uploads.length = 0;
  await uploadCover(canvas(1800, 1200), 'user-1');
  await uploadPoster(canvas(1000, 1250), 'user-1');

  for (const path of uploads) {
    assert.doesNotMatch(path, /\/new\//,
      `'${path}' uses the fixed segment that made one path serve every event.`);
  }
});

test('two posters from ONE user never share a storage path', async () => {
  uploads.length = 0;
  await uploadPoster(canvas(1000, 1250), 'user-1');
  await uploadPoster(canvas(1000, 1250), 'user-1');

  assert.equal(new Set(uploads).size, uploads.length,
    'Posters carry the same defect as covers and the same fix.');
});

/**
 * ⚠ THE ARGUMENT-ORDER GUARD. `uploadPoster` used to be
 * (canvas, uid, suffix, originalCanvas) and the suffix was dropped when it
 * became unique-per-upload. Anyone re-adding a third string argument would
 * silently push originalCanvas out of position — and because the fallback is
 * `originalCanvas || canvas`, the poster would still upload, just cropped to
 * the wrong source. Layout spec §0.1: the Poster may not crop.
 */
test('uploadPoster reads the UNCROPPED original for its aspect', async () => {
  resizes.length = 0;
  await uploadPoster(canvas(800, 800), 'user-1', canvas(2000, 1000));

  // The original is 2:1, so 1600 wide must ask for 800 high. If the cropped
  // 1:1 canvas were used instead it would ask for 1600.
  assert.deepEqual(resizes[0], { outW: 1600, outH: 800 },
    'The poster must be rendered at the ORIGINAL artwork\'s aspect.');
});
