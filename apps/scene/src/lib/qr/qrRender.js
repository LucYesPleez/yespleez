/**
 * QR RENDER — a symbol matrix becomes pixels or paths.
 *
 * ⛔ THIS FILE KNOWS NOTHING ABOUT YESPLEEZ. It takes the matrix `qrEncode`
 * produced and draws it. No destination, no event, no branding, no copy. That
 * is the presentation/destination seam the brief asks for, and it is what lets
 * a second poster template arrive later without anything here changing.
 *
 * ── ⚠ THE QUIET ZONE IS NOT DECORATION ──────────────────────────────────
 *
 * The spec requires four light modules of margin on every side. Scanners use it
 * to find the symbol's edge, and a code printed hard against a dark background
 * or a photo simply does not read. ⛔ Do not let a caller set it below 4 to win
 * back a few millimetres of poster.
 *
 * ── ⚠ AND THE CODE IS ALWAYS DARK-ON-LIGHT ──────────────────────────────
 *
 * Scene is a dark app, so the instinct is a white code on the near-black card.
 * ⛔ Inverted symbols are out of spec and a good share of phone cameras refuse
 * them. `PAPER` is therefore not themable, and the preview draws the code on
 * its own light plate inside the dark card rather than inverting it.
 */

/** The four-module quiet zone, in modules. ⛔ Never smaller. */
export const QUIET_ZONE = 4;

/** The light ground a symbol is always drawn on. */
export const PAPER = '#FFFFFF';

/** The default ink. Near-black rather than pure black: it prints softer and
 *  scans identically, and it matches the app's own ink. */
export const INK = '#0A0A14';

/** Total modules across, including both quiet zones. */
export function symbolSpan(sym) {
  return sym.size + QUIET_ZONE * 2;
}

/**
 * The symbol as one SVG path `d` string, in MODULE units.
 *
 * One path for the whole code rather than a rect per module: a version 10
 * symbol is ~3,000 dark modules, and 3,000 DOM nodes in a live preview is the
 * difference between instant and visibly slow on a phone.
 *
 * ⚠ Units are modules, so the caller sets a viewBox of `0 0 span span` and
 * never has to know the version.
 */
export function toPathData(sym) {
  let d = '';
  for (let y = 0; y < sym.size; y++) {
    for (let x = 0; x < sym.size; x++) {
      if (sym.modules[y][x]) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return d;
}

/**
 * A complete, self-contained SVG document.
 *
 * `shape-rendering="crispEdges"` matters: without it a browser antialiases the
 * module edges and a small on-screen code loses contrast at exactly the size
 * people scan it at.
 */
export function toSVG(sym, { ink = INK, paper = PAPER } = {}) {
  const span = symbolSpan(sym);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" `
    + `width="${span * 8}" height="${span * 8}" shape-rendering="crispEdges">`
    + `<rect width="${span}" height="${span}" fill="${paper}"/>`
    + `<path fill="${ink}" d="${toPathData(sym)}"/>`
    + `</svg>`;
}

/**
 * Draw onto a canvas at a whole-pixel module size.
 *
 * ⚠⚠ THE ROUNDING IS THE POINT. At a fractional module size the browser
 * antialiases every edge and the exported PNG is soft — it still scans on a
 * good phone in good light, and fails on a cheap one in a dark room, which is
 * the condition it will actually meet. So the pixel size is derived from a
 * whole number of pixels per module and the canvas takes whatever size that
 * gives, rather than the other way round.
 *
 * @param {object} sym            from encodeQR
 * @param {number} targetPx       desired width; the result is the nearest size
 *                                that keeps modules whole
 * @returns {HTMLCanvasElement}
 */
export function toCanvas(sym, { targetPx = 1024, ink = INK, paper = PAPER } = {}) {
  const span = symbolSpan(sym);
  const scale = Math.max(1, Math.round(targetPx / span));
  const dim = span * scale;

  const canvas = document.createElement('canvas');
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = ink;
  for (let y = 0; y < sym.size; y++) {
    for (let x = 0; x < sym.size; x++) {
      if (sym.modules[y][x]) {
        ctx.fillRect((x + QUIET_ZONE) * scale, (y + QUIET_ZONE) * scale, scale, scale);
      }
    }
  }
  return canvas;
}

/** PNG data URL, for an <img> and for right-click-save. */
export function toPngDataUrl(sym, opts) {
  return toCanvas(sym, opts).toDataURL('image/png');
}

/** PNG blob, for the clipboard and for a download. */
export function toPngBlob(sym, opts) {
  return new Promise((resolve) => toCanvas(sym, opts).toBlob(resolve, 'image/png'));
}
