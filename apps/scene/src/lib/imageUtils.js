/**
 * ⚠ THE BROWSER HAS ALREADY ROTATED THE IMAGE. READ THIS BEFORE TOUCHING
 *    ANY ROTATION CODE IN THIS FILE.
 *
 * Every current browser applies EXIF orientation itself when it decodes a JPEG
 * into an `<img>` — `image-orientation: from-image` has been the default since
 * ~2020. By the time `img.onload` fires, the pixels are upright and
 * `naturalWidth`/`naturalHeight` are ALREADY swapped for a portrait photo.
 *
 * This file predates that. It swapped the canvas and applied the transform a
 * SECOND time, so an iPhone photo arrived a further 90° clockwise — landscape,
 * on its side. Fixed 2026-07-22 after the first real photo went through M11.
 *
 * ⚠ THE FIX IS NOT "ROTATE THE OTHER WAY". That would correct today's browsers
 * and break any that does not auto-orient. Which happened has to be DETECTED,
 * and `orientationToApply` below detects it from evidence rather than assuming.
 */

/**
 * The raw JPEG facts: the EXIF orientation tag, and the dimensions actually
 * encoded in the file.
 *
 * Both come from one walk of the marker chain. The raw size is the point: it is
 * the only way to tell whether the browser rotated for us, because it is the
 * one measurement EXIF cannot have changed. `<img>` reports post-rotation dims;
 * the SOF marker reports what the encoder wrote.
 *
 * 256 KB rather than 64: EXIF carrying an embedded thumbnail routinely pushes
 * the SOF marker past 64 KB, and a truncated read returns no dimensions at all,
 * which silently costs us the detection.
 */
export function readJpegMeta(file) {
  return new Promise(resolve => {
    const out = { orientation: 1, rawWidth: 0, rawHeight: 0 };
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const view = new DataView(e.target.result);
        if (view.getUint16(0, false) !== 0xFFD8) { resolve(out); return; }
        let offset = 2;
        while (offset + 4 < view.byteLength) {
          const marker = view.getUint16(offset, false);

          if (marker === 0xFFE1) {
            if (view.getUint32(offset + 4, false) === 0x45786966) {
              const little = view.getUint16(offset + 10, false) === 0x4949;
              const ifdOff = view.getUint32(offset + 14, little);
              const tags   = view.getUint16(offset + 10 + ifdOff, little);
              for (let i = 0; i < tags; i++) {
                const tagOff = offset + 10 + ifdOff + 2 + i * 12;
                if (view.getUint16(tagOff, little) === 0x0112) {
                  out.orientation = view.getUint16(tagOff + 8, little);
                  break;
                }
              }
            }
          }

          // SOF0–SOF15: the frame header, carrying the encoded size. C4/C8/CC
          // share the range but are the Huffman/arithmetic tables, not frames —
          // reading them as a frame yields garbage dimensions.
          if (marker >= 0xFFC0 && marker <= 0xFFCF
              && marker !== 0xFFC4 && marker !== 0xFFC8 && marker !== 0xFFCC) {
            out.rawHeight = view.getUint16(offset + 5, false);
            out.rawWidth  = view.getUint16(offset + 7, false);
            resolve(out); return;    // everything wanted is now known
          }

          if (marker === 0xFFDA) break;               // start of scan
          if ((marker & 0xFF00) !== 0xFF00) break;    // desynced; stop guessing
          offset += 2 + view.getUint16(offset + 2, false);
        }
      } catch (_) {}
      resolve(out);
    };
    reader.readAsArrayBuffer(file.slice(0, 262144));
  });
}

/** Kept for callers that only want the tag. */
export async function readExifOrientation(file) {
  const { orientation } = await readJpegMeta(file);
  return orientation;
}

/**
 * How much rotation THIS CODE still has to do, given what the browser already
 * did — 1 (meaning "none") whenever the browser has handled it.
 *
 * ── HOW IT KNOWS ─────────────────────────────────────────────────────
 *
 * Orientations 5–8 are quarter turns, so they swap width and height. That makes
 * them self-evidencing: if the decoded image's dimensions are the TRANSPOSE of
 * what the file encodes, the browser rotated it. No feature detection, no magic
 * test image, no user-agent — a direct measurement of what actually happened to
 * this file in this browser.
 *
 * Orientations 2/3/4 are flips and a 180° turn, which preserve dimensions and
 * therefore cannot be detected this way. They fall back to "the browser did
 * it", because no browser applies orientation selectively: one that auto-orients
 * a quarter turn auto-orients a flip. That assumption is only reached for tags
 * a phone camera essentially never writes.
 *
 * Pure, and separated from the DOM, so it can be tested — the failure it exists
 * to prevent is silent and invisible in code review.
 */
export function orientationToApply({ orientation, rawWidth, rawHeight, naturalWidth, naturalHeight }) {
  if (!orientation || orientation === 1) return 1;

  const quarterTurn = orientation >= 5 && orientation <= 8;

  if (quarterTurn && rawWidth && rawHeight && naturalWidth && naturalHeight) {
    const browserRotated = naturalWidth === rawHeight && naturalHeight === rawWidth;
    return browserRotated ? 1 : orientation;
  }

  // Not measurable — see header. Modern default.
  return 1;
}

// Load a File, correct its orientation if the browser has not already, and
// return an HTMLCanvasElement. See `orientationToApply` for why that "if"
// exists — it is the whole bug this function used to have.
export function loadCorrectedCanvas(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);

      const meta = await readJpegMeta(file);
      // NOT the raw EXIF tag. What is LEFT to do after the browser's own
      // rotation — 1 on every current browser, which is why this canvas is
      // usually a straight copy.
      const orientation = orientationToApply({
        ...meta,
        naturalWidth:  img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });

      // orientations 5-8 swap width/height
      const swapped = orientation >= 5 && orientation <= 8;
      const cw = swapped ? img.naturalHeight : img.naturalWidth;
      const ch = swapped ? img.naturalWidth  : img.naturalHeight;

      const canvas = document.createElement('canvas');
      canvas.width  = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');

      switch (orientation) {
        case 2: ctx.transform(-1,  0,  0,  1, cw,  0); break;
        case 3: ctx.transform(-1,  0,  0, -1, cw, ch); break;
        case 4: ctx.transform( 1,  0,  0, -1,  0, ch); break;
        case 5: ctx.transform( 0,  1,  1,  0,  0,  0); break;
        case 6: ctx.transform( 0,  1, -1,  0, ch,  0); break;
        case 7: ctx.transform( 0, -1, -1,  0, ch, cw); break;
        case 8: ctx.transform( 0, -1,  1,  0,  0, cw); break;
        default: break;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * THE JPEG HIDING INSIDE A RAW FILE.
 *
 * No browser can decode a NEF, CR3, ARW or DNG — but it does not have to.
 * Essentially every camera embeds one or more ordinary JPEGs inside its raw
 * file so that the camera back, the operating system and Lightroom can show a
 * picture instantly. Cameras have done this for twenty years. Pulling that out
 * is the difference between a photographer's RAW appearing in the thread as a
 * photograph and appearing as a grey card with a filename on it.
 *
 * ── HOW ──────────────────────────────────────────────────────────────
 *
 * A JPEG is bounded by two unambiguous markers: it opens `FF D8 FF` and closes
 * `FF D9`. This scans the bytes for those pairs and returns the LARGEST one
 * found, because a raw file typically holds two or three — a 160px thumbnail
 * for the file browser and a full-size or near-full-size preview for the camera
 * screen. The big one is the one worth showing.
 *
 * ⚠ THE RESULT IS A PREVIEW, NOT THE PICTURE. Its dimensions are the camera's
 * choice and are frequently smaller than the sensor's, so its size must NEVER be
 * reported as the original's resolution. `prepareImage` deliberately drops the
 * source dimensions when the canvas came from here.
 *
 * ⚠ It also carries the camera's in-body processing — white balance, picture
 * style — which is exactly what a raw file exists to let you change later. That
 * is the right trade for a chat preview and the wrong one for anything else:
 * the untouched raw is what gets preserved and downloaded.
 *
 * Returns null when nothing usable is found, and the caller falls back to a
 * card. TIFFs generally land here: they hold no embedded JPEG.
 */
export function extractEmbeddedPreview(file, opts) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = e => {
      try {
        const bytes = new Uint8Array(e.target.result);
        const found = findLargestJpeg(bytes, opts);
        resolve(found ? new Blob([bytes.subarray(found.start, found.end)], { type: 'image/jpeg' }) : null);
      } catch (_) {
        resolve(null);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/**
 * The scan itself, separated from the file reading so it can be TESTED.
 *
 * There is no `FileReader` outside a browser, so leaving this inside the
 * promise above would make the one genuinely intricate part of raw support
 * unreachable by any test — and its failure mode is silent: it returns null and
 * a photographer's RAW quietly becomes a grey card.
 *
 * Returns `{ start, end, size }` for the largest embedded JPEG, or null.
 */
export function findLargestJpeg(bytes, { minBytes = 24 * 1024 } = {}) {
  let best = null;

  for (let i = 0; i + 3 < bytes.length; i++) {
    // Opening marker: FF D8 FF. The third byte matters — FF D8 alone occurs
    // often enough inside sensor data to send this hunting through megabytes
    // of noise.
    if (bytes[i] !== 0xFF || bytes[i + 1] !== 0xD8 || bytes[i + 2] !== 0xFF) continue;

    for (let j = i + 3; j + 1 < bytes.length; j++) {
      if (bytes[j] !== 0xFF || bytes[j + 1] !== 0xD9) continue;
      const end = j + 2;
      const size = end - i;
      // ⚠ THE FLOOR MATTERS. A raw file carries a tiny thumbnail as well as a
      // full preview, and a 6KB icon stretched across a message bubble looks
      // like a corrupted send rather than a photograph.
      if (size >= minBytes && (!best || size > best.size)) best = { start: i, end, size };
      // Resume AFTER this image rather than inside it: the compressed data of
      // one JPEG readily contains byte pairs that look like the start of
      // another, and scanning into it finds nested nonsense.
      //
      // ⚠ THE FIRST FF D9 IS THE END, AND THAT RELIES ON THE FORMAT. JPEG
      // byte-stuffs every 0xFF inside entropy-coded data as FF 00, so a bare
      // FF D9 cannot legitimately occur within an image — only at its end.
      // Without that guarantee this would have to scan for the LAST end marker
      // before the next start, which is strictly worse: a chance FF D8 FF in
      // sensor noise would then swallow everything after it.
      i = end - 1;
      break;
    }
  }

  return best;
}

// Resize a canvas to new dimensions
export function resizeCanvas(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(src, 0, 0, w, h);
  return c;
}

// Convert canvas to Blob (WebP preferred, JPEG fallback)
const _webpOk = (function () {
  try { return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'); }
  catch (_) { return false; }
})();

export function canvasToBlob(canvas, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const type = _webpOk ? 'image/webp' : 'image/jpeg';
    canvas.toBlob(b => b ? resolve({ blob: b, ext: _webpOk ? 'webp' : 'jpg', type }) : reject(new Error('toBlob failed')), type, quality);
  });
}
