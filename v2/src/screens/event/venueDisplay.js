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

/**
 * Split a venue's address into the two lines an address is written on
 * (owner, 2026-08-02):
 *
 *     12 Street Ave,
 *     Town, STATE, postcode
 *
 * ⚠ THE STORED `location` IS NOT CONSISTENT. Some rows hold a bare street
 * ("3/5 Church St"), others a full formatted address that already ends in the
 * town, state and postcode ("32 Hyde St, Bellingen, NSW, 2454"). Printing
 * either verbatim and appending the region gives one line or three, and one of
 * them says Bellingen twice.
 *
 * So the street line is whatever comes BEFORE the locality, and the region line
 * is rebuilt from the structured columns — which are the reliable ones.
 */
export function addressLines({ address = '', locality = '', state = '', postcode = '' } = {}) {
  const region = [locality, state, postcode].map(x => String(x || '').trim()).filter(Boolean).join(', ');

  let street = String(address || '').trim();
  if (street && locality) {
    // Cut at the locality wherever it appears, then tidy the trailing comma.
    const at = street.toLowerCase().indexOf(String(locality).toLowerCase());
    if (at > 0) street = street.slice(0, at);
  }
  street = street.replace(/[\s,]+$/, '').trim();

  // A "street" that is only the town again adds nothing — drop it and let the
  // region line stand alone rather than printing the same words twice.
  if (street && region && street.toLowerCase() === String(locality || '').toLowerCase()) street = '';

  return { street: street || null, region: region || null };
}

export function resolveVenue({
  name = null,
  address = null,
  locality = null,
  state = null,
  mapUrl = null,
  withheld = false,
} = {}) {
  const rawArea = [locality, state].filter(Boolean).join(' ') || null;

  // ⚠ DO NOT PRINT THE SUBURB TWICE.
  // A venue's stored `location` is frequently a full formatted address that
  // already ends in the suburb, state and postcode — Bellingen Memorial Hall's
  // is "32 Hyde St, Bellingen NSW 2454, Australia, Bellingen, NSW, 2454".
  // Rendering `area` beneath that produced a third "Bellingen NSW".
  //
  // The address line is the more specific of the two, so it wins and the area
  // line is dropped when it adds nothing. Compared loosely — punctuation and
  // case vary wildly across geocoded, imported and hand-typed records, and an
  // exact match would almost never fire.
  const loose = str => String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const areaIsRedundant = !!(address && rawArea
    && [locality, state].filter(Boolean).every(part => loose(address).includes(loose(part))));
  const area = areaIsRedundant ? null : rawArea;

  // R1 · withheld. Checked before coordinates are consulted, deliberately.
  // ⚠ Uses rawArea, not area: a withheld venue never renders its address, so
  // the de-duplication above would delete the only locality the reader gets.
  if (withheld) {
    return (name || rawArea) ? { mode: 'withheld', name, area: rawArea } : null;
  }

  if (!name && !rawArea && !address && !mapUrl) return null;

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
