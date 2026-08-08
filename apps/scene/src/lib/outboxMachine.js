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

/* ── RETRY POLICY ────────────────────────────────────────────────────
 *
 * ⚠ THE BEHAVIOUR THIS REPLACES: every flush re-attempted every failed entry,
 * with no ceiling and no spacing. A message that could not be delivered was
 * retried on every send, every reconnect and every app open, forever — which on
 * a bad connection is a hot loop against the network, and left the user staring
 * at a bubble that would never resolve itself and never stop trying either.
 *
 * The delay before attempt N is `RETRY_DELAYS_MS[N]`, counting the very first
 * send as attempt 0 — hence the leading zero, which is the "Immediate" rung.
 * Once `attempts` reaches the end of the ladder the entry is EXHAUSTED: no
 * automatic attempt will ever be made again, and only the user pressing Retry
 * moves it. That is the whole point — a failure has to become final, or it is
 * not a failure, it is a loop.
 *
 * Exhaustion is COMPUTED from `attempts`, never stored as a state. A sixth
 * lifecycle state would have to be handled by every transition, every store
 * query and every renderer; a derived predicate cannot fall out of step with
 * the counter it reads.
 */
export const RETRY_DELAYS_MS = Object.freeze([
  0,        // Immediate — the original send
  5_000,
  15_000,
  30_000,
  60_000,
  300_000,  // 5 minutes, then no more
]);

/** Total automatic attempts before a failure becomes final. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

/** Attempts made so far, tolerating entries written before this field existed. */
export function attemptsOf(entry) {
  const n = Number(entry?.attempts ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Has this entry used up its automatic attempts? Exhausted entries are the ones
 * the UI labels "Couldn't send" and the flush loop steps over.
 */
export function isExhausted(entry) {
  return attemptsOf(entry) >= MAX_ATTEMPTS;
}

/**
 * When the next automatic attempt is allowed, given how many have been made.
 * Returns null once the ladder is spent — there is no next attempt, and callers
 * must not invent one by falling back to "now".
 */
export function nextAttemptAt(attempts, now) {
  const delay = RETRY_DELAYS_MS[attempts];
  return delay === undefined ? null : now + delay;
}

/**
 * May the flush loop attempt this entry right now?
 *
 * Queued means the user (or a fresh Send) just asked for it, so it goes without
 * waiting. Failed means we are inside the backoff ladder: it must still have
 * attempts left AND its wait must have elapsed.
 */
export function isDueForRetry(entry, now) {
  if (!entry) return false;
  if (entry.state === QUEUED) return true;
  if (entry.state !== FAILED) return false;
  if (isExhausted(entry)) return false;
  const due = Number(entry.nextAttemptAt ?? 0);
  return !Number.isFinite(due) || due <= now;
}

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
