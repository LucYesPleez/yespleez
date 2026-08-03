import { supabase } from './supabase';
import { resizeCanvas, canvasToBlob } from './imageUtils';

// Upload a canvas at specified dimensions to Supabase Storage → public URL
async function uploadCanvas(canvas, outW, outH, bucket, path, quality) {
  const resized = resizeCanvas(canvas, outW, outH);
  const { blob, ext } = await canvasToBlob(resized, quality);
  const storagePath = `${path}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(storagePath, blob, {
    contentType: blob.type,
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}

// Upload avatar — two sizes generated from one crop:
//   hero  3200×3200 WebP @ 0.92  → profile headers (hi-res)
//   thumb  320×320  WebP @ 0.82  → portrait cards / discover
export async function uploadAvatar(canvas, bucket, pathPrefix) {
  const [hero, thumb] = await Promise.all([
    uploadCanvas(canvas, 3200, 3200, bucket, `${pathPrefix}_hero`,  0.92),
    uploadCanvas(canvas,  320,  320, bucket, `${pathPrefix}_thumb`, 0.82),
  ]);
  return { avatar_hero: hero, avatar_thumb: thumb };
}

/**
 * Upload an event POSTER — three SIZES, one ASPECT: the artwork's own.
 *
 * ⚠ NOTHING HERE CROPS, AND NOTHING MAY BE ADDED THAT DOES.
 *
 * This used to force the two display renditions to 4:5 (1200×1500 and
 * 300×375). For any poster that was not already 4:5 — a square tour flyer, a
 * wide festival banner — that permanently cut the top and bottom off the
 * stored file, and those are exactly the edges a poster carries its dates,
 * lineup, ticket source and sponsor marks on. Layout spec §0.1 is explicit:
 * "The Cover may crop. The Poster may not."
 *
 * The crop bought nothing even where it did no harm. Every card renders the
 * poster with `center/cover` or `object-fit: cover`, so cards crop at DISPLAY
 * time from whatever they are given; and § 11 fits rather than crops, reading
 * `poster_full || poster`. A pre-cropped file was destroying information to
 * duplicate something CSS already does reversibly.
 *
 * `poster_full` is kept as a distinct, larger rendition (not dropped as
 * redundant) because § 11's expand-to-fullscreen viewer wants the detail, and
 * because every event already in the database references it.
 */
export async function uploadPoster(canvas, uid, suffix = 'new', originalCanvas = null) {
  const src = originalCanvas || canvas;
  const h = w => Math.round(w * src.height / src.width);   // the artwork's own aspect, always
  const [poster_full, poster, poster_thumb] = await Promise.all([
    uploadCanvas(src, 1600, h(1600), 'posters', `event_posters/${uid}/${suffix}/original`, 0.88),
    uploadCanvas(src, 1200, h(1200), 'posters', `event_posters/${uid}/${suffix}/full`,     0.85),
    uploadCanvas(src,  400, h(400),  'posters', `event_posters/${uid}/${suffix}/thumb`,    0.80),
  ]);
  return { poster_full, poster, poster_thumb };
}

/**
 * Upload an event COVER — layout spec §0: a different object from the Poster,
 * with a different job. "The Cover sells the experience. The Poster preserves
 * the artwork."
 *
 * Landscape, and only two renditions rather than the poster's three:
 *
 * · No `_full` original. The Poster keeps an uncropped original because § 11
 *   renders it whole and must never lose the edges the organiser designed
 *   into it. A Cover is atmosphere — it fills the Hero frame edge to edge and
 *   is ALLOWED to crop (§0.1), so an uncropped copy would be a file nothing
 *   ever reads.
 * · 1800×1200 at 3:2 — the Hero's own frame aspect, so the common case is a
 *   straight fit with no further cropping at display time.
 *
 * Its own storage folder: covers and posters are different objects and mixing
 * them under `event_posters/` would make "which of these is the artwork?"
 * unanswerable from the path.
 */
export async function uploadCover(canvas, uid, suffix = 'new') {
  const [cover, cover_thumb] = await Promise.all([
    uploadCanvas(canvas, 1800, 1200, 'posters', `event_covers/${uid}/${suffix}/cover`, 0.85),
    uploadCanvas(canvas,  600,  400, 'posters', `event_covers/${uid}/${suffix}/thumb`, 0.80),
  ]);
  return { cover, cover_thumb };
}

// Legacy helper used by VenueProfileScreen (kept for compatibility)
export { resizeCanvas };

// Block any accidental base64 from reaching the DB
export function assertNotBase64(value, label = 'value') {
  if (typeof value === 'string' && value.startsWith('data:image/')) {
    throw new Error(`${label} must be a Storage URL, not a base64 string`);
  }
}
