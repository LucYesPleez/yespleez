/**
 * OPTIMISTIC SENDS — the message exists in the thread before the server agrees.
 *
 * `receiptState.js` has always defined a `failed` rung and `EqReceipt` has
 * always drawn it. Nothing set it. A send that failed produced a banner above
 * the composer and left the thread looking exactly as it did before the user
 * pressed send — so the message did not fail visibly, it simply never appeared.
 * That is the failure mode this file exists to end: the thing you wrote stays
 * on screen, wearing the reason it did not arrive.
 *
 * ── WHY THE TRANSFORMS ARE PURE, AND HERE ────────────────────────────
 *
 * Every one of these is a `messages` list in and a `messages` list out. The
 * hard part of optimistic sending is not appending — it is the four-way race
 * between the insert resolving, realtime echoing the same row back, the user
 * retrying, and the user leaving. That race is decidable on a list; it is not
 * decidable inside a component that also owns scrolling and focus. Keeping it
 * here means it can be tested without rendering anything.
 *
 * ── PENDING IDS ARE PREFIXED, NOT JUST RANDOM ────────────────────────
 *
 * `PENDING_PREFIX` makes "is this a real row?" answerable from the id alone,
 * anywhere, without a parallel Set to keep in step. A random uuid would look
 * exactly like a server id to every consumer downstream — including the
 * realtime dedupe, which compares ids and would have no way to know it was
 * looking at something that had never been inserted.
 */

export const PENDING_PREFIX = 'pending:';

/** Is this a local message that no server row backs yet? */
export function isPending(message) {
  return typeof message?.id === 'string' && message.id.startsWith(PENDING_PREFIX);
}

/**
 * A message to show while the insert is in flight.
 *
 * `created_at` is stamped LOCALLY and deliberately. The bubble only renders its
 * timestamp-and-receipt row when `created_at` is present, so a pending message
 * without one would be the single message in the thread with no receipt — the
 * exact glyph the user needs to watch. It is replaced by the server's value the
 * moment the row lands, so the local clock is never what gets persisted or
 * compared; `receiptFor` reads `pendingState` first and never reaches the
 * watermark comparison while this is in flight.
 *
 * `retry` is DATA, not a closure. A stored function would capture the profile
 * id, the draft and the conversation as they were at first attempt, so a retry
 * after switching profiles would send as the wrong identity — quietly, and in a
 * product where attribution is the whole of §A3.
 */
export function makePending({ body, kind, fromProfileId, retry, payload, now = new Date().toISOString() } = {}) {
  return {
    id: `${PENDING_PREFIX}${crypto.randomUUID()}`,
    body,
    kind,
    from_profile_id: fromProfileId,
    created_at: now,
    pendingState: 'waiting',
    retry,
    // Spread so an absent payload stays ABSENT rather than becoming an empty
    // object. Renderers test `payload?.path` and friends; a `{}` answers those
    // identically to no key, but it also makes "does this kind carry a payload"
    // unanswerable for anything that asks the question directly.
    ...(payload !== undefined && { payload }),
  };
}

/**
 * Release a pending message's object url.
 *
 * An object url pins the entire recording in memory until it is revoked — a
 * three-minute Voicey is megabytes, and a conversation where several sends
 * failed and were retried would accumulate every one of them for the life of
 * the tab. Called when the placeholder is replaced or discarded, never while it
 * is still on screen: a failed Voicey the user has not dealt with yet must stay
 * playable, which is the point of keeping it at all.
 */
export function revokePendingUrl(message) {
  const url = message?.payload?.localUrl;
  if (url) URL.revokeObjectURL(url);
}

/** Put a pending message at the end of the thread. */
export function appendPending(list, pending) {
  return [...list, pending];
}

/**
 * The insert came back. Swap the placeholder for the real row.
 *
 * ⚠ THE FILTER REMOVES BOTH the placeholder AND any row already carrying the
 * server id. The sender receives their own insert over realtime, and there is
 * no ordering guarantee between that echo and the insert's own response — when
 * the echo wins, appending here would put the same message in the thread twice.
 * The existing realtime dedupe cannot prevent it: at the moment the echo
 * arrives the only thing in the list is a `pending:` id it has never seen.
 */
export function settlePending(list, pendingId, row) {
  return [...list.filter(m => m.id !== pendingId && m.id !== row.id), row];
}

/**
 * The insert failed. Keep the message, move it to the failed rung.
 *
 * The message is NOT removed. Removing it is what the old path effectively did,
 * and it is why a lost send was invisible: the user's own words disappearing is
 * indistinguishable from them having been delivered and scrolled past.
 */
export function failPending(list, pendingId, reason = null) {
  return list.map(m => (m.id === pendingId ? { ...m, pendingState: 'failed', failReason: reason } : m));
}

/** Take a placeholder out — a retry has replaced it, or the user discarded it. */
export function dropPending(list, pendingId) {
  return list.filter(m => m.id !== pendingId);
}
