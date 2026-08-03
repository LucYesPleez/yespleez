/**
 * VENUE MAPS — a static image per POSTCODE, held in our own bucket.
 * ---------------------------------------------------------------------------
 * One image per postcode, not per venue (owner, 2026-08-02): a venue in
 * Fernmount and a venue in Bellingen are both 2454 and both get the Bellingen
 * picture. At the scale this image works at, they are the same answer.
 *
 * Images are produced by `scripts/generate-venue-maps.mjs`, which fetches a
 * static map per postcode and stores it here. A file dropped in by hand works
 * exactly as well — this module cares about the filename, never the origin.
 *
 * ⚠ A KEY MUST NEVER APPEAR IN THIS FILE, and no provider may be called from
 * the client. An earlier version built provider URLs at render time, which put
 * an API key in the public bundle and made every page view a third-party
 * request. The generator holds the key; the app only ever reads an image out of
 * our own storage. That split is also what makes the maps free: the provider is
 * called once per postcode, not once per view.
 *
 * ── EXISTENCE IS THE RECORD ──────────────────────────────────────────
 * The path is derived from the postcode, so there is no column to keep in sync.
 * A postcode has a map when the file is there. Nothing probes storage — the
 * component reveals the image only once it has actually loaded, so a postcode
 * with no image renders nothing at all rather than a broken frame (R1, not R5).
 */

import { supabase } from './supabase';
import { VENUE_MAPS_BUCKET, venueMapPath, VENUE_MAP_VERSION } from './venueMapPath';

// The bucket name and filename rule live in venueMapPath.js — a dependency-free
// module the generator script can also import. Re-exported here so callers keep
// using this module as the one venue-map entry point.
export { VENUE_MAPS_BUCKET, venueMapPath, VENUE_MAP_VERSION };

/**
 * Public URL for a postcode's map image, or null when there is no postcode.
 * Returning a URL is NOT a promise that the file exists.
 *
 * ⚠ Carries `?v=VENUE_MAP_VERSION` — see the constant's own comment. Without
 * it, regenerating the stored image changes the file but not the URL, and a
 * browser that already cached that URL just keeps showing what it had.
 */
export function venueMapImageUrl(postcode) {
  const path = venueMapPath(postcode);
  if (!path) return null;
  const { data } = supabase.storage.from(VENUE_MAPS_BUCKET).getPublicUrl(path);
  return data?.publicUrl ? `${data.publicUrl}?v=${VENUE_MAP_VERSION}` : null;
}
