/**
 * SAVING A STICKER — the filename and the two capability questions, which are
 * the pure parts. Compositing and the sheet itself are browser plumbing
 * (canvases, blob URLs, navigator.share) and are verified in the browser.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { stickerFilename, canShareStickerFile, isAppleTouchDevice } from './saveSticker.js';

/** Swap `navigator` for the length of one assertion, then put it back. */
function withNavigator(stub, body) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: stub, configurable: true, writable: true });
  try { return body(); } finally { Object.defineProperty(globalThis, 'navigator', original); }
}

const PNG = () => new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' });

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

/* ── The share sheet, which is the only route to a Messages sticker ──────── */

test('the sheet is offered when the browser accepts files', () => {
  assert.equal(withNavigator(
    { share: () => {}, canShare: () => true },
    () => canShareStickerFile(PNG()),
  ), true);
});

test('⛔ share WITHOUT file support is not the share path', () => {
  // Every mobile browser has navigator.share; only some take files. Calling
  // share() here would reject mid-gesture with the activation already spent.
  assert.equal(withNavigator(
    { share: () => {} },
    () => canShareStickerFile(PNG()),
  ), false);
  assert.equal(withNavigator(
    { share: () => {}, canShare: () => false },
    () => canShareStickerFile(PNG()),
  ), false);
});

test('a browser with no share at all takes the download path', () => {
  assert.equal(withNavigator({}, () => canShareStickerFile(PNG())), false);
});

test('canShare throwing is a no, never an exception at the tap', () => {
  assert.equal(withNavigator(
    { share: () => {}, canShare: () => { throw new TypeError('nope'); } },
    () => canShareStickerFile(PNG()),
  ), false);
});

test('no file means nothing to share, whatever the browser claims', () => {
  assert.equal(withNavigator(
    { share: () => {}, canShare: () => true },
    () => canShareStickerFile(null),
  ), false);
});

/* ── The Photos copy, which is iOS-specific by name ──────────────────────── */

test('the Add Sticker instructions are offered on iPhone and iPad', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15';
  assert.equal(withNavigator({ userAgent: iphone }, isAppleTouchDevice), true);
  // ⚠ iPadOS reports itself as a Mac; touch points are what separate them.
  const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
  assert.equal(withNavigator({ userAgent: ipad, maxTouchPoints: 5 }, isAppleTouchDevice), true);
});

test('⛔ a desktop Mac is never told to touch and hold anything', () => {
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
  assert.equal(withNavigator({ userAgent: mac, maxTouchPoints: 0 }, isAppleTouchDevice), false);
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36';
  assert.equal(withNavigator({ userAgent: android, maxTouchPoints: 5 }, isAppleTouchDevice), false);
});
