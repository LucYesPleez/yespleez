/**
 * SAVING A STICKER — the filename, which is the only pure part.
 * The download itself is browser plumbing (blob URLs, anchor clicks) and is
 * verified in the browser, not stubbed here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { stickerFilename } from './saveSticker.js';

test('the saved file is named after the artwork, not the storage path', () => {
  assert.equal(stickerFilename('elbows-rest-logo.png', 'NONE'), 'elbows-rest-logo.png');
});

test('the effect is named in the file, so two saves do not collide', () => {
  assert.equal(stickerFilename('logo.png', 'PUFFY'), 'logo puffy.png');
  assert.equal(stickerFilename('logo.png', 'OUTLINE'), 'logo outline.png');
});

test('⛔ ALWAYS .png — a sticker is transparent and JPEG has no alpha', () => {
  for (const key of ['NONE', 'OUTLINE', 'PUFFY', 'METALLIC']) {
    assert.match(stickerFilename('mark.webp', key), /\.png$/);
  }
});

test('an existing extension is replaced, never stacked', () => {
  assert.equal(stickerFilename('mark.webp', 'NONE'), 'mark.png');
  assert.doesNotMatch(stickerFilename('mark.jpeg', 'NONE'), /jpeg/);
});

test('characters a filesystem would reject are dropped', () => {
  assert.equal(stickerFilename('AC/DC: live<>?.png', 'NONE'), 'ACDC live.png');
});

test('a name that is nothing but junk still produces a usable file', () => {
  assert.equal(stickerFilename('///', 'NONE'), 'sticker.png');
  assert.equal(stickerFilename('', 'NONE'), 'sticker.png');
  assert.equal(stickerFilename(null, 'NONE'), 'sticker.png');
});

test('a very long name is trimmed rather than rejected', () => {
  const out = stickerFilename('x'.repeat(300), 'METALLIC');
  assert.ok(out.length < 90, `${out.length} characters is not trimmed`);
  assert.match(out, /\.png$/);
});
