/**
 * QR PDF — the poster, for print.
 *
 * ⛔ THIS FILE DOES NOT DESIGN ANYTHING. `qrPosterLayout.js` decides where every
 * shape goes; this turns that list into PDF operators and assembles the file.
 * The same list is drawn to a canvas by `qrPosterCanvas.js` for the PNG and the
 * on-screen proof, which is what stops the print and the preview drifting apart.
 *
 * ── ⭐⭐ THE CODE IS VECTOR, NOT A PICTURE OF A CODE ──────────────────────
 *
 * Every dark module is a filled RECTANGLE in PDF user space, so the symbol is
 * resolution-independent: the same file prints correctly on an A5 flyer and on
 * an A3 poster, and a printer's RIP renders crisp edges instead of resampling
 * somebody's PNG. A rasterised QR blown up for signage is exactly how a code
 * that scanned on the designer's screen fails on the wall.
 *
 * ── ⭐⭐ AND SO IS THE GRAIN ──────────────────────────────────────────────
 *
 * The speckled letterforms are done with text rendering mode 7 — "add to the
 * clipping path" — so the glyph outlines become a clip and the flecks are
 * ordinary rectangles painted inside it. ⛔ No image, no pattern, no
 * transparency group: the most basic operators in the format, which is what a
 * file destined for an unknown print shop wants.
 *
 * ⛔ THE PLATE IS NOT DECORATION. The white area around the code is its quiet
 * zone. On a black poster it is the difference between a code that reads and
 * one that does not. ⛔ Never crop it tighter, ⛔ never tint it, and ⛔ never
 * invert the code to suit the ground: out of spec, and a good share of phone
 * cameras refuse it.
 */

import { encodeQR } from './qrEncode';
import { parseTrueType, sanitise, winAnsiByte } from './qrFont';
import { layoutPoster } from './qrPosterLayout';

/* ── page geometry, in PDF points (72 per inch) ──────────────────────────── */

export const PAGE_SIZES = Object.freeze({
  A3: { w: 841.89, h: 1190.55, label: 'A3' },
  A4: { w: 595.28, h: 841.89, label: 'A4' },
  A5: { w: 419.53, h: 595.28, label: 'A5' },
});

export const DEFAULT_PAGE = 'A3';

/* ── Helvetica metrics, for the fallback path only ───────────────────────── */

const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

/**
 * ⚠ THE FALLBACK IS DELIBERATELY NOT THE REAL THING, and that is the point. If
 * the font asset cannot be loaded a poster still comes out — Helvetica-Bold,
 * which the layout's own 73% squeeze already condenses — rather than the export
 * failing in front of somebody with a printer waiting. `usedFont` says which
 * happened, so nobody has to guess from the look of it.
 */

/* ── text encoding ───────────────────────────────────────────────────────── */

/**
 * A PDF literal string, in WinAnsi bytes.
 *
 * ⭐ Characters above U+00FF are mapped through `winAnsiByte`, so a typographic
 * apostrophe becomes byte 0x92 and is DRAWN. It used to be dropped, and the
 * headline read WHAT'S ON where the design said WHAT’S ON.
 */
function pdfString(str) {
  let out = '';
  for (const ch of sanitise(str)) {
    const byte = winAnsiByte(ch);
    if (byte === null) continue;
    const c = String.fromCharCode(byte);
    if (c === '(' || c === ')' || c === '\\') out += '\\';
    out += c;
  }
  return out;
}

/**
 * Measure a string the way it will be drawn.
 *
 * ⚠ MEASUREMENT AND DRAWING MUST SHARE A FONT AND A SQUEEZE. A centred line
 * measured in Helvetica but drawn in Bebas sits visibly off centre, and the
 * fault is invisible in a diff and obvious on paper.
 */
function measurer(font) {
  return (str, size, { tracking = 0, squeeze = 100 } = {}) => {
    const s = pdfString(str);
    let units = 0;
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      units += font ? font.widthOf(ch) : (c >= 32 && c <= 126 ? W_BOLD[c - 32] : 556);
    }
    return ((units / 1000) * size * squeeze) / 100 + tracking * Math.max(0, s.length - 1);
  };
}

/* ── primitive → operators ───────────────────────────────────────────────── */

const rgb = ([r, g, b]) => `${r} ${g} ${b} rg`;
const RGB = ([r, g, b]) => `${r} ${g} ${b} RG`;
const n = (v) => v.toFixed(3);

/** ⚠ The one place the top-left layout is flipped into PDF's bottom-left space. */
const makeFlip = (page) => (y) => page.h - y;

function textOps(runs, flip, { clipOnly = false } = {}) {
  let ops = 'BT\n';
  if (clipOnly) ops += '7 Tr\n';
  for (const run of runs) {
    const s = pdfString(run.text);
    if (!s) continue;
    ops += `/F1 ${n(run.size)} Tf\n`;
    ops += `${run.squeeze ?? 100} Tz\n`;
    ops += `${n(run.tracking || 0)} Tc\n`;
    ops += `1 0 0 1 ${n(run.x)} ${n(flip(run.baseline))} Tm\n`;
    ops += `(${s}) Tj\n`;
  }
  ops += 'ET\n';
  return ops;
}

function roundedRectPath(x, y, w, h, r, flip) {
  // Drawn in flipped space, so the "top" here is the smaller y.
  const y0 = flip(y + h);
  const k = r * 0.5523;
  return [
    `${n(x + r)} ${n(y0)} m`,
    `${n(x + w - r)} ${n(y0)} l`,
    `${n(x + w - r + k)} ${n(y0)} ${n(x + w)} ${n(y0 + r - k)} ${n(x + w)} ${n(y0 + r)} c`,
    `${n(x + w)} ${n(y0 + h - r)} l`,
    `${n(x + w)} ${n(y0 + h - r + k)} ${n(x + w - r + k)} ${n(y0 + h)} ${n(x + w - r)} ${n(y0 + h)} c`,
    `${n(x + r)} ${n(y0 + h)} l`,
    `${n(x + r - k)} ${n(y0 + h)} ${n(x)} ${n(y0 + h - r + k)} ${n(x)} ${n(y0 + h - r)} c`,
    `${n(x)} ${n(y0 + r)} l`,
    `${n(x)} ${n(y0 + r - k)} ${n(x + r - k)} ${n(y0)} ${n(x + r)} ${n(y0)} c`,
    'h',
  ].join('\n');
}

/**
 * The symbol as merged horizontal runs of modules.
 *
 * ⚠ Runs are merged so the content stream stays small: a version 6 symbol has
 * ~1,100 dark modules and roughly 300 runs.
 */
function symbolOps(op, flip) {
  const { symbol, quiet, x, y, side } = op;
  const span = symbol.size + quiet * 2;
  const m = side / span;
  let ops = `${rgb(op.fill)}\n`;
  for (let row = 0; row < symbol.size; row++) {
    let run = 0;
    for (let col = 0; col <= symbol.size; col++) {
      const dark = col < symbol.size && symbol.modules[row][col];
      if (dark) { run++; continue; }
      if (run > 0) {
        const rx = x + (col - run + quiet) * m;
        const ry = y + (row + quiet) * m;
        ops += `${n(rx)} ${n(flip(ry + m))} ${n(run * m)} ${n(m)} re f\n`;
        run = 0;
      }
    }
  }
  return ops;
}

function renderOps(ops, page) {
  const flip = makeFlip(page);
  let c = '';
  for (const op of ops) {
    switch (op.type) {
      case 'rect':
        c += `${rgb(op.fill)}\n${n(op.x)} ${n(flip(op.y + op.h))} ${n(op.w)} ${n(op.h)} re f\n`;
        break;
      case 'roundedRect':
        c += `${rgb(op.fill)}\n${roundedRectPath(op.x, op.y, op.w, op.h, op.r, flip)}\nf\n`;
        break;
      case 'line':
        c += `${RGB(op.stroke)}\n${n(op.w)} w\n`;
        c += `${n(op.x1)} ${n(flip(op.y))} m ${n(op.x2)} ${n(flip(op.y))} l S\n`;
        break;
      case 'text':
        c += `${rgb(op.fill)}\n${textOps(op.runs, flip)}`;
        break;
      case 'texturedText': {
        /**
         * ⭐⭐ PAINT THE LETTERS, THEN CLIP TO THEM AND SCATTER THE FLECKS.
         *
         * `7 Tr` adds text to the clipping path without marking the page, so
         * everything until the matching `Q` is confined to the letterforms.
         *
         * ⚠ THE ORDER IS A SAFETY PROPERTY, not a style. The letters are drawn
         * FIRST and normally, so a reader that ignores text clipping still
         * renders a correct headline with some stray flecks around it. The
         * obvious alternative — clip first, then flood the box with cream —
         * fails the other way: that reader paints a solid cream slab over the
         * top of the poster. ⛔ Do not reorder these.
         */
        c += `${rgb(op.fill)}\n${textOps(op.runs, flip)}`;
        if (op.flecks.length) {
          c += 'q\n';
          c += textOps(op.runs, flip, { clipOnly: true });
          c += `${rgb(op.fleckFill)}\n`;
          for (const f of op.flecks) {
            c += `${n(f.x)} ${n(flip(f.y + f.h))} ${n(f.w)} ${n(f.h)} re f\n`;
          }
          c += 'Q\n';
        }
        break;
      }
      case 'symbol':
        c += symbolOps(op, flip);
        break;
      default:
        break;
    }
  }
  return c;
}

/* ── the document ────────────────────────────────────────────────────────── */

function buildPdf(content, page, font) {
  const objects = [];
  const add = (body, binary) => { objects.push({ body, binary }); return objects.length; };

  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.w} ${page.h}] `
    + `/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
  );
  add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  if (font) {
    add(
      '<< /Type /Font /Subtype /TrueType /BaseFont /BebasNeue-Regular '
      + `/FirstChar ${font.firstChar} /LastChar ${font.lastChar} `
      + `/Widths [${font.widths.join(' ')}] /Encoding /WinAnsiEncoding `
      + '/FontDescriptor 6 0 R >>',
    );
    const d = font.descriptor;
    add(
      '<< /Type /FontDescriptor /FontName /BebasNeue-Regular '
      + `/Flags ${d.flags} /FontBBox [${d.bbox.join(' ')}] /ItalicAngle ${d.italicAngle} `
      + `/Ascent ${d.ascent} /Descent ${d.descent} /CapHeight ${d.capHeight} `
      + `/StemV ${d.stemV} /FontFile2 7 0 R >>`,
    );
    // ⚠ /Length1 is the UNCOMPRESSED length of the TrueType file and is
    // required for a FontFile2. Readers that validate it reject the font
    // without it and substitute a face with no warning.
    add(
      `<< /Length ${font.bytes.length} /Length1 ${font.bytes.length} >>\nstream\n`,
      font.bytes,
    );
  } else {
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  }

  /* ⚠⚠ BYTES, NOT CHARACTERS, throughout. The xref offsets are byte offsets, so
     the file is assembled one byte per character — a UTF-8 encoder would turn
     the binary header comment (and every high byte of the font) into two bytes
     and shift every offset, producing a PDF that some readers repair silently
     and others reject. */
  const chunks = [];
  let length = 0;
  const push = (s) => {
    if (typeof s === 'string') {
      const b = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
      chunks.push(b);
      length += b.length;
    } else {
      chunks.push(s);
      length += s.length;
    }
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(length);
    push(`${i + 1} 0 obj\n${obj.body}`);
    if (obj.binary) {
      push(obj.binary);
      push('\nendstream');
    }
    push('\nendobj\n');
  });

  const xref = length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const off of offsets) push(`${String(off).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * BUILD THE POSTER.
 *
 * @param {object}  opts
 * @param {string}  opts.url        the destination. ⭐ Always from `qrUrl()`.
 * @param {string}  opts.title      the headline: event, venue or artist name
 * @param {string} [opts.kicker]    the sub-line, e.g. "SET TIMES · SAT 21 JUN"
 * @param {string} [opts.footer]    the instruction. Defaults to the poster's.
 * @param {'A3'|'A4'|'A5'} [opts.size]   ⭐ A3 by default: this is a poster
 * @param {'L'|'M'|'Q'|'H'} [opts.ecl]   ⭐ Q by default: print gets scuffed
 * @param {Uint8Array} [opts.fontBytes]  Bebas Neue. Omit and it falls back.
 */
export function buildQrPdf({
  url, title, kicker = '', footer = 'SCAN OR GO TO YESPLEEZ.COM',
  size = DEFAULT_PAGE, ecl = 'Q', fontBytes = null, grain = true,
}) {
  const page = PAGE_SIZES[size] || PAGE_SIZES[DEFAULT_PAGE];
  const symbol = encodeQR(url, ecl);

  let font = null;
  if (fontBytes) {
    try {
      font = parseTrueType(fontBytes);
    } catch (err) {
      // ⚠ Said out loud. A silently substituted face is how a poster comes back
      // from the printer in Helvetica and nobody knows why.
      console.error('[qrPdf] display font unusable, falling back to Helvetica', err);
      font = null;
    }
  }

  const { ops, headline, plate } = layoutPoster(
    { title, kicker, footer },
    page,
    { measure: measurer(font), symbol, grain },
  );

  return {
    bytes: buildPdf(renderOps(ops, page), page, font),
    symbol, headline, plate, page,
    usedFont: !!font,
  };
}

/** The poster as a Blob, ready for a download or a share. */
export function qrPdfBlob(opts) {
  return new Blob([buildQrPdf(opts).bytes], { type: 'application/pdf' });
}
