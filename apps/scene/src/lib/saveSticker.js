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
 * ⛔⛔ …AND ON AN IPHONE THAT FIX IS STILL A DEAD END. `<a download>` on iOS
 * Safari saves into FILES, not Photos, and nothing in Files can ever become a
 * Messages sticker. The sticker drawer is fed from Photos (touch and hold a
 * subject, Add Sticker), from Memoji, and from native iMessage sticker-pack
 * extensions. ⛔ THERE IS NO WEB API THAT WRITES TO THE DRAWER — not from a
 * tab, not from an installed PWA. Anyone who "fixes" that has misread it.
 *
 * ⭐⭐ SO THE SHARE SHEET IS THE PATH, not a nicety. `navigator.share({files})`
 * opens the real iOS sheet, whose Save Image lands the PNG in PHOTOS, which is
 * the one place iOS will lift it from. Download stays as the desktop path and
 * the fallback. ⛔ Never send `title`/`text` alongside the file: iOS then
 * offers the TEXT to the target app and the Save Image action disappears.
 *
 * ⚠⚠ SHARE NEEDS TRANSIENT ACTIVATION and compositing a 1024px PNG can outlive
 * it, so the file is rendered on POINTERDOWN and only shared on CLICK. Await
 * the render inside the click handler and iOS throws NotAllowedError on the
 * phone it was built for — see `renderStickerFile` and StickerTile's `warm`.
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
 * Composite `item` at save quality and wrap it as a PNG `File`.
 *
 * ⭐ SPLIT OUT SO IT CAN BE RENDERED AHEAD OF THE TAP. The share sheet needs
 * the file in hand while the user's activation is still live; see the header.
 *
 * @param item {url, filename, effect}
 * @returns {Promise<File|null>} null when the artwork will not composite
 */
export async function renderStickerFile(item, { size = 1024 } = {}) {
  if (!item?.url) return null;

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
       throws on getImageData. ⛔ Never fall back to the raw file, which would
       silently hand over the unstyled logo and look like the effect had been
       forgotten. */
    return null;
  }

  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  if (!blob) return null;

  return new File([blob], stickerFilename(item.filename, item.effect), { type: 'image/png' });
}

/**
 * Will this browser hand the PNG to the OS share sheet?
 *
 * ⚠ `canShare` IS THE CHECK, NOT `share`. Every mobile browser has
 * `navigator.share`; only some accept `files`, and calling `share` with files
 * where they are unsupported rejects mid-gesture with the activation already
 * spent, leaving no way to fall back to the download.
 */
export function canShareStickerFile(file) {
  if (!file || typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * ⚠ USER-AGENT, DELIBERATELY, AND ONLY FOR COPY. This gates the sentence that
 * names Photos and Add Sticker, which are iOS features by name. ⛔ Never gate
 * a CAPABILITY on this — `canShareStickerFile` does that, by asking.
 *
 * iPadOS reports itself as a Mac, hence the touch-point half.
 */
export function isAppleTouchDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
}

/**
 * Put the sticker somewhere the reader can use it.
 *
 * Share sheet where the platform has one (Photos, and from there the Messages
 * sticker drawer), download everywhere else.
 *
 * @param file a `renderStickerFile` result rendered ahead of the tap. ⚠ Pass it
 *        whenever there is one: rendering here instead costs the activation.
 * @returns {saved, method?: 'share'|'download', cancelled?, reason?}
 */
export async function saveStickerToDevice(item, { size = 1024, file = null } = {}) {
  if (!item?.url) return { saved: false, reason: 'That sticker is unavailable.' };

  const png = file || await renderStickerFile(item, { size });
  if (!png) return { saved: false, reason: 'That sticker could not be prepared for saving.' };

  if (canShareStickerFile(png)) {
    try {
      /* ⛔ FILES ONLY. A `title` or `text` here and iOS offers the text to the
         target app instead, which removes Save Image from the sheet — the one
         action this whole path exists to reach. */
      await navigator.share({ files: [png] });
      return { saved: true, method: 'share' };
    } catch (err) {
      /* ⭐ DISMISSING THE SHEET IS NOT A FAILURE. AbortError means the reader
         changed their mind; showing RETRY there would accuse them of a bug. */
      if (err?.name === 'AbortError') return { saved: false, cancelled: true };
      /* NotAllowedError means the activation was spent before we got here.
         Falling through to the download is worse than the sheet and far
         better than nothing. */
    }
  }

  const href = URL.createObjectURL(png);
  try {
    const a = document.createElement('a');
    a.href = href;
    a.download = png.name;
    /* Appended before clicking: a detached anchor is a no-op in Firefox. */
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    /* ⚠ Revoked on the next frame, not immediately — revoking synchronously
       after click() cancels the download in Safari before it has begun. */
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  }

  return { saved: true, method: 'download' };
}
