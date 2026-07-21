/**
 * ONE VOICE NOTE PLAYS AT A TIME.
 *
 * Every Voicey owns its own `<audio>`, and nothing in the browser stops two of
 * them sounding at once — media elements do not compete for audio focus the way
 * native players do. Press play on a second note and you hear both, which is
 * never what anyone meant.
 *
 * ── WHY A MODULE SINGLETON AND NOT REACT STATE ───────────────────────
 *
 * This is genuinely global: there is one pair of ears, and the rule has to hold
 * across the drawer, the full page, and any two components that never share a
 * tree. A context would work only where it was mounted, and lifting it would put
 * playback in the app shell for the sake of one boolean.
 *
 * It holds the ELEMENT rather than an id, so pausing needs no lookup and cannot
 * be defeated by a stale reference to a component that has since unmounted.
 *
 * ── PAUSE, NEVER RESET ───────────────────────────────────────────────
 *
 * The interrupted note keeps its position. Someone who starts a second note has
 * not said they are finished with the first, and rewinding it to zero would
 * throw away where they were. It also means its own onPause fires normally, so
 * its UI returns to rest through the path it already has.
 */

let current = null;

/**
 * Claim playback for this element, pausing whatever held it.
 *
 * Call immediately BEFORE `play()`. Calling after would let both play for a
 * frame — brief, audible, and exactly the defect this exists to prevent.
 */
export function claimPlayback(el) {
  if (!el) return;
  if (current && current !== el) {
    // The previous element's own pause handler does the rest: its state
    // updates, its frame loop stops, its bars settle.
    try { current.pause(); } catch { /* already gone from the DOM */ }
  }
  current = el;
}

/**
 * Give up the claim, if this element still holds it.
 *
 * Guarded because pause and unmount can arrive in either order, and a late
 * release from an old element must not clear a claim a newer one has taken.
 */
export function releasePlayback(el) {
  if (current === el) current = null;
}

/** The element currently claiming playback, or null. Exported for tests. */
export function currentPlayback() {
  return current;
}
