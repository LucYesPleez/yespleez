import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeQR, dataCapacityBytes, rawDataModules, alignmentPositions, MASKS, TABLES,
} from './qrEncode.js';

/**
 * ⭐⭐ THIS FILE IS A DECODER, NOT A LIST OF EXPECTATIONS.
 *
 * `ShareSheet.jsx` deferred QR for one stated reason: a hand-rolled encoder is
 * "subtly wrong in ways that are hard to see". Assertions written against the
 * encoder's own output cannot answer that — they agree with whatever it does.
 *
 * So the test reads the symbol back the way a scanner does, and shares as
 * little as possible with the writer:
 *
 *   · the function-module map is rebuilt FROM GEOMETRY, not from the encoder's
 *     `isFn` array (which is not exported for exactly this reason)
 *   · the mask is taken from the FORMAT BITS ON THE SYMBOL, not from the
 *     returned `mask` field — so a symbol that advertises the wrong mask fails
 *   · the EC level likewise comes off the symbol
 *   · blocks are de-interleaved and the byte segment parsed back to a string
 *
 * A symbol passes only when a reader that was told nothing gets the original
 * string back. ⛔ If this file is ever "simplified" into golden-matrix
 * assertions, the encoder loses the only check that means anything.
 *
 * ⚠ Reed-Solomon parity is computed but not VERIFIED here: these matrices have
 * no errors in them, so there is nothing for it to correct. Parity being wrong
 * would not fail this test, it would fail on a scuffed poster. That is the one
 * gap, and it is why the acceptance step is still "scan a printed one".
 */

/* ── the decoder ─────────────────────────────────────────────────────────── */

function decode(sym) {
  const { size, version: ver } = sym;

  // Function modules, derived from the spec's geometry alone.
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const box = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < size && y < size) fn[y][x] = true;
    }
  };
  box(0, 0, 9, 9);                 // finder + separator + format, top left
  box(size - 8, 0, 8, 9);          // top right
  box(0, size - 8, 9, 8);          // bottom left
  for (let i = 0; i < size; i++) { fn[6][i] = true; fn[i][6] = true; }
  const pos = alignmentPositions(ver);
  for (const a of pos) {
    for (const b of pos) {
      const corner = (a === 6 && b === 6) || (a === 6 && b === size - 7) || (a === size - 7 && b === 6);
      if (!corner) box(a - 2, b - 2, 5, 5);
    }
  }
  if (ver >= 7) { box(size - 11, 0, 3, 6); box(0, size - 11, 6, 3); }

  // Format information, read off the symbol and unmasked.
  let bits = 0;
  for (let i = 0; i <= 5; i++) bits |= (sym.modules[i][8] ? 1 : 0) << i;
  bits |= (sym.modules[7][8] ? 1 : 0) << 6;
  bits |= (sym.modules[8][8] ? 1 : 0) << 7;
  bits |= (sym.modules[8][7] ? 1 : 0) << 8;
  for (let i = 9; i < 15; i++) bits |= (sym.modules[8][14 - i] ? 1 : 0) << i;
  const fdata = (bits ^ 0x5412) >>> 10;
  const mask = fdata & 7;
  const ecl = Object.keys(TABLES.FORMAT_BITS).find(k => TABLES.FORMAT_BITS[k] === (fdata >> 3));
  const unmask = MASKS[mask];

  // Zig-zag read, unmasking as we go.
  const bo = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fn[y][x]) continue;
        bo.push((unmask(x, y) ? !sym.modules[y][x] : sym.modules[y][x]) ? 1 : 0);
      }
    }
  }
  const cw = [];
  for (let i = 0; i + 8 <= bo.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bo[i + k];
    cw.push(b);
  }

  // De-interleave. Data codewords only; parity is not needed for a clean read.
  const numBlocks = TABLES.ECC_BLOCKS[ecl][ver];
  const eccLen = TABLES.ECC_CODEWORDS[ecl][ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const blocks = Array.from({ length: numBlocks }, () => []);
  let idx = 0;
  for (let i = 0; i < shortLen + 1; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i < shortLen - eccLen + (j < numShort ? 0 : 1)) blocks[j].push(cw[idx++]);
    }
  }
  const data = [].concat(...blocks);

  let p = 0;
  const rd = (n) => {
    let v = 0;
    for (let k = 0; k < n; k++) { v = (v << 1) | ((data[p >>> 3] >>> (7 - (p & 7))) & 1); p++; }
    return v;
  };
  const mode = rd(4);
  if (mode !== 4) return { error: `mode ${mode}, expected byte mode` };
  const len = rd(ver <= 9 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < len; i++) bytes.push(rd(8));
  return { text: new TextDecoder().decode(Uint8Array.from(bytes)), ecl, mask, version: ver };
}

/* ── the round trip ──────────────────────────────────────────────────────── */

/** Real destinations, plus the sizes that reach every block-splitting shape. */
const PAYLOADS = [
  'https://yespleez.com/#/q/event/55512cb8-72e8-446c-9fff-f195d7e002c3',
  'https://yespleez.com/#/q/set-times/55512cb8-72e8-446c-9fff-f195d7e002c3',
  'https://yespleez.com/#/q/whats-on/94a88288-43aa-445b-abb8-7dc895804b51',
  'A',
  'The Federal Hotel',
  "Bellingen Brewery — what's on",   // non-ASCII, so a byte is not a character
  'z'.repeat(120),                    // versions in the middle of the range
  'q'.repeat(900),
  'm'.repeat(2000),                   // multi-block, both block lengths in play
];

test('⭐⭐ every symbol decodes back to what went in, at every EC level', () => {
  let checked = 0;
  for (const payload of PAYLOADS) {
    for (const ecl of ['L', 'M', 'Q', 'H']) {
      let sym;
      try {
        sym = encodeQR(payload, ecl);
      } catch {
        continue;                     // too long at this level — a real answer
      }
      const got = decode(sym);
      assert.equal(got.text, payload,
        `v${sym.version}-${ecl} did not round trip (mask ${sym.mask})`);
      assert.equal(got.ecl, ecl, 'the symbol advertises a different EC level than it was built at');
      assert.equal(got.mask, sym.mask, 'the format bits name a different mask than the one applied');
      checked++;
    }
  }
  assert.ok(checked >= 30, `expected the full matrix of payloads x levels, ran ${checked}`);
});

test('the symbol is the size its version claims, and the finders are where they must be', () => {
  for (const ecl of ['L', 'H']) {
    for (const payload of PAYLOADS) {
      let sym;
      try { sym = encodeQR(payload, ecl); } catch { continue; }
      assert.equal(sym.size, sym.version * 4 + 17);
      assert.ok(sym.modules[0][0] && sym.modules[0][sym.size - 1] && sym.modules[sym.size - 1][0],
        'a finder corner is light');
      for (let i = 8; i < sym.size - 8; i++) {
        assert.equal(sym.modules[6][i], i % 2 === 0, 'the horizontal timing pattern is broken');
        assert.equal(sym.modules[i][6], i % 2 === 0, 'the vertical timing pattern is broken');
      }
    }
  }
});

test('version information decodes back, from version 7 up', () => {
  const sym = encodeQR('q'.repeat(900), 'M');
  assert.ok(sym.version >= 7, 'fixture no longer reaches the version-info range');
  let vb = 0;
  for (let i = 0; i < 18; i++) {
    vb |= (sym.modules[Math.floor(i / 3)][sym.size - 11 + (i % 3)] ? 1 : 0) << i;
  }
  assert.equal(vb >>> 12, sym.version);
});

/**
 * ⚠ THE CAPACITY TABLE IS THE ONE THING THE ROUND TRIP CANNOT CHECK — a
 * consistently wrong table produces symbols that encode and decode perfectly
 * and are simply the wrong version. These are the published byte-mode figures.
 */
test('capacity matches the published byte-mode table', () => {
  const published = [
    [1, 'L', 17], [1, 'M', 14], [1, 'Q', 11], [1, 'H', 7],
    [2, 'M', 26], [10, 'M', 213],
    [40, 'L', 2953], [40, 'M', 2331], [40, 'Q', 1663], [40, 'H', 1273],
  ];
  for (const [ver, ecl, expected] of published) {
    assert.equal(dataCapacityBytes(ver, ecl), expected, `v${ver}-${ecl}`);
  }
});

test('a payload past version 40 is refused, not silently truncated', () => {
  assert.throws(() => encodeQR('x'.repeat(3000), 'H'), /too long/i);
  // ⛔ The failure that would matter: encoding SOMETHING instead of throwing.
  assert.doesNotThrow(() => encodeQR('x'.repeat(2900), 'L'));
});

test('UTF-8 is measured in bytes, not characters', () => {
  const emoji = '🎉🎉🎉';                       // 12 bytes, 3 characters
  const sym = encodeQR(emoji, 'M');
  assert.equal(decode(sym).text, emoji);
});
