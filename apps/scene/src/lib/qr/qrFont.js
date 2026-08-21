/**
 * EMBEDDING BEBAS NEUE IN A PDF.
 *
 * ⭐⭐ WHY A REAL FONT AND NOT SQUASHED HELVETICA. The poster's identity IS the
 * tall condensed face — it is the app's own display face, and it is what makes
 * a printed YesPleez poster recognisable across a room. The cheap alternative
 * is Helvetica-Bold horizontally scaled with the `Tz` operator, which produces
 * condensed-looking caps whose vertical strokes go thin while the horizontals
 * stay fat. At 90pt that distortion is obvious and reads as a mistake.
 *
 * So the face is embedded properly, as a simple TrueType font with WinAnsi
 * encoding: `/FontFile2` carries the whole file, `/Widths` comes from the
 * font's own `hmtx`, and `/FontDescriptor` from `head`, `hhea` and `OS/2`.
 *
 * ⚠ LICENCE. Bebas Neue is SIL Open Font License 1.1 and its `fsType` is 0
 * (installable embedding, no restriction) — checked, not assumed. The licence
 * travels with the file at `public/fonts/BebasNeue-OFL.txt`. ⛔ Do not replace
 * the font with one whose `fsType` forbids embedding; the PDF would still build
 * and would be undistributable.
 *
 * ⚠ `unitsPerEm` IS 1000, which is why widths need no scaling. A font with 2048
 * units per em (most TrueType faces) would need every width divided — the code
 * below does that division, so swapping the face is safe, but ⛔ do not remove
 * it on the grounds that "the numbers already look right".
 *
 * ── ⛔ WHAT THIS IS NOT ──────────────────────────────────────────────────
 *
 * Not a font subsetter. The whole 56 KB file goes into every PDF, which makes a
 * poster about 70 KB. Subsetting would save maybe 50 KB per file and needs
 * `glyf`/`loca` surgery — the kind of code that produces a PDF which opens fine
 * in a browser and fails at a print shop. ⛔ Not worth it for a one-page poster.
 */

/** Read the sfnt table directory. */
function tables(view) {
  const count = view.getUint16(4);
  const out = {};
  for (let i = 0; i < count; i++) {
    const p = 12 + i * 16;
    let tag = '';
    for (let j = 0; j < 4; j++) tag += String.fromCharCode(view.getUint8(p + j));
    out[tag.trim()] = { offset: view.getUint32(p + 8), length: view.getUint32(p + 12) };
  }
  return out;
}

/** The (3,1) or (3,10) cmap subtable, format 4. */
function cmapLookup(view, cmapOffset) {
  const n = view.getUint16(cmapOffset + 2);
  let sub = null;
  for (let i = 0; i < n; i++) {
    const platform = view.getUint16(cmapOffset + 4 + i * 8);
    const encoding = view.getUint16(cmapOffset + 6 + i * 8);
    const offset = view.getUint32(cmapOffset + 8 + i * 8);
    if (platform === 3 && (encoding === 1 || encoding === 10)) sub = cmapOffset + offset;
  }
  if (sub === null || view.getUint16(sub) !== 4) return () => 0;

  const segX2 = view.getUint16(sub + 6);
  const endO = sub + 14;
  const startO = endO + segX2 + 2;
  const deltaO = startO + segX2;
  const rangeO = deltaO + segX2;

  return (cp) => {
    for (let s = 0; s < segX2 / 2; s++) {
      const end = view.getUint16(endO + s * 2);
      if (cp > end) continue;
      const start = view.getUint16(startO + s * 2);
      if (cp < start) return 0;
      const delta = view.getInt16(deltaO + s * 2);
      const ro = view.getUint16(rangeO + s * 2);
      if (ro === 0) return (cp + delta) & 0xffff;
      const gi = view.getUint16(rangeO + s * 2 + ro + (cp - start) * 2);
      return gi ? (gi + delta) & 0xffff : 0;
    }
    return 0;
  };
}

/**
 * WinAnsi byte → Unicode, for the 27 places the two disagree.
 *
 * ⭐⭐ THESE ARE NOT MISSING GLYPHS. Bebas Neue carries every one of them —
 * checked, not assumed: the curly apostrophe sits at U+2019 with a width of
 * 188. An earlier version of this file folded curly quotes down to straight
 * ones on the assumption they were undrawable, and the visible result was a
 * headline reading WHAT'S ON where the design said WHAT’S ON.
 *
 * ⚠ THE FOLD WAS NOT THE BUG; THE ENCODER WAS. `pdfString` walks characters and
 * drops anything above U+00FF, and U+2019 is 8217 — so the apostrophe was never
 * going to survive, fold or no fold. This map is now used in BOTH directions:
 * to build the width table, and to turn such a character back into the single
 * byte a WinAnsi font actually wants.
 */
const WINANSI_HIGH = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

/** Unicode → the WinAnsi byte that draws it. */
const TO_WINANSI = new Map(
  Object.entries(WINANSI_HIGH).map(([byte, cp]) => [cp, Number(byte)]),
);

/**
 * The single byte that draws this character, or null if nothing can.
 *
 * ⭐ This is what keeps a typographic apostrophe, an ellipsis or a bullet on the
 * page instead of silently vanishing out of somebody's event name.
 */
export function winAnsiByte(ch) {
  const cp = ch.codePointAt(0);
  if (cp <= 0xff) return cp;
  return TO_WINANSI.get(cp) ?? null;
}

/**
 * Normalise the few characters that are genuinely unrepresentable, and leave
 * alone everything WinAnsi can carry.
 *
 * ⛔ IT NO LONGER FLATTENS TYPOGRAPHY. Curly quotes, en and em dashes, the
 * ellipsis and the bullet all reach the page, because the face has them and
 * `winAnsiByte` can now encode them.
 * ⚠ A non-breaking space folds to a normal one: invisible either way, and it
 * breaks word wrapping if it survives.
 */
export function sanitise(str) {
  return String(str ?? '').replace(/ /g, ' ');
}

/**
 * Parse a TrueType file into everything the PDF needs.
 *
 * @param {ArrayBuffer|Uint8Array} bytes
 * @returns {{widths:number[], firstChar:number, lastChar:number, descriptor:object,
 *            bytes:Uint8Array, widthOf:(ch:string)=>number}}
 */
export function parseTrueType(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const t = tables(view);
  for (const required of ['head', 'hhea', 'hmtx', 'cmap', 'glyf', 'loca', 'maxp']) {
    if (!t[required]) throw new Error(`font is missing the ${required} table`);
  }

  const head = t.head.offset;
  const unitsPerEm = view.getUint16(head + 18);
  const bbox = [
    view.getInt16(head + 36), view.getInt16(head + 38),
    view.getInt16(head + 40), view.getInt16(head + 42),
  ].map(v => Math.round((v * 1000) / unitsPerEm));

  const hhea = t.hhea.offset;
  const numberOfHMetrics = view.getUint16(hhea + 34);
  const ascent = Math.round((view.getInt16(hhea + 4) * 1000) / unitsPerEm);
  const descent = Math.round((view.getInt16(hhea + 6) * 1000) / unitsPerEm);

  const os2 = t['OS/2']?.offset;
  const capHeight = os2 && view.getUint16(os2) >= 2
    ? Math.round((view.getInt16(os2 + 88) * 1000) / unitsPerEm)
    : Math.round(ascent * 0.72);
  // ⚠ CHECKED, NOT ASSUMED. fsType 2 forbids embedding outright.
  const fsType = os2 ? view.getUint16(os2 + 8) : 0;
  if ((fsType & 0x0002) !== 0) throw new Error('this font forbids embedding (fsType)');

  const italicAngle = t.post ? view.getInt32(t.post.offset + 4) / 65536 : 0;
  const glyphOf = cmapLookup(view, t.cmap.offset);
  const hmtx = t.hmtx.offset;

  const advance = (glyph) => {
    const i = Math.min(glyph, numberOfHMetrics - 1);
    return Math.round((view.getUint16(hmtx + i * 4) * 1000) / unitsPerEm);
  };

  const firstChar = 32;
  const lastChar = 255;
  const widths = [];
  for (let code = firstChar; code <= lastChar; code++) {
    const cp = WINANSI_HIGH[code] ?? code;
    const glyph = glyphOf(cp);
    widths.push(glyph ? advance(glyph) : 0);
  }

  return {
    bytes: u8,
    firstChar,
    lastChar,
    widths,
    /** ⚠ Via `winAnsiByte`, so a curly apostrophe measures as the glyph it will
     *  actually be drawn as rather than as nothing. Measuring and drawing must
     *  agree or centred lines sit off centre. */
    widthOf(ch) {
      const code = winAnsiByte(ch);
      if (code === null || code < firstChar || code > lastChar) return 0;
      return widths[code - firstChar];
    },
    descriptor: {
      // Flags: 4 = symbolic off, 32 = nonsymbolic. Bebas is a normal text face.
      flags: 32,
      bbox,
      italicAngle,
      ascent,
      descent,
      capHeight,
      // StemV has no reliable source in a TrueType file; PDF wants a number and
      // viewers use it only for substitution, which cannot happen for an
      // embedded font. 80 is the conventional value for a regular weight.
      stemV: 80,
    },
  };
}
