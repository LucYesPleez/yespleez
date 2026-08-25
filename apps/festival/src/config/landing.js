/**
 * WHERE THE LANDING PAGE LIVES — this app's own public URL.
 *
 * ⭐ A copied link outlives the machine it was copied on: it goes on posters
 * and the festival's website. So production reads a COMMITTED constant
 * (`VITE_PUBLIC_ORIGIN` in .env.production, same pattern as every other value
 * there) rather than `window.location`, which would bake a preview deploy's
 * hostname into whatever the organiser pasted it into.
 *
 * The dev fallback IS `window.location.origin`, deliberately: on localhost a
 * link to localhost is visibly wrong to whoever tests it, which is this
 * repo's preferred failure mode (see config/scene.js).
 */
export const PUBLIC_ORIGIN =
  import.meta.env.VITE_PUBLIC_ORIGIN || window.location.origin;

/**
 * The festival landing page for ONE event — the front door.
 *
 * Scoped to an EVENT ID, never "the current event": a festival with three
 * years has three landing pages, same rule as sceneEventUrl.
 *
 * @param {string} eventId
 * @returns {string|null} null when there is no event to point at
 */
export function landingUrl(eventId) {
  if (!eventId) return null;
  return `${PUBLIC_ORIGIN}/#/f/${eventId}`;
}
