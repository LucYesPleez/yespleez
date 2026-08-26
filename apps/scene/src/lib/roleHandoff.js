/**
 * WHAT OPENING AN `external` ROLE CARD DOES — the activation side of
 * roleVisibility's coin.
 *
 * ROLES is defined once and rendered by TWO surfaces — the /role-select picker
 * and IndustryPanel's switcher — so, exactly as with visibility, anything a
 * card DOES has to be decided once or the surfaces drift. It happened: the
 * external check lived only in RoleSelectorScreen's handlePick, and
 * IndustryPanel fed the FESTIVAL card's absolute URL to React Router's
 * navigate(), which under HashRouter treats it as a relative path segment.
 * No route matched, the content area rendered null, and the row read as a
 * click that does nothing.
 *
 * The law an `external: true` role carries: it is a different APP, not a mode
 * of this one. A new tab rather than a redirect, so a half-finished thing in
 * Scene is not thrown away by clicking a card that says "open" — and
 * `noopener,noreferrer` so the other app gets no handle back into this one.
 *
 * ⛔ This module is the ONE caller of window.open for role cards. A surface
 * that renders ROLES routes every pick through openExternalRole first;
 * roleHandoff.test.js holds both consumers to that.
 */

/**
 * Performs the hand-off for an external role: opens `role.path` in a new tab
 * and reports it handled. An internal role is untouched — the caller sends it
 * through its own router. Written so the internal answer never reaches for
 * `window`, which does not exist under the node test runner.
 *
 * @param {{external?: boolean, path?: string}|null|undefined} role
 * @returns {boolean} true if the role left the app here
 */
export function openExternalRole(role) {
  if (!role?.external) return false;
  window.open(role.path, '_blank', 'noopener,noreferrer');
  return true;
}
