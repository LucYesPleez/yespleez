/**
 * Fetch the display face, once per session.
 *
 * ⭐ IT LIVES IN `public/fonts/`, NOT IN THE BUNDLE. Two reasons, and both are
 * about the people who never print anything: 56 KB of base64 in a source file
 * would ship to every punter browsing What's On, and it would be an
 * unreviewable blob in the repo. As a real asset it is cached by the browser,
 * replaceable without a rebuild, and the licence sits beside it.
 *
 * ⚠ A FAILURE HERE IS NOT AN ERROR. `buildQrPdf` falls back to squeezed
 * Helvetica when handed nothing, so an offline export still produces a poster.
 * ⛔ Do not make this throw, and ⛔ do not block the download on it.
 */

const FONT_URL = '/fonts/BebasNeue-Regular.ttf';

let cached = null;

export async function loadDisplayFont() {
  if (cached !== null) return cached;
  try {
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error(`${res.status}`);
    cached = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    console.warn('[qr] display font unavailable, posters will use the fallback face', err);
    cached = false;
  }
  return cached;
}

/** Warm the cache so the first export does not wait on the network. */
export function preloadDisplayFont() {
  if (cached === null) loadDisplayFont();
}
