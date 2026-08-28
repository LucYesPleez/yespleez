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
 * ⛔⛔ AND IT VERIFIES THE PARITY, BECAUSE NOT DOING SO SHIPPED A BROKEN
 * ENCODER TO PRODUCTION.
 *
 * This file used to say: "Reed-Solomon parity is computed but not VERIFIED
 * here: these matrices have no errors in them, so there is nothing for it to
 * correct." That reasoning is wrong, and it cost a real event. A scanner does
 * not skip the parity when a symbol is clean — it computes the syndromes and
 * REJECTS the symbol when they do not vanish. So an encoder with correct data
 * and broken parity produces codes that look perfect, round-trip through a
 * decoder like this one, and cannot be read by any phone on earth. The camera
 * does not even draw its detection box.
 *
 * The bug was in `addEccAndInterleave`: a skip meant for short blocks fired
 * whenever the block count divided the codeword count evenly, dropping the
 * first parity byte of every block. This decoder agreed with it because it, too,
 * only read the data codewords.
 *
 * ⭐ `syndromes()` below is the check that closes it, and it is written to share
 * as little as possible with the encoder — its own field multiply, by a
 * different algorithm.
 */

/* ── the parity check ────────────────────────────────────────────────────── */

/**
 * GF(256) multiply, deliberately written a different way from the encoder's.
 *
 * ⭐ The encoder walks the bits of `y` from the top down; this is peasant
 * multiplication from the bottom up. Same field, same polynomial (0x11D),
 * independent arithmetic — so a bug in one does not hide in the other.
 */
function gfMul(a, b) {
  let r = 0;
  while (b > 0) {
    if (b & 1) r ^= a;
    a = ((a << 1) ^ ((a & 0x80) ? 0x11d : 0)) & 0xff;
    b >>= 1;
  }
  return r;
}

/**
 * The syndromes of one block's codewords: the codeword polynomial evaluated at
 * the generator's roots. **Every one must be zero** for a decoder to accept the
 * block.
 *
 * ⛔ This is the property nothing was checking. It is what a scanner computes
 * before it will look at a single byte of payload.
 *
 * ⚠ THE ROOTS START AT α⁰, NOT α¹ — QR's generator is built as
 * (x−α⁰)(x−α¹)…(x−α^(n−1)), which is the convention `rsGenerator` follows.
 * Written the other way this check reports every syndrome zero except the last,
 * which reads exactly like a real parity fault and is not one.
 */
function syndromes(codewords, eccLen) {
  const out = [];
  let x = 1;                                          // α⁰
  for (let i = 0; i < eccLen; i++) {
    let s = 0;
    for (const c of codewords) s = gfMul(s, x) ^ c;   // Horner
    out.push(s);
    x = gfMul(x, 2);                                  // α^(i+1)
  }
  return out;
}

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

  /**
   * De-interleave, in the two passes the spec describes: all data, then all
   * parity. ⛔⛔ THE OLD VERSION OF THIS READ ONLY THE DATA and stopped, which
   * is precisely why it agreed with an encoder that was dropping the first
   * parity byte of every block. A decoder that shares the encoder's mistake
   * proves only that the mistake is consistent.
   */
  const numBlocks = TABLES.ECC_BLOCKS[ecl][ver];
  const eccLen = TABLES.ECC_CODEWORDS[ecl][ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);

  const dataLens = [];
  for (let j = 0; j < numBlocks; j++) dataLens.push(shortLen - eccLen + (j < numShort ? 0 : 1));
  const maxData = Math.max(...dataLens);

  const dataBlocks = Array.from({ length: numBlocks }, () => []);
  const eccBlocks = Array.from({ length: numBlocks }, () => []);
  let idx = 0;
  for (let i = 0; i < maxData; i++) {
    for (let j = 0; j < numBlocks; j++) if (i < dataLens[j]) dataBlocks[j].push(cw[idx++]);
  }
  for (let i = 0; i < eccLen; i++) {
    for (let j = 0; j < numBlocks; j++) eccBlocks[j].push(cw[idx++]);
  }
  const data = [].concat(...dataBlocks);
  const blocks = dataBlocks.map((d, j) => [...d, ...eccBlocks[j]]);

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
  return { text: new TextDecoder().decode(Uint8Array.from(bytes)), ecl, mask, version: ver, blocks };
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

/**
 * ⛔⛔ THE ONE THAT WOULD HAVE CAUGHT IT.
 *
 * Correct data with broken parity gives a symbol that looks perfect, passes the
 * round trip above, and is unreadable by every scanner in existence. Measured
 * against a reference encoder when it happened: data codewords byte-identical,
 * parity shifted left by one with a 00 pushed in at the end.
 *
 * ⚠ THE COUNT MATTERS AS MUCH AS THE VALUES. The old interleaver emitted 25
 * codewords where v1-M wants 26, so assert the block is the full length before
 * trusting a syndrome computed over it.
 */
test('⛔⛔ every block\'s Reed-Solomon parity is valid, at every version', () => {
  let blocksChecked = 0;
  for (const payload of PAYLOADS) {
    for (const ecl of ['L', 'M', 'Q', 'H']) {
      let sym;
      try { sym = encodeQR(payload, ecl); } catch { continue; }

      const eccLen = TABLES.ECC_CODEWORDS[ecl][sym.version];
      const numBlocks = TABLES.ECC_BLOCKS[ecl][sym.version];
      const raw = Math.floor(rawDataModules(sym.version) / 8);
      const { blocks } = decode(sym);

      assert.equal(blocks.length, numBlocks, `v${sym.version}-${ecl}: wrong block count`);
      assert.equal(
        blocks.reduce((n, b) => n + b.length, 0), raw,
        `v${sym.version}-${ecl}: ${blocks.reduce((n, b) => n + b.length, 0)} codewords, spec wants ${raw}`,
      );

      blocks.forEach((block, j) => {
        const s = syndromes(block, eccLen);
        assert.ok(s.every(v => v === 0),
          `v${sym.version}-${ecl} block ${j}: syndromes ${s.join(',')} — a scanner would reject this`);
        blocksChecked++;
      });
    }
  }
  assert.ok(blocksChecked > 100, `expected many blocks, checked ${blocksChecked}`);
});

/** The parity check must be capable of failing, or it is decoration. */
test('⚠ the syndrome check actually detects corrupt parity', () => {
  const sym = encodeQR('hello world', 'M');
  const { blocks } = decode(sym);
  const eccLen = TABLES.ECC_CODEWORDS.M[sym.version];
  assert.ok(syndromes(blocks[0], eccLen).every(v => v === 0), 'the clean block should pass');

  const corrupted = [...blocks[0]];
  corrupted[corrupted.length - 1] ^= 0x01;          // flip one bit of parity
  assert.ok(!syndromes(corrupted, eccLen).every(v => v === 0),
    'a flipped parity bit went undetected — the check proves nothing');
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
