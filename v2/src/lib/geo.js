import AU_POSTCODES from './postcodes';

/**
 * GEO — the one place a distance or a coordinate is worked out.
 *
 * Same "one implementation" discipline as analytics.js and sendMessage. Every
 * screen that filters by distance calls these; nothing computes its own
 * haversine and nothing indexes AU_POSTCODES directly.
 *
 * ── THE RESOLUTION CHAIN ─────────────────────────────────────────────
 *
 *   Town / suburb  →  SUBURB_MAP      (auLocations.js)
 *         ↓
 *   Postcode       →  AU_POSTCODES    (postcodes.js, 3,174 entries)
 *         ↓
 *   lat / lng      →  haversineKm()
 *
 * This module owns the bottom two steps. Name → postcode stays in
 * auLocations.js, because that table is also what the search box and the
 * analytics region normaliser resolve against.
 *
 * ── EVERYTHING IS A POSTCODE CENTROID UNLESS TOLD OTHERWISE ──────────
 *
 * AU_POSTCODES gives ONE point per postcode, so two venues in the same
 * postcode are zero km apart. That is fine for the radii this app offers
 * (5km and up) and meaningless below them — which is why radius 0 must mean
 * "same postcode", not "within 0 km". See sameArea().
 *
 * Extracted from MySceneScreen, which held the only working implementation.
 */

/** Radii the UI offers, smallest first. 0 is "same postcode" — see sameArea(). */
export const RADIUS_STEPS = [0, 5, 10, 20, 50, 100, 250, 500];

/**
 * States whose postcodes AU_POSTCODES cannot answer for.
 *
 * ⚠ THIS GUARD IS LOAD-BEARING, NOT DEFENSIVE TIDINESS. `SUBURB_MAP` includes
 * New Zealand towns mapped to NZ postcodes, and 21 of those codes are ALSO
 * real Australian postcodes. Without this check, looking up a NZ location in
 * AU_POSTCODES returns an Australian point with total confidence:
 *
 *   Wellington   6011 → Perth WA          (-31.9964, 115.7576)
 *   Christchurch 8011 → Melbourne VIC     (-37.8113, 144.9617)
 *   Hamilton     3204 → Bentleigh VIC     (-37.9170, 145.0368)
 *
 * A filter that silently relocates someone 5,000 km is worse than a filter
 * that admits it does not know, because nothing about the result looks wrong.
 * `STATE_OPTIONS` offers NZ and International deliberately, so this is
 * reachable by design rather than by mistake.
 */
const UNSUPPORTED_STATES = new Set(['NZ', 'INTERNATIONAL']);

function isUnsupported(state) {
  return !!state && UNSUPPORTED_STATES.has(String(state).trim().toUpperCase());
}

/** True when this postcode is one AU_POSTCODES can actually place. */
export function isKnownPostcode(pc, state) {
  if (isUnsupported(state)) return false;
  return !!AU_POSTCODES[String(pc ?? '').trim()];
}

/**
 * Great-circle distance in kilometres.
 *
 * Haversine rather than a flat-earth approximation: Australia spans ~40° of
 * longitude, where the cheap formula drifts by tens of kilometres — enough to
 * put a result on the wrong side of a 50km filter.
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** A postcode's centroid, or null when it cannot be placed. */
export function postcodeCoords(pc, state) {
  if (!pc || isUnsupported(state)) return null;
  const c = AU_POSTCODES[String(pc).trim()];
  return c ? { lat: c[0], lng: c[1] } : null;
}

/**
 * Where a profile is, preferring precision.
 *
 * Stored lat/lng wins when present (6 of 53 profiles have it); otherwise the
 * postcode centroid (21 of 53). Returning null rather than a guess is the
 * point — a profile with no location must be excluded from a radius filter
 * VISIBLY, not placed somewhere plausible.
 */
export function profileCoords(p) {
  if (!p) return null;
  if (p.lat && p.lng) return { lat: p.lat, lng: p.lng };
  return postcodeCoords(p.postcode, p.state);
}

/**
 * WHERE AN EVENT IS — and the precedence that keeps one source of truth.
 *
 *   1. venue profile, when the event is linked to one
 *   2. the event's OWN location, for venue-independent events
 *   3. null
 *
 * ⚠ THE ORDER IS THE GUARANTEE. A linked event's own columns are never read,
 * so they cannot drift out of step with the venue; a venue correcting its
 * postcode corrects every one of its events at once. Step 2 is NOT
 * duplication — it is the only place a bush doof, a warehouse party, a
 * showground or a multi-venue festival can record where it is. Requiring a
 * venue PROFILE for those would either fill the directory with unclaimable
 * profiles for paddocks, or make the underground scene invisible to the
 * discovery features built for it.
 *
 * See docs/location-architecture-2026-07.md §4.
 *
 * @param {object} event         needs postcode/lat/lng and venue_profile_id
 * @param {object} [venue]       the resolved venue profile, when linked
 */
export function eventCoords(event, venue) {
  if (!event) return null;
  if (event.venue_profile_id && venue) return profileCoords(venue);
  if (event.lat && event.lng) return { lat: event.lat, lng: event.lng };
  return postcodeCoords(event.postcode, event.state);
}

/**
 * Two records in the same postcode.
 *
 * What radius 0 means, and why it is not "within 0 km": everything here is a
 * postcode centroid, so a true 0km test would match only records that happen
 * to share the exact same centroid — i.e. it would behave like this anyway,
 * but by accident and with floating-point noise. Saying so explicitly makes
 * the smallest radius step honest.
 */
export function sameArea(pcA, pcB) {
  if (!pcA || !pcB) return false;
  return String(pcA).trim() === String(pcB).trim();
}

/**
 * Is `target` within `radiusKm` of `origin`?
 *
 * Returns FALSE for anything that cannot be placed, deliberately — but the
 * caller must then surface those separately rather than dropping them.
 * Coverage is thin (only 21 of 53 profiles carry a postcode), so a filter
 * that silently discards the unplaceable would hide most of the catalogue and
 * look like an empty scene rather than a missing field.
 *
 * @param {number|null} radiusKm null = no radius filter; 0 = same postcode
 */
export function withinRadius(origin, target, radiusKm, originPostcode, targetPostcode) {
  if (radiusKm === null || radiusKm === undefined) return true;
  if (radiusKm === 0) return sameArea(originPostcode, targetPostcode);
  if (!origin || !target) return false;
  return haversineKm(origin.lat, origin.lng, target.lat, target.lng) <= radiusKm;
}
