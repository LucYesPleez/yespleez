/**
 * WHERE SCENE IS — the public face of every event.
 *
 * ⭐ OWNER'S RULING, 2026-08-06: "A festival profile should behave exactly like
 * every other profile in Scene. When someone taps an event, it should open the
 * normal Scene event page, not switch applications. The public doesn't need to
 * know a Festival app exists."
 *
 * So the application link an organiser hands out points at SCENE, not here. The
 * Portal is the organiser's tool and has no public face at all.
 *
 * ⚠ THIS HAD TO BECOME A CONFIGURED HOST, and ApplicationLink's original comment
 * predicted the pain exactly: "a hardcoded host is wrong on localhost, wrong on
 * a preview deploy and wrong again in production, and it fails silently — the
 * link looks perfectly valid and lands nobody anywhere." That was solved by
 * reading `window.location`, which worked only while the page lived in this app.
 * It no longer does, so the risk is real again and the env var is the seam.
 *
 * ⚠ Set `VITE_SCENE_URL` per environment. The fallback is the canonical dev
 * port (Scene runs on 5174) so local work is correct out of the box, and a
 * deploy that forgets the variable produces a link to localhost — visibly wrong
 * to whoever tests it, rather than subtly wrong to an applicant.
 */
export const SCENE_URL =
  import.meta.env.VITE_SCENE_URL || 'http://localhost:5174';

/**
 * The public event page — where applications are made.
 *
 * Hash route, because Scene is a hash-router SPA. Scoped to an EVENT ID passed
 * in, never "the current event": a festival with three events has three links,
 * and handing out the wrong year's URL is the failure this guards.
 *
 * @param {string} eventId
 * @returns {string|null} null when there is no event to point at
 */
export function sceneEventUrl(eventId) {
  if (!eventId) return null;
  return `${SCENE_URL}/#/event/${eventId}`;
}
