import { isPlayableAudio } from './messageFiles';

/**
 * THE CONVERSATION INDEXES — Media, Files, Links, Search.
 *
 * ⚠ `W2` — INDEXES ARE VIEWS, NEVER STORES. Every function here is a pure
 * projection over messages that already exist in the thread. Nothing is
 * written, nothing is cached across calls, and an asset that exists once in a
 * message exists exactly once, full stop. Adding a table that mirrors any of
 * this would be a second source of truth and a violation of the ratified rule
 * this module implements.
 *
 * ⚠ WHY THIS WORKS WITHOUT PAGINATION: `listMessages` loads a conversation's
 * complete history with no `.limit()` (conversation-workspace-v1.0 §12.7), so
 * every message a thread has ever carried is already in the `messages` array
 * these functions are handed. If that ever changes, these indexes would
 * silently become partial — worth re-reading §12.7 before adding pagination.
 *
 * Kept entirely apart from React so each rule is a one-line test rather than a
 * render assertion.
 */

/**
 * Media = photos, audio, and Voiceys. `kind: 'file'` covers both attachments
 * and uploaded audio tracks, so an audio FILE is media and a document FILE is
 * not — decided with the exact predicate `FileMessage` itself uses, so a
 * message classified as "media" here is drawn as a player there, never as a
 * document row.
 */
export function isMediaMessage(m) {
  if (!m) return false;
  if (m.kind === 'image' || m.kind === 'voice') return true;
  if (m.kind === 'file') return isPlayableAudio(m.payload?.name, m.payload?.mime);
  return false;
}

/** Files = every attachment that is NOT media — the exact complement above. */
export function isFileMessage(m) {
  return m?.kind === 'file' && !isMediaMessage(m);
}

/**
 * Newest first — an index exists to find something quickly, and the thing
 * someone is most likely looking for is what they were just sent, not what
 * they were sent in March.
 */
function newestFirst(a, b) {
  return new Date(b.created_at) - new Date(a.created_at);
}

export function mediaEntries(messages) {
  return (messages ?? []).filter(isMediaMessage).sort(newestFirst);
}

export function fileEntries(messages) {
  return (messages ?? []).filter(isFileMessage).sort(newestFirst);
}

/**
 * ── LINKS ─────────────────────────────────────────────────────────────
 *
 * Derived by scanning message BODIES on read (conversation-workspace-v1.0
 * §12.9) — there is no `link` kind and no URL extraction at send time, so a
 * stored-at-send approach would only ever cover messages sent after it
 * shipped. Scanning on read is the only approach that covers a conversation's
 * entire existing history for free.
 *
 * ⚠ ONE ENTRY PER MESSAGE, NOT PER URL. A message containing three links is
 * still one thing that was said; showing it three times in the list would make
 * the count of "things shared" lie. `url` is the FIRST link found, used for
 * "Open Link" and for display — a message that shared several links is rare
 * enough that this is an acceptable simplification rather than a defect.
 */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

/** The first http(s) URL in a string, or null. Exported so it has its own test. */
export function firstUrl(text) {
  if (!text) return null;
  const match = String(text).match(URL_PATTERN);
  return match ? match[0].replace(/[.,;:!?]+$/, '') : null;   // trailing punctuation is prose, not the address
}

export function linkEntries(messages) {
  const out = [];
  for (const m of messages ?? []) {
    const url = firstUrl(m.body);
    if (url) out.push({ message: m, url });
  }
  return out.sort((a, b) => newestFirst(a.message, b.message));
}

/**
 * ── SEARCH ───────────────────────────────────────────────────────────
 *
 * "Standard conversation search" per conversation-workspace-v1.0 §7.3: text,
 * filenames, links. Case-insensitive substring — deliberately not a Postgres
 * full-text search, because there is no FTS index on `messages` yet
 * (§12 audit) and this scope is "search THIS conversation", which is already
 * fully loaded client-side. A server-side index is worth building the day
 * search needs to reach across conversations; today it would be infrastructure
 * with nothing yet asking for it.
 */
export function searchMessages(messages, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];

  return (messages ?? [])
    .filter(m => {
      const haystack = [m.body, m.payload?.name].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    })
    .sort(newestFirst);
}
