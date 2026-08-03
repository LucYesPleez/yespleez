/**
 * NAVIGATION HAND-OFF — the map preview is a picture; this is the way out.
 * ---------------------------------------------------------------------------
 * Tapping a venue's map must launch the reader's OWN mapping app, not ours and
 * not a particular vendor's (owner, 2026-08-02). We render a static image and
 * then get out of the way.
 *
 * ── WHAT EACH PLATFORM ACTUALLY ALLOWS ───────────────────────────────
 *
 * ANDROID — a real chooser. The `geo:` scheme is a documented Android intent,
 * and every mapping app registers for it: Google Maps, Waze, OsmAnd, Organic
 * Maps, HERE. If the user has set a default, Android opens it silently; if not,
 * Android shows the app picker. That is exactly the requested behaviour and it
 * costs one URL.
 *
 * iOS — NO chooser exists, and this is Apple's limitation rather than a gap in
 * this code. iOS has never offered a default-maps setting (unlike browser and
 * mail), and it does not route `geo:` at all — using it there opens nothing,
 * which is worse than any fallback. So iOS gets an https maps.apple.com link,
 * which the OS hands to Apple Maps. Users who prefer Google Maps or Waze still
 * reach them from Apple Maps' own share sheet.
 *
 * ⚠ Do NOT "fix" iOS by sending `geo:` there. It fails silently — the single
 * worst outcome for a control whose entire job is to leave the app.
 *
 * EVERYTHING ELSE — desktop and unknown agents get the Google Maps web URL,
 * which opens in a browser, and opens the Google Maps app on a device that
 * claims that universal link.
 *
 * ── COORDINATES FIRST, ALWAYS ────────────────────────────────────────
 * Navigation targets the venue's coordinates, never its typed address: an
 * address string is re-geocoded by the receiving app and can land on the wrong
 * "Church St". The address is the fallback only when there are no coordinates
 * at all, because a rough destination beats a dead button.
 */

const ua = () => (typeof navigator !== 'undefined' && navigator.userAgent) || '';

export function isAndroid(agent = ua()) {
  return /android/i.test(agent);
}

const touch = () => (typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0;

/**
 * iPadOS 13+ reports itself as a Mac, so the touch check is not optional —
 * without it an iPad falls to the desktop branch, which is wrong on a device
 * people hold.
 *
 * `touchPoints` is a parameter rather than read straight from the global
 * because Node defines `navigator` as read-only, so a test cannot stub it.
 * An untestable branch on a device nobody develops on is how this stays broken.
 */
export function isIOS(agent = ua(), touchPoints = touch()) {
  if (/iphone|ipad|ipod/i.test(agent)) return true;
  return /macintosh/i.test(agent) && touchPoints > 1;
}

/**
 * The URL that hands navigation to the reader's mapping app.
 *
 * @param {{lat?:number, lng?:number, label?:string, address?:string, agent?:string}} target
 * @returns {string|null} null when there is nowhere to send them — the caller
 *          must render no control at all rather than a button that goes nowhere.
 */
export function navigationUrl({ lat, lng, label = '', address = '', agent = ua() } = {}) {
  const hasCoords = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  const query = hasCoords ? `${Number(lat)},${Number(lng)}` : String(address || '').trim();
  if (!query) return null;

  if (isAndroid(agent)) {
    // `geo:0,0?q=` is the documented form for "search for this", which is what
    // makes every mapping app offer to handle it. The parenthesised label is
    // what the pin is called once it opens.
    const pin = hasCoords && label ? `${query}(${label})` : query;
    return `geo:0,0?q=${encodeURIComponent(pin)}`;
  }

  if (isIOS(agent)) {
    // `daddr` starts directions rather than merely showing a point — the reader
    // tapped a map to go somewhere.
    return `https://maps.apple.com/?daddr=${encodeURIComponent(query)}`;
  }

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}
