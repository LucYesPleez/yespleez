import { test } from 'node:test';
import assert from 'node:assert/strict';

import { orientationToApply } from './imageUtils.js';

/**
 * THE BUG THIS FILE EXISTS TO PREVENT (2026-07-22).
 *
 * Every current browser applies EXIF orientation itself when decoding a JPEG.
 * `loadCorrectedCanvas` applied it a SECOND time, so the first real photo sent
 * through M11 arrived rotated a further 90° clockwise — landscape, on its side.
 *
 * It is a silent failure: the code reads as obviously correct, every test of
 * the upload path passed, and nothing but a human looking at a photograph could
 * see it. Hence a test on the decision itself.
 */

/** An iPhone portrait photo: encoded landscape, tagged "rotate 90° CW". */
const PHONE_PORTRAIT = { orientation: 6, rawWidth: 4032, rawHeight: 3024 };

test('⚠ the browser already rotated it — this code must do NOTHING', () => {
  // Decoded dims are the TRANSPOSE of the encoded ones: proof of rotation.
  const apply = orientationToApply({
    ...PHONE_PORTRAIT, naturalWidth: 3024, naturalHeight: 4032,
  });

  assert.equal(apply, 1, 'applying orientation 6 here is the sideways-photo bug');
});

test('a browser that did NOT rotate still gets the full correction', () => {
  // Decoded dims match the file: the browser left it alone.
  const apply = orientationToApply({
    ...PHONE_PORTRAIT, naturalWidth: 4032, naturalHeight: 3024,
  });

  assert.equal(apply, 6, 'without this, legacy browsers would send it sideways');
});

test('all four quarter turns are detected, not just orientation 6', () => {
  for (const orientation of [5, 6, 7, 8]) {
    const rotated = orientationToApply({
      orientation, rawWidth: 4032, rawHeight: 3024,
      naturalWidth: 3024, naturalHeight: 4032,
    });
    assert.equal(rotated, 1, `orientation ${orientation}: browser rotated, apply nothing`);

    const untouched = orientationToApply({
      orientation, rawWidth: 4032, rawHeight: 3024,
      naturalWidth: 4032, naturalHeight: 3024,
    });
    assert.equal(untouched, orientation, `orientation ${orientation}: browser did not rotate`);
  }
});

test('an upright photo is never transformed', () => {
  const apply = orientationToApply({
    orientation: 1, rawWidth: 3024, rawHeight: 4032,
    naturalWidth: 3024, naturalHeight: 4032,
  });
  assert.equal(apply, 1);
});

// ── WHERE MEASUREMENT IS IMPOSSIBLE ───────────────────────────────────
//
// 2, 3 and 4 are flips and a 180° turn. They preserve dimensions, so nothing
// can be read from them — the fallback is "the browser did it", because no
// browser auto-orients quarter turns but not flips.

test('a square image cannot be measured, and is left alone', () => {
  const apply = orientationToApply({
    orientation: 6, rawWidth: 2000, rawHeight: 2000,
    naturalWidth: 2000, naturalHeight: 2000,
  });

  // Transpose of a square is itself, so `browserRotated` reads true — and that
  // is the SAFE answer: current browsers have rotated it.
  assert.equal(apply, 1);
});

test('dimension-preserving tags fall back to trusting the browser', () => {
  for (const orientation of [2, 3, 4]) {
    assert.equal(orientationToApply({
      orientation, rawWidth: 3024, rawHeight: 4032,
      naturalWidth: 3024, naturalHeight: 4032,
    }), 1);
  }
});

test('a file whose raw dimensions could not be read is left alone', () => {
  // A JPEG whose SOF marker sat beyond the bytes read, or a PNG/WebP with no
  // marker at all. Guessing here is what produces a sideways photo.
  const apply = orientationToApply({
    orientation: 6, rawWidth: 0, rawHeight: 0,
    naturalWidth: 3024, naturalHeight: 4032,
  });

  assert.equal(apply, 1);
});

test('a missing orientation tag is treated as upright', () => {
  assert.equal(orientationToApply({ orientation: 0 }), 1);
  assert.equal(orientationToApply({ orientation: undefined }), 1);
});
