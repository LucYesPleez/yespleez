import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildQrPdf, PAGE_SIZES, DEFAULT_PAGE } from './qrPdf.js';
import { parseTrueType, sanitise, winAnsiByte } from './qrFont.js';
import { POSTER, lineAscent, lineDescent } from './qrPosterLayout.js';

/**
 * A PDF that a reader silently REPAIRS looks fine on the machine that made it
 * and can fail at a print shop. So these tests check the file's structure and
 * the drawn geometry, not just that bytes came out.
 *
 * ⚠ What they cannot check is whether it LOOKS right. That is done by opening
 * one, and by the acceptance step every printed code needs: scan the print.
 */

const DEST = 'https://yespleez.com/#/q/set-times/55512cb8-72e8-446c-9fff-f195d7e002c3';
const FONT = fs.readFileSync(new URL('../../../public/fonts/BebasNeue-Regular.ttf', import.meta.url));

const poster = (over = {}) => buildQrPdf({
  url: DEST,
  title: 'Solstice Soirée',
  kicker: 'SET TIMES · SAT 21 JUN',
  fontBytes: FONT,
  ...over,
});

function text(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** Every drawing op on the page, in PDF user space. */
function marks(bytes, page) {
  const s = text(bytes);
  const rects = [...s.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f/g)].map(m => m.slice(1).map(Number));
  const modules = rects.filter(([, , w, h]) => !(w === page.w && h === page.h) && Math.abs(w / h - 1) < 40);
  const lines = [...s.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\n\((.*?)\) Tj/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), t: m[3] }));
  return { s, rects, modules, lines };
}

/** The symbol's drawn extent, told apart from the grain by where it sits. */
function codeBox(built) {
  const { rects } = marks(built.bytes, built.page);
  const p = built.plate;
  const inPlate = rects.filter(([x, y, w, h]) => {
    const fy = built.page.h - y - h;      // back to top-left space
    return x >= p.x - 1 && x + w <= p.x + p.w + 1 && fy >= p.y - 1 && fy + h <= p.y + p.h + 1;
  });
  return {
    left: Math.min(...inPlate.map(r => r[0])),
    right: Math.max(...inPlate.map(r => r[0] + r[2])),
    bottom: Math.min(...inPlate.map(r => r[1])),
    top: Math.max(...inPlate.map(r => r[1] + r[3])),
    count: inPlate.length,
  };
}

/* ── the document ────────────────────────────────────────────────────────── */

test('it is a PDF, with the objects a one-page document needs', () => {
  const s = text(poster().bytes);
  assert.ok(s.startsWith('%PDF-1.4'), 'no PDF header');
  assert.ok(s.includes('/Type /Catalog'));
  assert.ok(s.includes('/Type /Pages'));
  assert.ok(s.includes('/Type /Page '));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
});

/**
 * ⚠⚠ THE FAILURE THAT IS INVISIBLE UNTIL IT IS NOT. Byte offsets in the xref
 * table are what a reader uses to find each object. Build the file with a UTF-8
 * encoder and the binary comment becomes two bytes, every offset after it is
 * wrong, and readers differ on whether they repair it or refuse it. With a
 * 56 KB font embedded there is a great deal more after that point to go wrong.
 */
test('⛔ every xref offset lands exactly on its object', () => {
  const s = text(poster().bytes);
  const xrefAt = Number(s.slice(s.lastIndexOf('startxref')).match(/startxref\s+(\d+)/)[1]);
  assert.ok(s.startsWith('xref', xrefAt), 'startxref does not point at the xref table');

  const entries = [...s.slice(xrefAt).matchAll(/^(\d{10}) 00000 n /gm)].map(m => Number(m[1]));
  assert.equal(entries.length, 7, 'expected seven objects with the font embedded');
  entries.forEach((off, i) => {
    assert.ok(s.startsWith(`${i + 1} 0 obj`, off),
      `object ${i + 1} is not at offset ${off} — the file would need repairing`);
  });
});

test('the content stream length matches the stream it declares', () => {
  const s = text(poster().bytes);
  const declared = Number(s.match(/<< \/Length (\d+) >>\s*stream/)[1]);
  assert.equal(s.slice(s.indexOf('stream\n') + 7, s.indexOf('\nendstream')).length, declared);
});

test('q and Q are balanced', () => {
  const s = text(poster().bytes);
  const body = s.slice(s.indexOf('stream\n') + 7, s.indexOf('\nendstream'));
  const opens = (body.match(/^q$/gm) || []).length;
  const closes = (body.match(/^Q$/gm) || []).length;
  assert.equal(opens, closes, 'an unbalanced clip would leak into the rest of the page');
  assert.ok(opens > 0, 'no clip group was written, so there is no grain');
});

/* ── the embedded face ───────────────────────────────────────────────────── */

test('⭐⭐ Bebas Neue is embedded, with the descriptor a viewer needs', () => {
  const built = poster();
  assert.equal(built.usedFont, true, 'the font was rejected and the poster fell back');
  const s = text(built.bytes);
  assert.ok(s.includes('/Subtype /TrueType'));
  assert.ok(s.includes('/BaseFont /BebasNeue-Regular'));
  assert.ok(s.includes('/Encoding /WinAnsiEncoding'));
  assert.ok(s.includes('/FontFile2'));
  for (const key of ['/Flags', '/FontBBox', '/ItalicAngle', '/Ascent', '/Descent', '/CapHeight', '/StemV']) {
    assert.ok(s.includes(key), `descriptor is missing ${key}`);
  }
});

/**
 * ⚠ `/Length1` is the uncompressed length of the TrueType file. Readers that
 * validate it reject a font without it and substitute a face WITHOUT WARNING —
 * the exact failure that looks fine on screen and wrong on paper.
 */
test('⛔ the font stream declares /Length1, and it is the real file length', () => {
  const m = text(poster().bytes).match(/<< \/Length (\d+) \/Length1 (\d+) >>/);
  assert.ok(m, 'no FontFile2 stream dictionary');
  assert.equal(Number(m[1]), FONT.length);
  assert.equal(Number(m[2]), FONT.length);
});

test('the width table covers WinAnsi and matches the font', () => {
  const font = parseTrueType(FONT);
  assert.equal(font.widths.length, 224);
  assert.ok(font.widthOf('A') > 0 && font.widthOf('é') > 0, 'Latin-1 coverage is missing');
  assert.ok(font.widthOf(' ') > 0, 'a zero-width space would run every word together');
});

/**
 * ⭐⭐ THE APOSTROPHE. The reference poster says WHAT’S ON and an earlier
 * version printed WHAT'S ON, because the encoder dropped every character above
 * U+00FF. The face has the glyph; the byte just had to be found for it.
 */
test('⭐⭐ a typographic apostrophe reaches the page as itself', () => {
  assert.equal(winAnsiByte('’'), 0x92);
  assert.equal(parseTrueType(FONT).widthOf('’'), 188, 'the face does carry it');
  assert.equal(sanitise('WHAT’S ON'), 'WHAT’S ON', '⛔ sanitise must not flatten it any more');

  const s = text(poster({ title: 'What’s On in Bello?' }).bytes);
  // ⚠ Per word: the headline wraps, so the whole phrase is never one string.
  assert.ok(s.includes(`WHAT${String.fromCharCode(0x92)}S`), 'the apostrophe was dropped or straightened');
});

test('a character no single-byte font can carry is dropped, not mangled', () => {
  const s = text(poster({ title: 'Solstice 🎉 Party' }).bytes);
  assert.ok(s.includes('SOLSTICE'));
  assert.ok(!/Ã°Å¸/.test(s), 'mojibake reached the page');
});

/**
 * ⚠ THE FALLBACK EXISTS SO AN EXPORT NEVER FAILS, and it must stay visibly a
 * fallback rather than a silent substitution.
 */
test('with no font it still produces a poster, in Helvetica', () => {
  const built = buildQrPdf({ url: DEST, title: 'Solstice', kicker: 'SET TIMES' });
  assert.equal(built.usedFont, false);
  const s = text(built.bytes);
  assert.ok(s.includes('/BaseFont /Helvetica-Bold'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
});

test('a font that is not a font is refused, and the poster still builds', () => {
  const built = buildQrPdf({ url: DEST, title: 'X', fontBytes: new Uint8Array(200) });
  assert.equal(built.usedFont, false);
  assert.ok(text(built.bytes).trimEnd().endsWith('%%EOF'));
});

/* ── the symbol ──────────────────────────────────────────────────────────── */

/**
 * ⭐⭐ THE CODE MUST BE VECTOR. If this ever becomes an /Image XObject the
 * poster has stopped being print-ready at poster size, which is the entire
 * reason this file exists rather than a PNG wrapped in a page.
 */
test('⭐⭐ the symbol is drawn as vector rectangles, ⛔ never an image', () => {
  const s = text(poster().bytes);
  assert.ok(!s.includes('/Subtype /Image'), 'the QR was rasterised');
  assert.ok(!s.includes('/XObject'), 'the QR was rasterised');
  assert.ok((s.match(/ re f/g) || []).length > 100);
});

/* ── the grain ───────────────────────────────────────────────────────────── */

/**
 * ⭐⭐ THE ORDER IS A SAFETY PROPERTY. The letters are painted first and
 * normally; only the flecks are clipped. A reader that ignores text clipping
 * then still renders a correct headline. The alternative — clip, then flood the
 * box with cream — paints a solid slab over the poster on that same reader.
 */
test('⭐⭐ the letters are painted before anything is clipped', () => {
  const body = text(poster().bytes);
  const firstClip = body.indexOf('7 Tr');
  const firstText = body.indexOf('Tj');
  assert.ok(firstClip > 0, 'no text clip, so no grain');
  assert.ok(firstText < firstClip, '⛔ the headline is drawn only inside the clip');
});

test('the grain is inside a clip group, and is dark on the cream', () => {
  const body = text(poster().bytes);
  const clip = body.slice(body.indexOf('7 Tr'));
  assert.ok(clip.includes('0 0 0 rg'), 'the flecks are not the ground colour');
  assert.ok((clip.match(/ re f/g) || []).length > 200, 'too few flecks to read as texture');
});

/**
 * ⚠ DETERMINISTIC. `Math.random` would give the same poster a different texture
 * on every export, so re-downloading one you already printed would not match
 * the copy on the wall.
 */
test('⚠ the same poster grains identically every time', () => {
  assert.deepEqual([...poster().bytes], [...poster().bytes]);
});

test('a different title grains differently', () => {
  const a = poster({ title: 'Alpha' }).bytes.length;
  const b = poster({ title: 'Bravo' }).bytes.length;
  assert.notEqual(a, b, 'the texture is not keyed to the text');
});

test('grain can be turned off, and then nothing is clipped', () => {
  const s = text(poster({ grain: false }).bytes);
  assert.ok(!s.includes('7 Tr'), 'a clip was written with no flecks to put in it');
  assert.ok(s.includes('Tj'), 'the headline vanished with the grain');
});

/* ── the layout ──────────────────────────────────────────────────────────── */

/**
 * ⚠⚠ NOTHING MAY FALL OFF THE PAGE, and nothing may collide. A PDF viewer clips
 * silently — an off-page headline simply is not there, and a symbol overlapping
 * the footer still exports, still looks like a QR, and does not scan.
 */
test('⛔ every mark sits inside the page, in the right order down it', () => {
  const built = poster();
  const page = built.page;
  const { lines } = marks(built.bytes, page);
  const code = codeBox(built);

  assert.ok(code.left >= 0 && code.right <= page.w, 'the symbol runs off the page');
  assert.ok(code.bottom >= 0 && code.top <= page.h);

  assert.ok(lines.length >= 3, 'expected a headline, a sub-line and the footer');
  for (const l of lines) assert.ok(l.x >= 0 && l.y >= 0 && l.y <= page.h, `"${l.t}" is off the page`);

  const headlineY = Math.max(...lines.map(l => l.y));
  const footerY = Math.min(...lines.map(l => l.y));
  assert.ok(headlineY > code.top, 'the headline overlaps the symbol');
  assert.ok(footerY < code.bottom, 'the footer overlaps the symbol');
});

/**
 * ⭐⭐ THE PLATE IS SQUARE, so the symbol is never sized by the short side with
 * dead white either side. Measured once at 56% of the plate width instead of
 * 77% — on a wall that is the difference between scanning from across the room
 * and walking up to it.
 */
test('⭐⭐ the plate is square and the code fills it', () => {
  const built = poster();
  assert.ok(Math.abs(built.plate.w - built.plate.h) < 0.5, 'the plate is not square');
  const code = codeBox(built);
  const fill = (code.right - code.left) / built.plate.w;
  assert.ok(fill > 0.7, `the code fills only ${(fill * 100).toFixed(0)}% of the plate`);
});

/**
 * ⭐⭐ THE QUIET ZONE IS COUNTED IN MODULES. The white padding is what a scanner
 * uses to find the symbol's edge and the spec's minimum is four. A percentage
 * inset was generous on a small symbol and 3.2 modules on a version 6 one.
 */
test('⭐⭐ the plate gives the symbol at least four modules of quiet zone', () => {
  const built = poster();
  const code = codeBox(built);
  const p = built.plate;
  const gaps = {
    left: code.left - p.x,
    right: (p.x + p.w) - code.right,
    bottom: code.bottom - (built.page.h - p.y - p.h),
    top: (built.page.h - p.y) - code.top,
  };
  for (const [side, gap] of Object.entries(gaps)) {
    assert.ok(gap >= p.moduleSize * 4 - 0.01,
      `${side} quiet zone is ${(gap / p.moduleSize).toFixed(1)} modules, needs 4`);
  }
  assert.ok(built.plate.quiet >= 4);
});

test('⛔ the quiet zone holds at every symbol version a destination can reach', () => {
  for (const ecl of ['L', 'Q', 'H']) {
    for (const pad of [0, 40, 300]) {
      const built = poster({ url: DEST + 'x'.repeat(pad), ecl });
      const code = codeBox(built);
      const gap = code.left - built.plate.x;
      assert.ok(gap >= built.plate.moduleSize * 4 - 0.01,
        `v${built.symbol.version}-${ecl}: ${(gap / built.plate.moduleSize).toFixed(1)} modules`);
    }
  }
});

/**
 * ⭐⭐ THE CODE GETS ITS SPACE FIRST. A long venue name must set smaller rather
 * than squeeze the plate — the code is the only reason the poster exists.
 */
test('⭐⭐ a long title shrinks the type, ⛔ never the code', () => {
  const short = poster({ title: 'Catharsis' });
  const long = poster({ title: 'Beyond Jazz Weekender 2026 Friday The Jazz Doof' });
  assert.ok(long.headline.size < short.headline.size, 'the headline did not give way');
  assert.ok(Math.abs(long.plate.w - short.plate.w) < 1,
    `the plate shrank from ${short.plate.w.toFixed(0)} to ${long.plate.w.toFixed(0)}`);
  assert.ok(long.headline.lines.join(' ').includes('DOOF'), '⛔ the title was truncated');
});

/**
 * ⚠⚠ THE ACCENT THAT LOOKED LIKE A RENDERING BUG.
 *
 * `SOLSTICE / SOIRÉE` at 0.80em leading put the acute on the É up into the line
 * above, where it read as a stray slash through the word SOLSTICE. Measured off
 * the face: plain caps rise 0.703em, É rises 0.875, Å 0.922 — all of them past
 * the leading. ⛔ The lines must not be able to touch.
 */
/** The drawn baselines of the headline's own lines, top line first. */
function headlineBaselines(built) {
  const { lines } = marks(built.bytes, built.page);
  return built.headline.lines.map((text) => {
    const drawn = lines.find(l => l.t === pdfLiteral(text));
    assert.ok(drawn, `headline line "${text}" was never drawn`);
    return drawn.y;
  });
}

/** The same escaping `pdfString` applies, so a drawn line can be found by text. */
function pdfLiteral(str) {
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

test('⚠⚠ an accent never reaches the line above', () => {
  let checked = 0;
  for (const title of ['Solstice Soirée', 'Café Åland Ñandú', 'Ça Ira Encore Ce Soir']) {
    const built = poster({ title });
    if (built.headline.lines.length < 2) continue;
    const em = built.headline.size;
    const ys = headlineBaselines(built);
    for (let i = 1; i < built.headline.lines.length; i++) {
      const gap = ys[i - 1] - ys[i];              // baseline to baseline, PDF space
      const ink = lineAscent(built.headline.lines[i]) + lineDescent(built.headline.lines[i - 1]);
      assert.ok(gap >= ink * em - 0.01,
        `"${title}": ${(gap / em).toFixed(3)}em of leading for ${ink.toFixed(3)}em of ink`);
      checked++;
    }
  }
  assert.ok(checked >= 2, `expected multi-line accented titles, checked ${checked}`);
});

/**
 * ⚠ AND IT OPENS ONLY AS FAR AS IT MUST. The tight leading is the look; an
 * accented title goes from 0.80em to 0.875em and nobody sees the difference.
 */
test('⚠ a title with no accents keeps the tight leading', () => {
  const gapOf = (built) => {
    const ys = headlineBaselines(built);
    return (ys[0] - ys[1]) / built.headline.size;
  };
  const plain = poster({ title: 'Solstice Soiree Tonight' });
  const accented = poster({ title: 'Solstice Soirée Tonight' });
  assert.ok(plain.headline.lines.length >= 2 && accented.headline.lines.length >= 2);

  assert.ok(Math.abs(gapOf(plain) - POSTER.headlineLeading) < 0.005,
    `plain title leads at ${gapOf(plain).toFixed(3)}em, expected ${POSTER.headlineLeading}`);
  assert.ok(gapOf(accented) > gapOf(plain), 'the accented title did not get its room');
  assert.ok(gapOf(accented) < POSTER.headlineLeading + 0.13,
    'the accented title opened up more than it needed');
});

test('an accent on the first line stays inside the top margin', () => {
  const built = poster({ title: 'Éire Tonight' });
  const inkTop = built.page.h - (headlineBaselines(built)[0]
    + built.headline.size * lineAscent(built.headline.lines[0]));
  assert.ok(inkTop >= 0, `the accent is ${(-inkTop).toFixed(1)}pt off the top of the page`);
});

test('the headline is compressed, which is what makes it big', () => {
  const built = poster({ title: 'Catharsis' });
  assert.ok(text(built.bytes).includes(`${POSTER.headlineSqueeze} Tz`), 'the squeeze is gone');
  const capRatio = (built.headline.size * 0.7) / built.page.w;
  assert.ok(capRatio > 0.24, `cap height is ${(capRatio * 100).toFixed(1)}% of the page width, reference is ~27%`);
});

/**
 * ⭐ Tracking takes up the slack, so a two-word sub-line spreads to the same
 * width as a long one instead of sitting as a stub in the middle of the page.
 */
test("⭐ a short sub-line is tracked out to the same width as a long one", () => {
  const long = marks(poster({ kicker: 'GIGS & EVENTS COMMUNITY' }).bytes, PAGE_SIZES[DEFAULT_PAGE]);
  const short = marks(poster({ kicker: "WHAT'S ON" }).bytes, PAGE_SIZES[DEFAULT_PAGE]);
  const widthOf = (m) => {
    const tc = [...m.s.matchAll(/([\d.]+) Tc\n1 0 0 1 ([\d.]+) [\d.]+ Tm/g)].map(x => Number(x[2]));
    return Math.min(...tc);   // the left edge of the most-inset run
  };
  // Both sub-lines start near the same x, which is what "same width" means for
  // a centred line.
  assert.ok(Math.abs(widthOf(long) - widthOf(short)) < PAGE_SIZES[DEFAULT_PAGE].w * 0.12,
    'the short sub-line did not spread');
});

test('the page is filled black, edge to edge', () => {
  const s = text(poster().bytes);
  const p = PAGE_SIZES[DEFAULT_PAGE];
  assert.ok(s.includes(`0 0 0 rg\n0.000 0.000 ${p.w.toFixed(3)} ${p.h.toFixed(3)} re f`), 'the poster has no ground');
});

/**
 * ⭐ PLAIN HYPHENS, one each side (owner, 2026-08-21). It was two stroked rules
 * — a way of getting the reference's look without typing an em dash, which the
 * house rule forbids in user-facing copy. A hyphen is not an em dash, so it
 * breaks nothing and it is one string instead of three ops.
 */
test('⭐ the footer is hyphens, ⛔ never em dashes', () => {
  const s = text(poster().bytes);
  const drawn = [...s.matchAll(/\((.*?)\) Tj/g)].map(m => m[1]);
  const footer = drawn.find(t => t.includes('SCAN OR GO TO'));
  assert.ok(footer, 'the footer is missing');
  assert.equal(footer, '- SCAN OR GO TO YESPLEEZ.COM -');
  for (const t of drawn) {
    assert.ok(!t.includes('—') && !t.includes('–'), `an em dash reached the page: "${t}"`);
  }
  assert.ok(!/[\d.]+ [\d.]+ m [\d.]+ [\d.]+ l S/.test(s), 'the old stroked rules are still being drawn');
});

/* ── the pages ───────────────────────────────────────────────────────────── */

test('A3 is the default, because this is a thing that goes on a wall', () => {
  assert.equal(DEFAULT_PAGE, 'A3');
  assert.ok(text(poster().bytes).includes(`/MediaBox [0 0 ${PAGE_SIZES.A3.w} ${PAGE_SIZES.A3.h}]`));
});

/**
 * ⭐ One template at three sizes: every measurement is a fraction of the page,
 * so A5 and A3 are the same poster rather than three tuned layouts.
 */
test('every paper size is the same poster', () => {
  const ratios = [];
  for (const size of Object.keys(PAGE_SIZES)) {
    const built = poster({ size });
    const s = text(built.bytes);
    assert.ok(s.includes(`/MediaBox [0 0 ${PAGE_SIZES[size].w} ${PAGE_SIZES[size].h}]`));
    assert.ok(s.includes('/Count 1'));
    ratios.push(built.plate.w / built.page.w);
  }
  const spread = Math.max(...ratios) - Math.min(...ratios);
  assert.ok(spread < 0.02, `the plate is ${(spread * 100).toFixed(1)}% of the width apart across sizes`);
});

/**
 * Parentheses and backslashes end a PDF string early. An event called
 * "Disco Pig (Late)" would truncate the headline and corrupt the stream.
 */
test('⛔ a title with brackets does not corrupt the file', () => {
  const s = text(poster({ title: 'Disco Pig (Late) \\ Room 2' }).bytes);
  assert.ok(s.includes('\\(LATE\\)'), 'brackets were not escaped');
  assert.ok(s.includes('\\\\'), 'the backslash was not escaped');
  const declared = Number(s.match(/<< \/Length (\d+) >>\s*stream/)[1]);
  assert.equal(s.slice(s.indexOf('stream\n') + 7, s.indexOf('\nendstream')).length, declared);
});

test('the default EC level is Q, because print gets scuffed', () => {
  assert.equal(poster().symbol.ecl, 'Q');
});
