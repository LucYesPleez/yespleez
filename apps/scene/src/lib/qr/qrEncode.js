/**
 * QR ENCODER — ISO/IEC 18004, byte mode, versions 1 to 40, all four EC levels.
 *
 * ── ⭐⭐ WHY THIS IS HAND-ROLLED, AND WHY THAT IS SAFE HERE ────────────────
 *
 * `components/ShareSheet.jsx` reserved the QR slot rather than building it, and
 * said exactly why:
 *
 *   "a hand-rolled QR encoder is exactly the kind of code that is subtly wrong
 *    in ways that are hard to see"
 *
 * That objection is correct, and it is the reason `qrEncode.test.js` exists in
 * the form it does. The test is ⛔ NOT a set of assertions about what this file
 * outputs — it is an INDEPENDENT DECODER that rebuilds the function-module map
 * from geometry, reads the format bits back off the symbol, unmasks with
 * whatever mask those bits name, de-interleaves the blocks, and parses the byte
 * segment. A symbol only passes if a reader that shares no code path with the
 * writer gets the original string back.
 *
 * ⭐ That is the standing rule for this file: any change here must keep the
 * round trip green across the full version range. A test that asserted "module
 * (7,3) is dark" would tell you nothing about whether a phone can read it.
 *
 * The alternative was a dependency. This app has eight, and a zero-dependency
 * test suite; the encoder is ~250 lines and the decoder that proves it is ~60.
 *
 * ── ⛔ WHAT THIS MODULE DOES NOT DO ───────────────────────────────────────
 *
 * It does not draw, colour, size, or lay anything out, and it does not know
 * what a YesPleez destination is. It turns a string into a boolean matrix.
 * Drawing lives in `qrRender.js`, print in `qrPdf.js`, and the destination
 * model in `lib/qrDestinations.js` — the presentation/destination separation
 * the QR brief asks for starts here, by this file knowing neither.
 *
 * ⚠ BYTE MODE ONLY, DELIBERATELY. Alphanumeric mode is denser but excludes
 * lowercase, and every YesPleez destination is a URL with a lowercase host and
 * a UUID, so alphanumeric would never be selected. Numeric mode is irrelevant.
 * Supporting modes that can never fire would be untested code in the one file
 * that must not have any.
 */

/** EC codewords per block, indexed [level][version]. Index 0 is unused. */
const ECC_CODEWORDS = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

/** EC blocks per symbol, indexed [level][version]. */
const ECC_BLOCKS = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/** The two-bit level code the format information carries. ⛔ Not 0..3 in order. */
const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

export const EC_LEVELS = ['L', 'M', 'Q', 'H'];

/**
 * Total data + EC modules available in a version, before any of it is spent.
 * The subtractions are the alignment patterns (which overlap the timing rows,
 * hence the correction term) and, from version 7, the two version blocks.
 */
export function rawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

/**
 * How many bytes of payload a version holds at a level, byte mode.
 *
 * ⚠ The `4` is the mode indicator and the 8/16 is the character count field —
 * both come out of the payload budget, which is why this is not simply
 * "data codewords".
 */
export function dataCapacityBytes(ver, ecl) {
  const raw = Math.floor(rawDataModules(ver) / 8);
  const dataCw = raw - ECC_CODEWORDS[ecl][ver] * ECC_BLOCKS[ecl][ver];
  return Math.floor((dataCw * 8 - 4 - (ver <= 9 ? 8 : 16)) / 8);
}

/* ── GF(256) arithmetic, generator polynomial x^8 + x^4 + x^3 + x^2 + 1 ──── */

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsGenerator(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, generator) {
  const result = new Uint8Array(generator.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < result.length; i++) result[i] ^= gfMul(generator[i], factor);
  }
  return result;
}

/* ── payload → codewords ─────────────────────────────────────────────────── */

function makeDataCodewords(bytes, ver, ecl) {
  const raw = Math.floor(rawDataModules(ver) / 8);
  const capacityBits = (raw - ECC_CODEWORDS[ecl][ver] * ECC_BLOCKS[ecl][ver]) * 8;

  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };

  push(4, 4);                                 // byte mode indicator
  push(bytes.length, ver <= 9 ? 8 : 16);      // character count
  for (const b of bytes) push(b, 8);

  push(0, Math.min(4, capacityBits - bits.length));   // terminator, truncated if tight
  push(0, (8 - (bits.length % 8)) % 8);               // pad to a byte boundary
  // The spec's alternating pad bytes, 11101100 / 00010001.
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);

  const cw = new Uint8Array(bits.length / 8);
  bits.forEach((bit, i) => { cw[i >>> 3] |= bit << (7 - (i & 7)); });
  return cw;
}

/**
 * Split into blocks, compute Reed-Solomon parity, interleave.
 *
 * ⛔⛔ THIS SHIPPED BROKEN, AND IT IS THE WORST KIND OF BROKEN: every symbol it
 * produced looked like a perfect QR code and NO scanner could read one. A phone
 * camera would not even draw its detection box. It was live in production and
 * cost the owner a real event.
 *
 * The old version concatenated each block's data and parity into one array and
 * walked that with a skip rule meant for short blocks:
 *
 *     if (i === shortLen - eccLen && j < numShort) skip
 *
 * ⚠⚠ `numShort` is `numBlocks - raw % numBlocks`, so when the block count
 * DIVIDES the codeword count evenly — every version with one block, and many
 * others — `numShort === numBlocks` and that condition is true for every block.
 * The skip fired where nothing needed skipping and dropped one byte per block:
 * the FIRST PARITY BYTE. v1-M emitted 25 codewords where the spec wants 26, and
 * the parity a decoder checks was nonsense. Measured against a reference
 * encoder: data codewords identical, parity shifted left by one with a 00
 * pushed in at the end.
 *
 * ⛔ AND THE TEST AGREED WITH IT, because the round-trip decoder de-interleaved
 * with the same wrong rule and never verified parity — a decoder that shares the
 * encoder's mistake proves only that the mistake is consistent. See the syndrome
 * check in qrEncode.test.js, which is the thing that would have caught this.
 *
 * ── ⭐ THE RULE, STATED SO IT CANNOT BE GOT WRONG AGAIN ──────────────────
 *
 * Data and parity are interleaved as TWO SEPARATE PASSES, and they are never
 * concatenated per block:
 *
 *   1. every block's data codeword 0, then every block's 1, ... A short block
 *      simply has no codeword at the last data index, so it contributes nothing
 *      there. That is the only skip, and it falls out of `i < block.length`.
 *   2. then every block's parity codeword 0, then 1, ... Parity blocks are ALL
 *      the same length, so ⛔ there is never a skip in this pass.
 */
function addEccAndInterleave(data, ver, ecl) {
  const numBlocks = ECC_BLOCKS[ecl][ver];
  const eccLen = ECC_CODEWORDS[ecl][ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);

  const generator = rsGenerator(eccLen);
  const dataBlocks = [];
  const eccBlocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortLen - eccLen + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    dataBlocks.push(dat);
    eccBlocks.push(rsRemainder(dat, generator));
  }

  const result = [];
  const maxData = Math.max(...dataBlocks.map(b => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < eccLen; i++) {
    for (const block of eccBlocks) result.push(block[i]);
  }
  return result;
}

/* ── symbol construction ─────────────────────────────────────────────────── */

/** Centre coordinates of the alignment patterns for a version. */
export function alignmentPositions(ver) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  // ⚠ Version 32 is the one exception the spec carves out by hand.
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const size = ver * 4 + 17;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function buildSymbol(bytes, ecl, ver) {
  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, dark) => { modules[y][x] = dark; isFn[y][x] = true; };

  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  // Finder patterns, plus the separator ring around each (distance 4 is light).
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

  const pos = alignmentPositions(ver);
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      const overlapsFinder = (i === 0 && j === 0)
        || (i === 0 && j === pos.length - 1)
        || (i === pos.length - 1 && j === 0);
      if (overlapsFinder) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  /** Both copies of the 15-bit format information, BCH(15,5) + the 0x5412 mask. */
  const drawFormat = (mask) => {
    const data = (FORMAT_BITS[ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) !== 0;

    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
    setFn(8, 7, bit(6));
    setFn(8, 8, bit(7));
    setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));

    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
    setFn(8, size - 8, true);   // the always-dark module
  };
  drawFormat(0);

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const b = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const c = Math.floor(i / 3);
      setFn(a, c, b);
      setFn(c, a, b);
    }
  }

  // Zig-zag placement, two columns at a time, from the bottom right.
  const codewords = addEccAndInterleave(makeDataCodewords(bytes, ver, ecl), ver, ecl);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;              // the vertical timing column is skipped
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && i < codewords.length * 8) {
          modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }

  const applyMask = (mask) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isFn[y][x]) continue;
        if (MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
      }
    }
  };

  /* The four penalty rules. Their job is only to RANK the eight masks, so the
     absolute numbers never matter — but the ranking does: a badly masked symbol
     reads slowly or not at all under a camera. */
  const penalty = () => {
    let score = 0;
    const N1 = 3, N2 = 3, N3 = 40, N4 = 10;

    const runScore = (line) => {
      let s = 0, run = 1;
      for (let k = 1; k <= line.length; k++) {
        if (k < line.length && line[k] === line[k - 1]) { run++; continue; }
        if (run >= 5) s += N1 + (run - 5);
        run = 1;
      }
      return s;
    };

    // 1:1:3:1:1 with four light modules on one side — a false finder.
    const finderish = (line) => {
      const pat = [1, 0, 1, 1, 1, 0, 1];
      let s = 0;
      for (let k = 0; k + 7 <= line.length; k++) {
        let hit = true;
        for (let m = 0; m < 7; m++) if ((line[k + m] ? 1 : 0) !== pat[m]) { hit = false; break; }
        if (!hit) continue;
        const before = line.slice(Math.max(0, k - 4), k);
        const after = line.slice(k + 7, k + 11);
        if ((before.length === 4 && before.every(v => !v)) || (after.length === 4 && after.every(v => !v))) s += N3;
      }
      return s;
    };

    for (let y = 0; y < size; y++) {
      const row = modules[y];
      const col = modules.map(r => r[y]);
      score += runScore(row) + runScore(col) + finderish(row) + finderish(col);
    }

    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const v = modules[y][x];
        if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) score += N2;
      }
    }

    let dark = 0;
    for (const row of modules) for (const v of row) if (v) dark++;
    const total = size * size;
    score += Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * N4;
    return score;
  };

  let bestMask = 0, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const s = penalty();
    if (s < bestScore) { bestScore = s; bestMask = mask; }
    applyMask(mask);                 // XOR is its own inverse — this undoes it
  }
  applyMask(bestMask);
  drawFormat(bestMask);

  return { modules, size, version: ver, mask: bestMask, ecl };
}

/** The eight mask predicates. Exported so the test can unmask independently. */
export const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, _y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/**
 * Encode a string as the smallest symbol that will hold it.
 *
 * @param {string} text  UTF-8 is encoded as bytes, so accents and emoji are fine
 * @param {'L'|'M'|'Q'|'H'} ecl
 * @returns {{modules: boolean[][], size: number, version: number, mask: number, ecl: string}}
 * @throws if the string exceeds version 40 at that level
 */
export function encodeQR(text, ecl = 'M') {
  if (!EC_LEVELS.includes(ecl)) throw new Error(`unknown EC level ${ecl}`);
  const bytes = new TextEncoder().encode(String(text ?? ''));
  for (let ver = 1; ver <= 40; ver++) {
    if (bytes.length <= dataCapacityBytes(ver, ecl)) return buildSymbol(bytes, ecl, ver);
  }
  throw new Error('This is too long to fit in a QR code.');
}

/** Exported for the round-trip decoder only. ⛔ Not part of the drawing API. */
export const TABLES = { ECC_CODEWORDS, ECC_BLOCKS, FORMAT_BITS };
