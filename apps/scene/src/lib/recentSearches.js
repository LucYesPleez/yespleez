/**
 * ⭐ THE LAST FEW THINGS YOU SEARCHED FOR, ON THIS DEVICE.
 *
 * ⛔⛔ LOCAL, NEVER THE DATABASE. Discovery is anonymous — a guest browses
 * without an account — so a server-side history would either exclude the very
 * people using search most, or require an account to have one. It is also a
 * record of what someone was curious about, which is the kind of thing that
 * should stay on their own device unless it buys them something real.
 *
 * ⚠ `localStorage` THROWS, it does not merely return null. Private windows and
 * "block site data" make the accessor itself raise, so every read and write is
 * wrapped: a browser that refuses storage gets no history and a working search
 * box, never a crash.
 */

const KEY = 'yp_recent_searches';

/**
 * ⭐ FIVE (owner, 2026-09-01). ⛔ Not a scrolling list: this is a shortcut back
 * to something you just did, and a long history is a different feature.
 */
export const RECENT_LIMIT = 5;

/**
 * ⛔ TWO CHARACTERS MINIMUM. The search runs as you type, so every single
 * letter on the way to a word is technically a search — recording them fills
 * the list with "d", "dr", "dru" and buries the thing you actually looked for.
 */
const MIN_LENGTH = 2;

export function getRecentSearches() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    /* ⛔ A CORRUPT VALUE IS AN EMPTY HISTORY, not a crash. This key is
       user-writable and survives across releases, so it may hold anything. */
    if (!Array.isArray(list)) return [];
    return list.filter(t => typeof t === 'string' && t.trim()).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Record one search and return the new list.
 *
 * ⚠ DE-DUPLICATED CASE-INSENSITIVELY, but the ORIGINAL CASING IS KEPT — someone
 * who typed "Drum & Bass" should see it back the way they wrote it, and
 * searching it again should move it to the top rather than add a second row
 * that differs only in capitals.
 */
export function addRecentSearch(term) {
  const clean = String(term ?? '').trim().replace(/\s+/g, ' ');
  if (clean.length < MIN_LENGTH) return getRecentSearches();
  try {
    const existing = getRecentSearches().filter(t => t.toLowerCase() !== clean.toLowerCase());
    const next = [clean, ...existing].slice(0, RECENT_LIMIT);
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    /* ⛔ A refused write is not an error the searcher needs to hear about. */
    return getRecentSearches();
  }
}

/**
 * ⭐ EVERY HISTORY NEEDS A WAY OUT. A record of what someone searched, with no
 * control over it, is a thing done TO them — so the list that shows the history
 * also offers to forget it.
 */
export function clearRecentSearches() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* Nothing stored, nothing to clear. */
  }
  return [];
}
