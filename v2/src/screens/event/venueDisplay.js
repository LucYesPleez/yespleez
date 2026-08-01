// § 7 · Venue — the section's render condition.
//
// Spec: docs/event-page-layout-spec.md § 7, Part 0 of the redesign doc.
//
//   map          → name + locality + map + directions
//   address      → name + address + directions   (no map)
//   locality     → name + locality
//   name         → name alone
//   withheld     → name/locality + the notice, and NEVER a map
//   null         → hide
//
// ⚠ THE TRAP THIS EXISTS TO PREVENT
// A secret-location event may well carry coordinates in its record — imported,
// geocoded, or entered before the organiser decided to withhold it. Deciding
// "has coords → show map" anywhere near the render would leak the location the
// organiser chose to hide. Withheld is therefore checked FIRST, before anything
// looks at coordinates at all.

export function resolveVenue({
  name = null,
  address = null,
  locality = null,
  state = null,
  mapUrl = null,
  withheld = false,
} = {}) {
  const area = [locality, state].filter(Boolean).join(' ') || null;

  // R1 · withheld. Checked before coordinates are consulted, deliberately.
  if (withheld) {
    return (name || area) ? { mode: 'withheld', name, area } : null;
  }

  if (!name && !area && !address && !mapUrl) return null;

  // A map needs something to render, not merely coordinates to exist. Until a
  // tile source is chosen the caller passes no mapUrl and this rung is simply
  // never reached — the ladder falls to the address, which is the honest
  // outcome rather than an empty frame.
  if (mapUrl) return { mode: 'map', name, area, address, mapUrl };
  if (address) return { mode: 'address', name, area, address };
  if (area)    return { mode: 'locality', name, area };
  return { mode: 'name', name };
}

/**
 * Directions need somewhere to point. An address is better than a locality,
 * and a locality is better than nothing — but "nothing" must yield no button
 * rather than a button that opens a map of the wrong town.
 */
export function directionsQuery({ name, address, area }) {
  const parts = [address || name, area].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}
