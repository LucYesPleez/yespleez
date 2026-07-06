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

// Upload event poster (three sizes: original full + cropped display + thumb)
// originalCanvas = pre-crop (shown on event page); canvas = cropped (used in cards/app)
export async function uploadPoster(canvas, uid, suffix = 'new', originalCanvas = null) {
  const orig = originalCanvas || canvas;
  const [poster_full, poster, poster_thumb] = await Promise.all([
    uploadCanvas(orig,   1200, Math.round(1200 * orig.height / orig.width), 'posters', `event_posters/${uid}/${suffix}/original`, 0.88),
    uploadCanvas(canvas, 1200, 1500, 'posters', `event_posters/${uid}/${suffix}/full`, 0.85),
    uploadCanvas(canvas,  300,  375, 'posters', `event_posters/${uid}/${suffix}/thumb`, 0.80),
  ]);
  return { poster_full, poster, poster_thumb };
}

// Legacy helper used by VenueProfileScreen (kept for compatibility)
export { resizeCanvas };

// Block any accidental base64 from reaching the DB
export function assertNotBase64(value, label = 'value') {
  if (typeof value === 'string' && value.startsWith('data:image/')) {
    throw new Error(`${label} must be a Storage URL, not a base64 string`);
  }
}
