/**
 * UNSEND — withdrawing a message you already sent.
 *
 * The rules live in the DATABASE (migration U1): an UPDATE policy that admits
 * only the sender, only inside the window, only once; and a trigger that
 * ignores whatever the client sends and writes the redaction itself.
 *
 * ⚠⚠ EVERYTHING IN THIS FILE IS A COURTESY, NOT A CONTROL. It decides what to
 * OFFER. If it ever disagrees with the policy, the policy wins and the app is
 * the thing that is wrong. That is deliberate: the same reasoning as the
 * enquiry gate, one layer down — a client-side check is for showing people
 * sensible options, never for enforcement.
 */

/**
 * How long a sender has. ⚠ MIRRORS `interval '15 minutes'` in U1's policy.
 * Changing one without the other produces the worst possible failure: a
 * visible Unsend button that the server refuses.
 */
export const UNSEND_WINDOW_MS = 15 * 60 * 1000;

/** Already withdrawn? The tombstone is the presence of `deleted_at`. */
export function isUnsent(message) {
  return Boolean(message?.deleted_at);
}

/**
 * How long is left, in ms. 0 once the window has closed.
 *
 * ⚠ Clock skew is real: a phone minutes ahead of the server would show a
 * window that has already closed, and one behind would hide a button that
 * still works. Neither is harmful — the offer is wrong, not the outcome — but
 * it is why the server carries the rule.
 */
export function unsendMsRemaining(message, now = Date.now()) {
  if (!message?.created_at) return 0;
  const sent = new Date(message.created_at).getTime();
  if (Number.isNaN(sent)) return 0;
  return Math.max(0, sent + UNSEND_WINDOW_MS - now);
}

/**
 * May THIS viewer withdraw THIS message right now?
 *
 * ⭐ Identity is checked on the USER, matching the policy. A person with two
 * acts must be able to withdraw a message they sent as either — and a profile
 * check alone would refuse them the moment they switched acts, which is the
 * same bug the enquiry uniqueness work fixed one table over.
 */
export function canUnsend(message, viewerUserId, now = Date.now()) {
  if (!message || !viewerUserId) return false;
  if (isUnsent(message)) return false;
  // A message still in the outbox has never reached anyone, so there is
  // nothing to withdraw — it is deleted locally instead, which the failed-send
  // affordance already does.
  if (message.pending || message.failed) return false;
  if (message.from_user_id !== viewerUserId) return false;
  return unsendMsRemaining(message, now) > 0;
}

/** "13 min left" — for the menu, so the window is visible rather than a surprise. */
export function unsendRemainingLabel(message, now = Date.now()) {
  const ms = unsendMsRemaining(message, now);
  if (ms <= 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins >= 1) return `${mins} min left`;
  return `${Math.ceil(ms / 1000)}s left`;
}
