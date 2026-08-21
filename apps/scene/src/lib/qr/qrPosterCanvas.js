/**
 * THE POSTER, ON A CANVAS.
 *
 * ⭐⭐ THE SECOND BACKEND FOR THE ONE LAYOUT. `qrPosterLayout.js` decides where
 * every shape goes; `qrPdf.js` draws that list as PDF operators for print and
 * this draws the identical list to a canvas. That is what the on-screen proof
 * and the PNG export both use, so the thing somebody approves is the thing that
 * prints. ⛔ Do not add a design decision here — if the poster needs to change,
 * it changes in the layout and both outputs follow.
 *
 * ⚠ THE FONT MUST BE LOADED BEFORE DRAWING. Canvas silently substitutes a
 * fallback face for one it does not have, and the poster would come out in the
 * browser's default sans with everything the wrong width. `document.fonts.load`
 * is awaited by the callers below for exactly this reason, and `renderPoster`
 * reports which face it used.
 */

import { encodeQR } from './qrEncode';
import { layoutPoster } from './qrPosterLayout';

export const DISPLAY_FACE = "'Bebas Neue', sans-serif";

const css = ([r, g, b]) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

/**
 * Measure the way canvas will draw.
 *
 * ⚠ Measurement and drawing must agree, so both go through the same font
 * string and the same squeeze. `letterSpacing` is applied for tracking where
 * the browser supports it and added arithmetically where it does not — Safari
 * lacks it, and a footer measured without tracking but drawn with it would sit
 * off centre.
 */
function canvasMeasure(ctx) {
  const supportsSpacing = 'letterSpacing' in ctx;
  return (str, size, { tracking = 0, squeeze = 100 } = {}) => {
    const s = String(str ?? '');
    if (!s) return 0;
    ctx.save();
    ctx.font = `${size}px ${DISPLAY_FACE}`;
    if (supportsSpacing) ctx.letterSpacing = '0px';
    const natural = ctx.measureText(s).width;
    ctx.restore();
    return (natural * squeeze) / 100 + tracking * Math.max(0, s.length - 1);
  };
}

function drawRuns(ctx, runs, scale) {
  const supportsSpacing = 'letterSpacing' in ctx;
  for (const run of runs) {
    const squeeze = (run.squeeze ?? 100) / 100;
    ctx.save();
    ctx.font = `${run.size * scale}px ${DISPLAY_FACE}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (supportsSpacing) ctx.letterSpacing = `${(run.tracking || 0) * scale}px`;
    // Horizontal compression is a transform, the same thing the PDF's Tz does.
    ctx.translate(run.x * scale, run.baseline * scale);
    ctx.scale(squeeze, 1);
    if (supportsSpacing || !run.tracking) {
      ctx.fillText(run.text, 0, 0);
    } else {
      // ⚠ Tracking by hand, so a browser without `letterSpacing` still lays the
      // sub-line out to the same width the layout measured.
      let x = 0;
      for (const ch of run.text) {
        ctx.fillText(ch, x, 0);
        x += ctx.measureText(ch).width + run.tracking * scale;
      }
    }
    ctx.restore();
  }
}

function roundedRectPath(ctx, x, y, w, h, r, scale) {
  const s = scale;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x * s, y * s, w * s, h * s, r * s);
  else {
    // Older Safari. Four arcs, same shape.
    const X = x * s, Y = y * s, W = w * s, H = h * s, R = r * s;
    ctx.moveTo(X + R, Y);
    ctx.arcTo(X + W, Y, X + W, Y + H, R);
    ctx.arcTo(X + W, Y + H, X, Y + H, R);
    ctx.arcTo(X, Y + H, X, Y, R);
    ctx.arcTo(X, Y, X + W, Y, R);
    ctx.closePath();
  }
}

function drawSymbol(ctx, op, scale) {
  const { symbol, quiet, x, y, side } = op;
  const span = symbol.size + quiet * 2;
  const m = (side / span) * scale;
  ctx.fillStyle = css(op.fill);
  for (let row = 0; row < symbol.size; row++) {
    let run = 0;
    for (let col = 0; col <= symbol.size; col++) {
      const dark = col < symbol.size && symbol.modules[row][col];
      if (dark) { run++; continue; }
      if (run > 0) {
        ctx.fillRect(
          x * scale + (col - run + quiet) * m,
          y * scale + (row + quiet) * m,
          run * m, m,
        );
        run = 0;
      }
    }
  }
}

/**
 * Textured text, the canvas way.
 *
 * ⚠ CANVAS HAS NO "ADD TEXT TO THE CLIP PATH", which is what the PDF uses. The
 * equivalent is an offscreen layer: draw the letters, then paint the flecks
 * over them with `source-atop`, which keeps only the parts that land on
 * existing ink. Compositing the layer back gives the identical result to the
 * PDF's clip. ⛔ Do not do this on the main canvas — `source-atop` there would
 * treat the whole poster as the mask and speckle the plate as well.
 */
function drawTexturedText(ctx, op, scale, W, H) {
  const layer = document.createElement('canvas');
  layer.width = W;
  layer.height = H;
  const lc = layer.getContext('2d');
  lc.fillStyle = css(op.fill);
  drawRuns(lc, op.runs, scale);

  if (op.flecks.length) {
    lc.globalCompositeOperation = 'source-atop';
    lc.fillStyle = css(op.fleckFill);
    for (const f of op.flecks) {
      lc.fillRect(f.x * scale, f.y * scale, Math.max(f.w * scale, 0.5), Math.max(f.h * scale, 0.5));
    }
    lc.globalCompositeOperation = 'source-over';
  }
  ctx.drawImage(layer, 0, 0);
}

/**
 * Draw a laid-out poster onto a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object[]} ops   from `layoutPoster`
 * @param {object} page    {w, h}
 * @param {number} scale   canvas pixels per page unit
 */
export function drawPoster(canvas, ops, page, scale) {
  canvas.width = Math.round(page.w * scale);
  canvas.height = Math.round(page.h * scale);
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  for (const op of ops) {
    switch (op.type) {
      case 'rect':
        ctx.fillStyle = css(op.fill);
        ctx.fillRect(op.x * scale, op.y * scale, op.w * scale, op.h * scale);
        break;
      case 'roundedRect':
        ctx.fillStyle = css(op.fill);
        roundedRectPath(ctx, op.x, op.y, op.w, op.h, op.r, scale);
        ctx.fill();
        break;
      case 'line':
        ctx.strokeStyle = css(op.stroke);
        ctx.lineWidth = op.w * scale;
        ctx.beginPath();
        ctx.moveTo(op.x1 * scale, op.y * scale);
        ctx.lineTo(op.x2 * scale, op.y * scale);
        ctx.stroke();
        break;
      case 'text':
        ctx.fillStyle = css(op.fill);
        drawRuns(ctx, op.runs, scale);
        break;
      case 'texturedText':
        drawTexturedText(ctx, op, scale, W, H);
        break;
      case 'symbol':
        drawSymbol(ctx, op, scale);
        break;
      default:
        break;
    }
  }
  return canvas;
}

/**
 * Make sure the display face is really available before anything is measured.
 *
 * ⚠ Returns false rather than throwing when it is not: a poster in the fallback
 * face is worth more than no poster, and the caller can say so.
 */
export async function ensureDisplayFont(size = 64) {
  if (!document.fonts?.load) return false;
  try {
    await document.fonts.load(`${size}px 'Bebas Neue'`);
    return document.fonts.check(`${size}px 'Bebas Neue'`);
  } catch {
    return false;
  }
}

/**
 * ⭐ THE WHOLE POSTER, ON A CANVAS — the entry point the preview and the PNG
 * export both use. Layout and drawing in one call, so neither can be done
 * without the other.
 *
 * @param {object} spec  {url, title, kicker, footer, ecl}
 * @param {object} page  from PAGE_SIZES
 * @param {number} pixelWidth
 */
export async function renderPoster(spec, page, pixelWidth) {
  const fontReady = await ensureDisplayFont();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const symbol = encodeQR(spec.url, spec.ecl || 'Q');
  const { ops, headline, plate } = layoutPoster(
    { title: spec.title, kicker: spec.kicker, footer: spec.footer || 'SCAN OR GO TO YESPLEEZ.COM' },
    page,
    { measure: canvasMeasure(ctx), symbol, grain: spec.grain !== false },
  );
  drawPoster(canvas, ops, page, pixelWidth / page.w);
  return { canvas, headline, plate, symbol, fontReady };
}
