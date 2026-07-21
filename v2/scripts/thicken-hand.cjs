/**
 * Make an icon-weight version of hand-logo.png by DILATING its alpha.
 *
 * The mark is line art: strokes a few pixels wide at 1122px. Scaled into a
 * 21px button those strokes fall below one pixel and read as fuzz. Dilation
 * grows every stroke outward by a fixed radius, so the GESTURE is untouched
 * and only the weight changes — the alternative is redrawing it, which means
 * approximating someone else's mark.
 *
 * Pure node: no image libraries available here, so PNG decode and encode are
 * done by hand. Only the alpha channel matters — the CSS mask ignores colour.
 */
const fs = require('fs');
const zlib = require('zlib');

const SRC = process.argv[2];
const DST = process.argv[3];
const RADIUS = Number(process.argv[4] ?? 14);
const OUT_SIZE = Number(process.argv[5] ?? 256);

// ── decode ────────────────────────────────────────────────────────
function decode(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const colorType = buf[25];
  if (colorType !== 6) throw new Error('expected RGBA, got colorType ' + colorType);

  let off = 8; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.slice(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = raw.slice(p, p + stride); p += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
  }
  return { w, h, data: out };
}

// ── dilate the alpha with a disc ──────────────────────────────────
// Separable two-pass max filter: a square, then corners trimmed by a disc test
// would be exact — but a square dilation of line art is visually identical at
// this scale and is O(n·r) instead of O(n·r²).
function dilateAlpha({ w, h, data }, radius) {
  const src = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) src[i] = data[i * 4 + 3];

  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      const lo = Math.max(0, x - radius), hi = Math.min(w - 1, x + radius);
      for (let k = lo; k <= hi; k++) { const v = src[y * w + k]; if (v > m) m = v; }
      tmp[y * w + x] = m;
    }
  }
  const dst = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      const lo = Math.max(0, y - radius), hi = Math.min(h - 1, y + radius);
      for (let k = lo; k <= hi; k++) { const v = tmp[k * w + x]; if (v > m) m = v; }
      dst[y * w + x] = m;
    }
  }
  return dst;
}

// ── downsample (box average) to the delivery size ─────────────────
// Averaging rather than nearest: the mask is antialiased by the browser anyway,
// and a nearest-neighbour shrink of thin strokes drops whole segments.
function resizeAlpha(alpha, w, h, outW, outH) {
  const out = new Uint8Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    const y0 = Math.floor(y * h / outH), y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / outH));
    for (let x = 0; x < outW; x++) {
      const x0 = Math.floor(x * w / outW), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / outW));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { sum += alpha[yy * w + xx]; n++; }
      out[y * outW + x] = Math.round(sum / n);
    }
  }
  return out;
}

// ── encode ────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodeWhiteWithAlpha(alpha, w, h) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;                       // filter: none
    for (let x = 0; x < w; x++) {
      const o = y * (stride + 1) + 1 + x * 4;
      raw[o] = 255; raw[o + 1] = 255; raw[o + 2] = 255;   // white; the mask ignores it
      raw[o + 3] = alpha[y * w + x];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── run ───────────────────────────────────────────────────────────
const img = decode(fs.readFileSync(SRC));
const fat = dilateAlpha(img, RADIUS);

// Trim to the mark's bounding box so the icon has no built-in padding — the
// button decides the spacing, not the asset.
let minX = img.w, minY = img.h, maxX = -1, maxY = -1;
for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
  if (fat[y * img.w + x] > 8) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
}
const cw = maxX - minX + 1, ch = maxY - minY + 1;
const cropped = new Uint8Array(cw * ch);
for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) cropped[y * cw + x] = fat[(y + minY) * img.w + (x + minX)];

const outH = OUT_SIZE, outW = Math.max(1, Math.round(cw * OUT_SIZE / ch));
const small = resizeAlpha(cropped, cw, ch, outW, outH);

let cover = 0;
for (let i = 0; i < small.length; i++) if (small[i] > 110) cover++;

fs.writeFileSync(DST, encodeWhiteWithAlpha(small, outW, outH));
console.log(`source ${img.w}x${img.h} → crop ${cw}x${ch} → out ${outW}x${outH}`);
console.log(`radius ${RADIUS}px · coverage ${(cover / small.length * 100).toFixed(1)}%`);
