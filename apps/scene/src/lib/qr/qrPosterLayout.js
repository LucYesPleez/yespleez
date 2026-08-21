/**
 * THE POSTER, AS A LIST OF SHAPES.
 *
 * ⭐⭐ ONE LAYOUT, THREE OUTPUTS. This file decides where everything goes and
 * paints nothing. `qrPdf.js` turns the result into PDF operators for print,
 * `qrPosterCanvas.js` turns the same result into canvas calls for the PNG and
 * for the on-screen proof. Before this existed the PDF and the preview were
 * two independent implementations of the same design, and the preview was
 * already drifting — a person approves one poster and prints another.
 *
 * ⛔ Nothing here knows about PDF operators, canvas contexts, colours as CSS
 * strings, or the DOM. It emits primitives in PAGE UNITS with the origin at the
 * TOP LEFT and y increasing downward, because that is how both a canvas and a
 * human think. ⚠ The PDF backend flips it; that flip lives there, once.
 *
 * ── THE DESIGN (owner, 2026-08-21, matched to a supplied poster) ─────────
 *
 *     black ground, edge to edge
 *     ENORMOUS condensed cream caps, balanced across up to three lines
 *     a small widely tracked tan sub-line, spread to nearly the full width
 *     a WHITE ROUNDED PLATE holding the code
 *     a hyphen, the instruction, a hyphen
 *
 * ⭐⭐ THE HEADLINE IS HORIZONTALLY COMPRESSED TO 73%, and that is not a
 * shortcut — it is measured off the reference. Bebas at its natural width tops
 * out at a cap height of about 20% of the page width once a line fills the
 * margins; the reference reaches 27%. The difference is exactly this squeeze:
 * narrower glyphs let the same line width carry much taller caps, which is what
 * makes the poster shout. ⛔ Do not "fix" it back to 100%.
 */

/** Ratios that define the poster. Every one is a fraction of the PAGE WIDTH. */
export const POSTER = Object.freeze({
  margin: 0.036,
  headlineSqueeze: 73,
  headlineLeading: 0.80,
  headlineMaxSize: 0.44,
  headlineMinSize: 0.05,
  headlineMaxLines: 3,
  headlineMaxHeightOfPage: 0.52,
  kickerTracking: 0.30,
  kickerTargetWidth: 0.84,
  kickerMaxSize: 0.062,
  plateWidth: 0.645,
  plateRadius: 0.055,
  footerTargetWidth: 0.72,    // measured off the reference poster
  footerMaxSize: 0.036,     // cap height then lands at ~2.5% of the width, as the reference does
  footerTracking: 0.16,
});

export const PALETTE = Object.freeze({
  ground: [0, 0, 0],
  cream: [0.933, 0.910, 0.847],
  tan: [0.827, 0.784, 0.686],
  plate: [1, 1, 1],
  code: [0.04, 0.04, 0.05],
});

/**
 * ⚠⚠ ACCENTS RISE ABOVE CAP HEIGHT, AND THE LEADING IS TIGHTER THAN THEY ARE.
 *
 * Measured off the face at 1000px, not guessed:
 *
 *     plain caps      E I  0.703      the cap height
 *     acute, grave,
 *     circumflex,
 *     tilde caps      É Á Ñ  0.875
 *     diaeresis       Ä Ü  0.859
 *     ring            Å  0.922
 *     cedilla         Ç  0.719 up, and 0.156 BELOW the baseline
 *
 * The poster's leading is 0.80em, which is generous for 0.703 and far too tight
 * for 0.875. The visible result on `SOLSTICE / SOIRÉE` was the acute on the É
 * poking up into the line above and reading as a stray slash through the word
 * SOLSTICE — it looked like a rendering bug and it was ordinary typography.
 *
 * ⛔ Do not fix this by nudging a magic number. The leading is computed from
 * what the lines actually contain, so a title with no accents keeps the tight
 * default and one with accents gets exactly the room it needs.
 *
 * ⚠ AND IT MUST BE A TABLE, NOT A MEASUREMENT. The canvas backend could ask
 * `TextMetrics.actualBoundingBoxAscent`, but the PDF backend has no such thing
 * without parsing per-glyph bounding boxes out of `glyf` — and the two backends
 * MUST lay out identically or the proof stops proving anything.
 */
const CAP_HEIGHT = 0.703;
const TALL_ACCENT = 0.925;
const DEEP_TAIL = 0.16;
const TALL = /[ÁÀÂÃÄÅÉÈÊËÍÌÎÏÑÓÒÔÕÖØÚÙÛÜÝŸŠŽČĆŃŚŹŻ]/;
const DEEP = /[ÇĄĘŞŢ]/;

/** How far this line's ink rises above its baseline, in em. */
export function lineAscent(text) {
  return TALL.test(String(text).toUpperCase()) ? TALL_ACCENT : CAP_HEIGHT;
}

/** How far it drops below, in em. */
export function lineDescent(text) {
  return DEEP.test(String(text).toUpperCase()) ? DEEP_TAIL : 0;
}

/**
 * ⭐⭐ THE GRAIN.
 *
 * The reference's letterforms are speckled, as though printed on rough stock.
 * It is done here by CLIPPING to the glyph outlines and scattering small dark
 * flecks inside them, so the type stays vector and stays sharp at any size.
 * ⛔ It is NOT an image: embedding a texture would give up the reason the page
 * is vector in the first place.
 *
 * ⚠ THE SCATTER IS DETERMINISTIC. `Math.random` would give the same poster a
 * different texture on every export, so re-downloading a poster you already
 * printed would not match the one on the wall. The generator below is a plain
 * 32-bit hash walk seeded from the text, so a given headline always grains the
 * same way — and the tests can assert on it.
 */
function speckleSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function speckles(seedText, box, { density, minSize, maxSize }) {
  let s = speckleSeed(seedText) || 1;
  const rnd = () => {
    // xorshift32: no state beyond `s`, identical everywhere it runs.
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const count = Math.round((box.w * box.h) / (density * density));
  const out = [];
  for (let i = 0; i < count; i++) {
    const size = minSize + rnd() * (maxSize - minSize);
    out.push({
      x: box.x + rnd() * (box.w - size),
      y: box.y + rnd() * (box.h - size),
      w: size,
      h: size,
    });
  }
  return out;
}

/**
 * Lay the poster out.
 *
 * @param {object} spec    {title, kicker, footer}
 * @param {object} page    {w, h}
 * @param {object} tools
 *   measure(text, size, {tracking, squeeze}) -> width in page units
 *   symbol  the encoded QR, for the plate's quiet zone
 * @returns {{ops: object[], headline: object, plate: object}}
 */
export function layoutPoster(spec, page, { measure, symbol, grain = true }) {
  const R = POSTER;
  const W = page.w;
  const margin = W * R.margin;
  const contentW = W - margin * 2;

  /**
   * ⭐⭐ THE CODE GETS ITS SPACE FIRST, and the headline takes what is left.
   *
   * The obvious order is the other way round — set the title, then fit the
   * plate underneath — and it produces a poster where a three-word venue name
   * squeezes the code down to less than half the width. On a wall that is the
   * difference between scanning from across the room and having to walk up to
   * it, and the code is the only reason the poster exists.
   *
   * So the plate's height is reserved before the headline is sized, and a long
   * title is set smaller rather than the code being shrunk.
   */
  const kickerSize = spec.kicker ? Math.min(W * R.kickerMaxSize, W * 0.062) : 0;
  /* ⚠ The RESERVATION takes the footer's worst case, not its typical size —
     the budget must never be optimistic or a fitted footer eats into the plate. */
  const footerSize = Math.max(8.5, W * R.footerMaxSize);
  const reserved = margin * 2                       // top and bottom margins
    + W * R.plateWidth                              // the plate, at full size
    + (kickerSize ? kickerSize * 1.65 : 0)          // the sub-line and its air
    + footerSize * 2.4                              // the footer and its air
    + margin;                                       // the gap above the plate

  /* ── the headline ─────────────────────────────────────────────────────
     Balanced, not greedily wrapped. Greedy fills each line to the margin and
     dumps the remainder on the last one, so a title breaks as WHAT'S ON IN /
     BELLO? and the poster looks broken. Partitioning so the widest line is as
     narrow as possible gives WHAT'S ON / IN BELLO?, and because the size is
     driven by the widest line, evening them out makes every line bigger. */
  const headline = fitBalanced(String(spec.title || '').toUpperCase(), {
    measure,
    squeeze: R.headlineSqueeze,
    maxWidth: contentW,
    maxHeight: Math.min(page.h * R.headlineMaxHeightOfPage, page.h - reserved),
    maxSize: W * R.headlineMaxSize,
    minSize: W * R.headlineMinSize,
    maxLines: R.headlineMaxLines,
    /* ⚠ The height budget uses the WORST-CASE leading for this title, because
       the real leading depends on which lines the fit chooses and the fit needs
       the leading to decide. Conservative by at most one accent's worth, and
       ⛔ never optimistic, which would let the block overrun the plate. */
    leading: TALL.test(String(spec.title || '').toUpperCase())
      ? TALL_ACCENT
      : R.headlineLeading,
  });

  const ops = [];
  ops.push({ type: 'rect', x: 0, y: 0, w: W, h: page.h, fill: PALETTE.ground });

  /**
   * ⭐ THE LEADING IS DERIVED, and it opens ONLY AS FAR AS IT MUST.
   *
   * Two lines cannot overlap if the gap is at least the lower line's ascent
   * plus the upper line's descent. ⛔ No extra air is added on top of that:
   * the tight 0.80em is the look, and an accented title opens to 0.875em, which
   * is a change nobody sees.
   *
   * ⚠⚠ WHY IT IS WORTH DOING AT ALL, since `SOLSTICE / SOIRÉE` looked fine: the
   * acute rises 0.875em against 0.80em of leading, so it sits 0.075em ABOVE the
   * previous line's baseline. On that title it landed in the gap between two
   * letters and read as a stray slash. Whether it lands in a gap or straight
   * through a letter is pure luck of which characters sit above it — so the
   * poster was one title away from an accent cutting through a word.
   *
   * ⚠ Uniform across the headline: uneven gaps in one block read as a mistake.
   */
  let leadingEm = R.headlineLeading;
  for (let i = 1; i < headline.lines.length; i++) {
    leadingEm = Math.max(
      leadingEm,
      lineAscent(headline.lines[i]) + lineDescent(headline.lines[i - 1]),
    );
  }
  const leading = headline.size * leadingEm;

  const capTop = margin;
  /* ⚠ The first baseline hangs from its OWN ascent, so an accent on line one
     sits inside the margin instead of being clipped by the page edge. */
  const firstAscent = lineAscent(headline.lines[0]);
  const headlineRuns = headline.lines.map((text, i) => ({
    text,
    size: headline.size,
    squeeze: R.headlineSqueeze,
    tracking: 0,
    baseline: capTop + headline.size * firstAscent + i * leading,
    width: measure(text, headline.size, { squeeze: R.headlineSqueeze }),
  }));
  for (const run of headlineRuns) run.x = (W - run.width) / 2;

  const lastLine = headline.lines[headline.lines.length - 1];
  const headlineBox = {
    x: Math.min(...headlineRuns.map(r => r.x)),
    y: capTop,
    w: Math.max(...headlineRuns.map(r => r.width)),
    /* ⚠ The grain clips to this box, so it has to reach the deepest ink or the
       texture stops partway down a Ç. */
    h: (headlineRuns.length - 1) * leading
      + headline.size * (firstAscent + lineDescent(lastLine) + 0.03),
  };

  /* ⭐ One clip group: the runs define the shape, the fill and the flecks paint
     inside it. Both backends implement this as clip-then-paint. */
  ops.push({
    type: 'texturedText',
    runs: headlineRuns,
    fill: PALETTE.cream,
    box: headlineBox,
    flecks: !grain ? [] : speckles(headline.lines.join(' '), headlineBox, {
      density: headline.size * 0.040,
      minSize: headline.size * 0.0035,
      maxSize: headline.size * 0.011,
    }),
    fleckFill: PALETTE.ground,
  });

  let y = capTop + headlineBox.h;

  /* ── the sub-line ─────────────────────────────────────────────────────
     Tracked out to nearly the full width, which is what makes it read as a
     rule under the headline rather than a caption under a picture. ⚠ Sized to
     FILL that width, then capped, so a two-word kicker does not become type. */
  const kickerText = String(spec.kicker || '').toUpperCase();
  let kicker = null;
  if (kickerText) {
    const target = W * R.kickerTargetWidth;
    const unit = measure(kickerText, 1, { tracking: R.kickerTracking });
    const size = Math.min(W * R.kickerMaxSize, target / unit);
    /**
     * ⭐ TRACKING TAKES UP THE SLACK. Sizing alone spreads a long sub-line to
     * the target width, but a short one ("WHAT'S ON", "VENUE") hits the size
     * cap first and ends up a stub in the middle of the page. Letting the
     * tracking grow once the size is capped spreads every sub-line to the same
     * width, which is what makes it read as a rule under the headline.
     * ⚠ Bounded: past about 0.9em the words stop being words.
     */
    const natural = measure(kickerText, size);
    const gaps = Math.max(1, kickerText.length - 1);
    const tracking = Math.min(size * 0.9, Math.max(R.kickerTracking * size, (target - natural) / gaps));
    const width = measure(kickerText, size, { tracking });
    kicker = {
      text: kickerText, size, tracking, width,
      x: (W - width) / 2,
      baseline: y + size * (0.55 + lineAscent(kickerText)),
    };
    /**
     * ⛔ THE SUB-LINE IS CLEAN (owner, 2026-08-21). ⚠ The grain belongs to the
     * headline only. At this size the flecks stop reading as printed texture
     * and start reading as dirt on the letters, and the sub-line is already
     * carrying wide tracking — two treatments on one small line is one too many.
     */
    ops.push({
      type: 'text',
      runs: [{ ...kicker, squeeze: 100 }],
      fill: PALETTE.tan,
    });
    y = kicker.baseline + size * 0.4;
  }

  /**
   * ── the footer ───────────────────────────────────────────────────────
   *
   * ⭐ PLAIN HYPHENS, one each side (owner, 2026-08-21). It was two stroked
   * rules, which was a way of getting the reference's look without typing an em
   * dash — the house rule forbids those in user-facing copy. A hyphen is not an
   * em dash, so it breaks nothing and it is simpler: one string, one draw, and
   * the spacing comes from the tracking like every other letter.
   * ⛔ Still never `—` or `–` here.
   */
  const footerText = `- ${String(spec.footer || '').toUpperCase()} -`;

  /**
   * ⭐ SIZED TO FILL, like the sub-line — ⛔ not a fixed fraction of the page.
   *
   * It was `0.026 * W`, which on the reference measures out at about 40% of the
   * page width against the reference's own 72%: a footer that shrinks away to a
   * caption. Fitting it to a target width instead means it reads at the same
   * weight whatever the instruction says, and a longer footer sets smaller
   * rather than running into the margins.
   *
   * ⚠ `footerSize` above is the RESERVATION, taken at `footerMaxSize`; this is
   * the real size and the same cap bounds it, so it can never grow past what the
   * headline budget already set aside.
   */
  const footerTarget = W * R.footerTargetWidth;
  const footerFitted = Math.min(
    W * R.footerMaxSize,
    footerTarget / measure(footerText, 1, { tracking: R.footerTracking }),
  );
  /* ⭐ TRACKING TAKES UP THE SLACK, exactly as it does for the sub-line. Size
     alone stops at the cap and leaves the footer spanning 58% of the page where
     the reference spans 72%; letterspacing the rest of the way is what the
     reference does too, and it keeps the cap height where it belongs. */
  const footerNatural = measure(footerText, footerFitted);
  const footerGaps = Math.max(1, footerText.length - 1);
  const footerTracking = Math.min(
    footerFitted * 0.9,
    Math.max(footerFitted * R.footerTracking, (footerTarget - footerNatural) / footerGaps),
  );
  const footerWidth = measure(footerText, footerFitted, { tracking: footerTracking });
  const footerBaseline = page.h - margin - footerFitted * 0.2;
  const footerX = (W - footerWidth) / 2;

  /* ── the plate ────────────────────────────────────────────────────────
     Centred in what is left between the type and the footer. */
  /**
   * ⭐⭐ THE PLATE IS SQUARE, and that is not a style choice. A QR symbol is
   * square, so a wide plate leaves the code sized by the plate's HEIGHT with
   * dead white either side — measured at one point: the code filled 56% of the
   * plate's width instead of 77%, which on a wall is the difference between
   * scanning from across the room and having to walk up to it.
   *
   * ⚠ So the width gives way, never the squareness: if the vertical space is
   * tight the whole plate shrinks and stays square.
   */
  const top = y + margin * 0.5;
  const bottom = footerBaseline - footerSize * 1.5;
  const available = bottom - top;
  const plateSide = Math.min(W * R.plateWidth, available);
  const plateW = plateSide;
  const plateH = plateSide;
  const plateX = (W - plateW) / 2;
  const plateY = top + (available - plateH) / 2;

  ops.push({
    type: 'roundedRect',
    x: plateX, y: plateY, w: plateW, h: plateH, r: plateW * R.plateRadius,
    fill: PALETTE.plate,
  });

  /**
   * ⭐⭐ THE QUIET ZONE IS COUNTED IN MODULES, ⛔ never set as a percentage.
   * The white padding is what a scanner uses to find the symbol's edge and the
   * spec's minimum is four modules. A percentage inset was generous on a small
   * symbol and 3.2 modules on a version 6 one — under spec, on the poster it
   * was made for.
   */
  const quiet = Math.max(4, Math.round(symbol.size * 0.141));
  const codeSide = Math.min(plateW, plateH);
  const plate = {
    x: plateX, y: plateY, w: plateW, h: plateH, quiet,
    codeSide, moduleSize: codeSide / (symbol.size + quiet * 2),
  };

  ops.push({
    type: 'symbol',
    symbol,
    quiet,
    x: plateX + (plateW - codeSide) / 2,
    y: plateY + (plateH - codeSide) / 2,
    side: codeSide,
    fill: PALETTE.code,
  });

  ops.push({
    type: 'text',
    runs: [{
      text: footerText, size: footerFitted, tracking: footerTracking, squeeze: 100,
      x: footerX, baseline: footerBaseline, width: footerWidth,
    }],
    fill: PALETTE.cream,
  });
  return { ops, headline, plate };
}

/**
 * Choose the largest size at which the title fits, with the lines balanced.
 *
 * ⛔ A title is never truncated. If nothing fits it is set at the floor on as
 * many lines as it takes — setting a venue's name smaller is always better than
 * cutting it off on their own poster.
 */
function fitBalanced(str, {
  measure, squeeze, maxWidth, maxHeight, maxSize, minSize, maxLines, leading,
}) {
  const words = str.split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [''], size: minSize };

  const w1 = words.map(word => measure(word, 1, { squeeze }));
  const space1 = measure(' ', 1, { squeeze });
  const lineWidth = (from, to) => {
    let total = 0;
    for (let i = from; i <= to; i++) total += w1[i] + (i > from ? space1 : 0);
    return total;
  };

  const memo = new Map();
  const solve = (from, n) => {
    const key = `${from}:${n}`;
    if (memo.has(key)) return memo.get(key);
    let out;
    if (n === 1) {
      out = { widest: lineWidth(from, words.length - 1), breaks: [] };
    } else {
      out = { widest: Infinity, breaks: [] };
      for (let end = from; end <= words.length - n; end++) {
        const here = lineWidth(from, end);
        if (here >= out.widest) continue;
        const rest = solve(end + 1, n - 1);
        const widest = Math.max(here, rest.widest);
        if (widest < out.widest) out = { widest, breaks: [end, ...rest.breaks] };
      }
    }
    memo.set(key, out);
    return out;
  };

  const linesFrom = (breaks) => {
    const lines = [];
    let start = 0;
    for (const b of [...breaks, words.length - 1]) {
      lines.push(words.slice(start, b + 1).join(' '));
      start = b + 1;
    }
    return lines;
  };

  let chosen = null;
  for (let n = 1; n <= Math.min(maxLines, words.length); n++) {
    const { widest, breaks } = solve(0, n);
    if (!Number.isFinite(widest) || widest <= 0) continue;
    let size = Math.min(maxSize, maxWidth / widest);
    if (maxHeight) size = Math.min(size, maxHeight / (n * leading));
    if (size < minSize) continue;
    if (!chosen || size > chosen.size) chosen = { lines: linesFrom(breaks), size };
  }
  if (!chosen) {
    const n = Math.min(maxLines, words.length);
    chosen = { lines: linesFrom(solve(0, n).breaks), size: minSize };
  }
  return chosen;
}
