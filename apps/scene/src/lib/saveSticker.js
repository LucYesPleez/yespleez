/**
 * SAVING A STICKER — turning a rendered canvas into a file on someone's phone.
 * ---------------------------------------------------------------------------
 * ⛔⛔ THE OLD PATH DID NOT WORK, and it is worth saying why so it does not come
 * back. The shelf used `<a href={signedUrl} download>`, and the `download`
 * attribute is IGNORED on a cross-origin href — every browser treats it as a
 * plain navigation. Supabase storage is another origin, so tapping SAVE opened
 * the image in a tab and left the collector to long-press it. The code read as
 * if it saved; it never did.
 *
 * A blob URL minted here is same-origin, so `download` is honoured. That is
 * the fix, and rendering the effect is what makes it necessary anyway: the
 * file has to be composited before it can be handed over.
 *
 * ⚠ PNG, ALWAYS. Stickers are transparent by definition and JPEG has no alpha
 * channel — it would hand back the logo on a black box. ⛔ Never reuse
 * imageUtils' canvasToBlob here: it prefers WebP and falls back to JPEG, which
 * is right for photographs and wrong for every single sticker.
 */

import { renderSticker, loadStickerImage } from './stickerEffects';

/** `Elbows Rest logo.png` — never the storage path, which is a uuid soup. */
export function stickerFilename(name, effectKey) {
  const base = String(name || 'sticker')
    .replace(/\.[a-z0-9]+$/i, '')          // drop any existing extension
    .replace(/[^a-z0-9 _-]/gi, '')         // filesystem-hostile characters
    .trim()
    .slice(0, 60) || 'sticker';
  const suffix = effectKey && effectKey !== 'NONE' ? ` ${effectKey.toLowerCase()}` : '';
  return `${base}${suffix}.png`;
}

/**
 * Render `item` at full quality and hand it to the browser as a download.
 *
 * @param item {url, filename, effect}
 * @returns {saved: boolean, reason?: string}
 */
export async function saveStickerToDevice(item, { size = 1024 } = {}) {
  if (!item?.url) return { saved: false, reason: 'That sticker is unavailable.' };

  let canvas;
  try {
    const img = await loadStickerImage(item.url);
    /* ⚠ RENDERED AT SAVE SIZE, NOT AT TILE SIZE. The shelf paints an 84px
       thumbnail; saving that would give someone a postage stamp. `size` caps
       the square rather than upscaling — renderSticker never enlarges past
       1:1, so a small logo stays its own size and a large one comes down to
       something sane to keep in a camera roll. */
    canvas = renderSticker(img, item.effect || 'NONE', { size });
  } catch {
    /* Most often a tainted canvas: a cross-origin image loaded without CORS
       throws on getImageData. Saying "could not be prepared" is honest —
       ⛔ never fall back to the raw file, which would silently hand over the
       unstyled logo and look like the effect had been forgotten. */
    return { saved: false, reason: 'That sticker could not be prepared for saving.' };
  }

  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  if (!blob) return { saved: false, reason: 'That sticker could not be prepared for saving.' };

  const href = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = href;
    a.download = stickerFilename(item.filename, item.effect);
    /* Appended before clicking: a detached anchor is a no-op in Firefox. */
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    /* ⚠ Revoked on the next frame, not immediately — revoking synchronously
       after click() cancels the download in Safari before it has begun. */
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  }

  return { saved: true };
}
