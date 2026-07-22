# Why we scan RAW files for JPEG markers

**Written 2026-07-22, when M13 shipped. Read this before touching
`findLargestJpeg` or `extractEmbeddedPreview` in `v2/src/lib/imageUtils.js`.**

## The one-line answer

**The embedded preview JPEG is the user experience. The RAW is the asset.**

A photographer sends a `.NEF`. In the thread it appears as an ordinary
photograph — thumbnail, viewer, pinch-zoom, a Yes on double-tap — exactly like a
picture off a phone. Behind it, the untouched raw file sits under the gold HD
chip with a countdown, waiting to be downloaded.

Those are two different files doing two different jobs, and one of them was
already inside the other.

## The problem it solves

No browser can decode a camera raw file. Not Chrome, not Safari, not Firefox,
not on any platform. `new Image()` fails, `createImageBitmap` fails,
`<canvas>` has nothing to draw. So the entire M11 pipeline — EXIF correction,
downscale to 2560, thumbnail at 720, re-encode to WebP — cannot run on the one
file type that most deserves an HD original.

Which left a choice:

1. **Refuse RAW.** The obvious option, and briefly what we shipped. But it means
   "Upload HD image" rejects the files photographers actually call HD. The row
   exists for exactly these people.
2. **Show a card.** A grey rectangle with a filename and a download button. It
   works, and it makes the thread inconsistent — one message that is a
   photograph but does not look like one.
3. **Find a picture inside the file.** This.

## Why option 3 is available at all

Cameras have embedded ordinary JPEGs inside their raw files for about twenty
years, because the camera's own screen has the same problem we do: it cannot
render its own raw format fast enough to be useful. So the firmware writes a
JPEG alongside the sensor data — usually two, a small thumbnail for the file
browser and a large or full-size preview for playback and zoom.

Every operating system's file browser, Lightroom's grid view and the back of the
camera are all showing you that JPEG. We are doing the same thing they do.

## How the scan works

A JPEG is bounded by two unambiguous byte sequences: it opens `FF D8 FF` and
closes `FF D9`. `findLargestJpeg` walks the file for those pairs and returns the
**largest** complete image found.

Three details are load-bearing, and each of them is a test:

**The third byte matters.** `FF D8` alone occurs constantly inside compressed
sensor data. Matching on two bytes sends the scan hunting through megabytes of
noise and can return garbage.

**The first `FF D9` really is the end.** This relies on the format: JPEG
byte-stuffs every `0xFF` inside entropy-coded data as `FF 00`, so a bare `FF D9`
cannot legitimately occur *within* an image. An earlier draft of the test suite
asserted the opposite and was simply wrong about JPEG. Without that guarantee
the scan would have to look for the *last* end marker before the next start,
which is strictly worse — one chance `FF D8 FF` in sensor noise would then
swallow everything after it.

**Scanning resumes after an image, not inside it.** Compressed data readily
contains byte pairs that look like a start marker. Re-entering an image finds
nested fragments.

**There is a size floor** (24 KB). A raw file's small thumbnail is a few
kilobytes, and blown up across a message bubble it looks like a corrupted send
rather than a photograph. Below the floor we return null and fall back to the
card.

## The rule about dimensions

⚠ **When the preview came from a raw file, we do not know the picture's
resolution, and we must not claim to.**

The embedded JPEG's size is the camera's choice. It is routinely a quarter of
the sensor's output — a 45-megapixel body may embed a 1920 × 1280 preview. So:

- `prepareImage` sets `sourceWidth`/`sourceHeight` to `null` whenever the canvas
  came from an embedded preview.
- `describeOriginal` falls back to naming the **type** instead:
  `Nikon RAW (.NEF)`, `Canon RAW (.CR3)`, `TIFF`.

Printing `1920 × 1280` for a file that is actually `8256 × 5504` would be a
specific, checkable, wrong claim about the one property the recipient cannot
verify without downloading. "Nikon RAW (.NEF)" is both true and more useful to a
photographer than a pixel count.

The maker's name is derived from the extension, not the mime type — browsers
report raw files as `application/octet-stream` or as nothing at all, which is
also why the upload `accept` list spells out every vendor extension.

## What we know we have not tested

⚠ **No real camera file has ever been through this.** The scanner is covered by
synthetic tests over hand-built byte sequences, which prove the parsing logic and
nothing about any actual manufacturer.

The specific risk is preview size varying by maker. Worth testing with at least:

| Maker | Extension |
|---|---|
| Canon | `.CR2`, `.CR3` |
| Nikon | `.NEF` |
| Sony | `.ARW` |
| Fujifilm | `.RAF` |
| OM System / Olympus | `.ORF` |
| Panasonic | `.RW2` |

**If one comes through small, blurry or oddly cropped**, the cause is almost
certainly that its largest embedded JPEG is a reduced preview rather than a
full-size one. The lever is `minBytes` in `findLargestJpeg` — raising it makes
the scan reject small previews and fall back to the card, which is the better
outcome when the alternative is a soft, upscaled picture presented as the photo.

Some bodies also embed the preview with its own EXIF orientation, and some do
not. Watch for a raw arriving rotated when the JPEG beside it does not.

## What the preview is not

The embedded JPEG carries the camera's in-body processing — white balance,
picture style, sharpening. That is precisely what a raw file exists to let you
change later. It is the right trade for a chat preview and the wrong one for
anything else, which is why the **untouched** raw is what gets preserved,
downloaded, and described as the original.

## Related

- `v2/src/lib/imageUtils.js` — `findLargestJpeg`, `extractEmbeddedPreview`
- `v2/src/lib/messageImages.js` — `prepareImage`, `describeOriginal`
- `v2/src/lib/embeddedPreview.test.js` — the scanner's tests
- `supabase/migrations/20260722000003_m13_hd_originals.sql` — the expiry gate
