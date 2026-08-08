import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findLargestJpeg } from './imageUtils.js';

/**
 * PULLING THE JPEG OUT OF A RAW FILE.
 *
 * No browser decodes a NEF or a CR3, but every camera embeds ordinary JPEGs
 * inside its raw files so its own screen can show the shot. Finding the big one
 * is what lets a photographer's RAW appear in the thread as a photograph.
 *
 * ⚠ THE FAILURE MODE IS SILENT. A wrong answer here returns null and the photo
 * quietly becomes a grey card — nothing throws, nothing logs. Hence a test on
 * the scan itself.
 */

/** A JPEG: FF D8 FF, filler, FF D9. */
function jpeg(size, fill = 0x42) {
  const b = new Uint8Array(size).fill(fill);
  b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF;
  b[size - 2] = 0xFF; b[size - 1] = 0xD9;
  return b;
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const noise = n => new Uint8Array(n).fill(0x11);

test('it finds a single embedded jpeg', () => {
  const found = findLargestJpeg(concat(noise(500), jpeg(40_000), noise(200)));

  assert.ok(found);
  assert.equal(found.start, 500);
  assert.equal(found.size, 40_000);
});

test('⚠ it takes the LARGEST — a raw holds a thumbnail AND a full preview', () => {
  // The camera writes the small one first, which is exactly why "first match"
  // is the wrong rule: it would put a postage stamp in the message bubble.
  const found = findLargestJpeg(concat(jpeg(30_000, 0xA1), noise(64), jpeg(900_000, 0xB2)));

  assert.equal(found.size, 900_000);
  assert.equal(found.start, 30_000 + 64);
});

test('⚠ a tiny icon is ignored — it would render as a corrupted photo', () => {
  assert.equal(findLargestJpeg(concat(noise(10), jpeg(6_000))), null,
    'below the floor, nothing is better than a 6KB thumbnail blown up');
});

test('the floor is adjustable, and honoured', () => {
  const bytes = concat(jpeg(30_000));
  assert.equal(findLargestJpeg(bytes, { minBytes: 100_000 }), null);
  assert.ok(findLargestJpeg(bytes, { minBytes: 1_000 }));
});

test('⚠ FF D8 without the third FF is not a start marker', () => {
  // This pair occurs constantly inside compressed sensor data. Treating it as a
  // header sends the scan hunting through megabytes and can return garbage.
  const decoy = new Uint8Array(50_000).fill(0x11);
  decoy[100] = 0xFF; decoy[101] = 0xD8; decoy[102] = 0x00;   // not FF
  decoy[49_000] = 0xFF; decoy[49_001] = 0xD9;

  assert.equal(findLargestJpeg(decoy), null);
});

test('⚠ a start marker INSIDE an image never produces a nested fragment', () => {
  // FF D8 FF does occur by chance inside compressed data. If the scan resumed
  // from just after a start rather than after the whole image, it would report
  // a fragment beginning mid-picture.
  //
  // ⚠ NO DECOY *END* MARKER HERE, AND THAT IS THE SPEC, NOT AN OMISSION: JPEG
  // byte-stuffs every 0xFF in entropy-coded data as FF 00, so a bare FF D9
  // cannot legitimately appear inside an image. Taking the first FF D9 as the
  // end is therefore correct. An earlier draft of this test asserted otherwise
  // and was wrong about the format.
  const inner = jpeg(200_000);
  inner[5_000] = 0xFF; inner[5_001] = 0xD8; inner[5_002] = 0xFF;   // decoy start

  const found = findLargestJpeg(concat(noise(32), inner));

  assert.equal(found.start, 32, 'the outer image is the answer');
  assert.equal(found.size, 200_000, 'not a fragment beginning at the decoy');
});

test('a stray end marker in the data BETWEEN images cannot swallow the real one', () => {
  // Between embedded images a raw file holds metadata and sensor data, which is
  // not byte-stuffed and can contain anything. A false FF D9 out there must not
  // become the boundary of the picture we want.
  const found = findLargestJpeg(concat(
    new Uint8Array([0xFF, 0xD9]),        // orphan end, before anything starts
    noise(64),
    jpeg(300_000),
  ));

  assert.ok(found, 'the real image must still be found');
  assert.equal(found.size, 300_000);
});

test('a file with no embedded jpeg returns null — TIFFs land here', () => {
  assert.equal(findLargestJpeg(noise(80_000)), null);
});

test('an unterminated jpeg is not returned', () => {
  const truncated = concat(noise(20), new Uint8Array([0xFF, 0xD8, 0xFF]), noise(60_000));
  assert.equal(findLargestJpeg(truncated), null, 'no FF D9 means no complete image');
});

test('empty input is handled rather than thrown on', () => {
  assert.equal(findLargestJpeg(new Uint8Array(0)), null);
});
