/**
 * VENUE MAPS — the naming contract, and nothing else.
 * ---------------------------------------------------------------------------
 * Split out of venueMap.js so the generator script can import it: venueMap.js
 * pulls in the browser Supabase client, which Node cannot resolve. This module
 * MUST stay dependency-free so both the app and a plain `node` script can read
 * it — the bucket name and the filename rule are agreed in exactly one place,
 * never restated in the script.
 */

/** Public bucket: these are pictures of towns, and serving them signed would
 *  defeat the CDN caching that makes them free to show. */
export const VENUE_MAPS_BUCKET = 'venue-maps';

/** ⚠ THE FILENAME IS THE CONTRACT between whoever adds the image and the app
 *  that shows it. `2454.png`, `2450.png`. Nothing else is looked at. */
export function venueMapPath(postcode) {
  const pc = String(postcode || '').trim();
  return /^\d{4}$/.test(pc) ? `${pc}.png` : null;
}

/**
 * ⚠ BUMP THIS BY HAND EVERY TIME `generate-venue-maps.mjs` RUNS.
 * ---------------------------------------------------------------------------
 * A `?v=` cache-buster on the image URL, not a `cache-control` header. Every
 * browser that has ever loaded "2454.png" commits to a freshness lifetime the
 * moment it caches that response — lowering `cache-control` on a LATER upload
 * doesn't rewrite a TTL a browser already locked in, so a regenerate that
 * changed the picture (light → dark, 13 → zoom 11, whatever) kept silently
 * showing the old one until each visitor's hour ran out. See project memory
 * "venue-maps" for the incident this fixed (owner: "still zoomed way too
 * close" on a map that had already been regenerated three times).
 *
 * A version constant in code, not a DB column: the filename staying a pure
 * function of the postcode is the whole point of "existence is the record" —
 * this just extends the function to (postcode, version-at-build-time), still
 * no round trip, still nothing to keep in sync except this one number.
 */
export const VENUE_MAP_VERSION = 4;
