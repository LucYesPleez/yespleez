/**
 * EXPORT — the two files a QR leaves the app as.
 *
 * ⛔ AN EXPORT IS NOT THE OBJECT. Nothing here is stored, and nothing reads a
 * saved row: both formats are generated from the destination URL at the moment
 * the button is pressed. That is what makes a saved QR reusable rather than a
 * file that has to be kept somewhere, and it is why re-exporting an old library
 * row a year later produces a correct, current file.
 *
 * PDF   the poster, vector, for print. Holds up at signage size. See qrPdf.js.
 * PNG   the same poster, rasterised, for a screen or a socials crop.
 * PNG   (code only) the bare symbol on white, for somebody else's layout.
 *
 * ⭐ THE POSTER PNG AND THE POSTER PDF ARE THE SAME PICTURE, from the same
 * layout through two backends — so a crop taken from the PNG for socials is the
 * real poster, not a lookalike.
 *
 * ⚠ THE CODE-ONLY PNG IS A DIFFERENT JOB, which is why it is a separate act
 * rather than a checkbox: it is what you hand a designer laying out their own
 * flyer, and a black ground with somebody else's headline would be useless.
 */

import { encodeQR } from './qrEncode';
import { toPngBlob } from './qrRender';
import { qrPdfBlob, PAGE_SIZES, DEFAULT_PAGE } from './qrPdf';
import { renderPoster } from './qrPosterCanvas';
import { loadDisplayFont } from './qrFontLoad';

/** `Solstice Gathering` + `set-times` -> `yespleez-set-times-solstice-gathering`. */
export function exportFilename(destinationType, title) {
  const slug = String(title || 'qr')
    .toLowerCase()
    // Strip combining marks so an accented name slugifies rather than vanishing.
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'qr';
  return `yespleez-${destinationType}-${slug}`;
}

/**
 * ⚠ ONE DOWNLOAD PATH, so the object URL is always revoked. A leaked blob URL
 * holds the whole file in memory for the life of the tab, and a venue exporting
 * a dozen posters in a sitting would hold all twelve.
 */
function download(blob, filename) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // A frame's grace, so the click is consumed before the URL is torn down.
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/**
 * THE POSTER AS A PNG — for a screen, a story, a slide, a socials post.
 *
 * ⭐ It is the SAME poster the PDF prints, drawn through the canvas backend from
 * the same layout, so cropping one for socials gives the real thing rather than
 * a lookalike. ⚠ 2000px on the long edge: enough to crop from and still small
 * enough to send.
 *
 * @param {object} spec {url, title, kicker, destinationType, pageSize}
 */
export async function exportPng(spec, px = 1400) {
  const page = PAGE_SIZES[spec.pageSize] || PAGE_SIZES[DEFAULT_PAGE];
  const { canvas } = await renderPoster(spec, page, px);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  download(blob, `${exportFilename(spec.destinationType, spec.title)}.png`);
  return blob;
}

/**
 * The bare symbol on white, with nothing around it.
 *
 * ⭐ A DIFFERENT JOB FROM THE POSTER, which is why it is a separate act rather
 * than an option. This is the file you hand a designer to drop into a flyer
 * they are laying out themselves; arriving with a black ground and somebody
 * else's headline already on it would be useless there.
 */
export async function exportCodeOnlyPng(spec, px = 2048) {
  const sym = encodeQR(spec.url, spec.ecl || 'Q');
  const blob = await toPngBlob(sym, { targetPx: px });
  download(blob, `${exportFilename(spec.destinationType, spec.title)}-code.png`);
  return blob;
}

/**
 * ⚠ ASYNC BECAUSE OF THE FONT. It resolves to a poster either way: a font that
 * will not load produces the fallback face, never a failed download.
 */
export async function exportPdf(spec) {
  const fontBytes = await loadDisplayFont();
  const blob = qrPdfBlob({
    url: spec.url,
    title: spec.title,
    kicker: spec.kicker,
    footer: spec.footer,
    size: spec.pageSize || DEFAULT_PAGE,
    ecl: spec.ecl || 'Q',
    fontBytes: fontBytes || null,
  });
  download(blob, `${exportFilename(spec.destinationType, spec.title)}.pdf`);
  return blob;
}

/** Copy the destination as a link, for a bio, an email or a socials post. */
export async function copyQrLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
