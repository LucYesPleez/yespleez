/**
 * THE OUTBOX STATE MACHINE — pure, kind-agnostic, and the part worth testing.
 *
 * One lifecycle for every message a user creates: a Voicey, a photo, a
 * document, a line of text. The machine reads only the envelope — never the
 * payload — so a new kind inherits queueing, retry and offline for free.
 *
 *   Creating ─▶ draft ─▶ queued ─▶ uploading ─▶ sent (removed)
 *                 │         ▲           │
 *                 │         └── retry ──failed
 *                 └─▶ deleted
 *
 * Kept out of the store and the components for the usual reason: the Node test
 * runner has no IndexedDB and renders nothing, so the transitions and the
 * retention rules — the decisions that must never quietly drop a message — live
 * where they can be exercised directly.
 */

export const DRAFT     = 'draft';
export const QUEUED    = 'queued';
export const UPLOADING = 'uploading';
export const FAILED    = 'failed';
/** Not a stored state — a sent entry is a removed entry. Named for the table. */
export const SENT      = 'sent';

export const STORED_STATES = Object.freeze([DRAFT, QUEUED, UPLOADING, FAILED]);

/** Abandoned-draft horizon: 30 days. Only drafts age out — see isAbandoned. */
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The next state for an event, or null if the event does not apply here.
 *
 * @param {string} state  current state
 * @param {'send'|'upload-start'|'upload-ok'|'upload-fail'|'retry'|'delete'} event
 * @returns {string|null}  next state, SENT for "remove me", or null for "ignore"
 *
 * ⚠ RETURNING null MEANS "DO NOTHING", NEVER "DROP IT". A message only ever
 * leaves the outbox through SENT (upload confirmed) or an explicit delete. Every
 * other unhandled combination is inert — the entry stays exactly where it is,
 * because the one thing the outbox may never do is lose a message on a
 * transition nobody thought about.
 */
export function decideTransition(state, event) {
  if (event === 'delete') return SENT === state ? null : 'deleted';

  switch (state) {
    case DRAFT:     return event === 'send'         ? QUEUED    : null;
    case QUEUED:    return event === 'upload-start'  ? UPLOADING : null;
    case UPLOADING:
      if (event === 'upload-ok')   return SENT;      // confirmed → remove
      if (event === 'upload-fail') return FAILED;
      return null;
    case FAILED:
      // Both a manual Retry and an automatic reconnect flush re-queue. They are
      // the same act — "try to send this again" — so they share a transition.
      return (event === 'retry' || event === 'send') ? QUEUED : null;
    default:        return null;
  }
}

/** True while an entry still needs the network — the flush loop's work list. */
export function needsUpload(state) {
  return state === QUEUED || state === FAILED;
}

/**
 * Is this a stale draft safe to prune?
 *
 * ⚠ ONLY DRAFTS AGE OUT. A `failed` entry is a message the user pressed Send on;
 * ageing it away would be discarding content they explicitly asked to deliver,
 * which rule 2 forbids. Queued and uploading are in-flight. So the 30-day broom
 * touches drafts alone, and only drafts the user has not returned to — measured
 * from `updatedAt`, which every auto-save refreshes, so an actively edited draft
 * is never a candidate however old the conversation is.
 */
export function isAbandoned(entry, now, ttl = DRAFT_TTL_MS) {
  if (!entry || entry.state !== DRAFT) return false;
  const at = Number(entry.updatedAt ?? entry.createdAt);
  if (!Number.isFinite(at)) return false;
  return now - at > ttl;
}
