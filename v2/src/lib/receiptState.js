/**
 * WHICH RUNG OF THE EQ LADDER A MESSAGE IS ON.
 *
 * Four states, three bars:
 *
 *   ▁▁▁   waiting   in flight, not yet acknowledged by the server
 *   ▃▁▁   sent      the row exists
 *   ▃▅▁   delivered RESERVED — see below, deliberately unreachable in v1
 *   ▃▅▇   seen      another participant's read watermark has passed it
 *   ▁▁▁   failed    the send threw; red, and retryable
 *
 * ── `delivered` IS NOW REAL (M10b) ───────────────────────────────────
 *
 * It was defined-but-unreachable for two releases, deliberately, because
 * nothing honest backed it: a row exists the instant it is sent, so lighting a
 * second bar then would have been decoration pretending to be information.
 *
 * It now means what it says. The RECIPIENT'S CLIENT acknowledges on actually
 * receiving a message, and that acknowledgement — nothing else — moves the
 * watermark. Storing the row does not. Queueing a push does not. A notification
 * being accepted does not. If the recipient's phone is off, the sender stays on
 * one bar, which is the truth.
 *
 * ── BOTH RUNGS ARE WATERMARK COMPARISONS, NOT FLAGS ──────────────────
 *
 * The server returns ONE timestamp per conversation — the latest moment any
 * other participant read it — rather than a per-message boolean. Every message
 * at or before that instant is seen. One round trip covers a whole thread, and
 * more importantly it cannot expose WHICH human read it, which is the whole
 * reason §2.5 refused receipts in the first place.
 */

export const RECEIPT = {
  WAITING:   'waiting',
  SENT:      'sent',
  DELIVERED: 'delivered',   // reserved — see header
  SEEN:      'seen',
  FAILED:    'failed',
};

/** How many of the three bars are lit for each state. */
export const LIT_BARS = {
  [RECEIPT.WAITING]:   0,
  [RECEIPT.SENT]:      1,
  [RECEIPT.DELIVERED]: 2,
  [RECEIPT.SEEN]:      3,
  [RECEIPT.FAILED]:    0,
};

/**
 * @param {object} p
 * @param {boolean} p.isMine        receipts belong to the sender alone
 * @param {string}  [p.createdAt]   the message's own timestamp
 * @param {string}  [p.pendingState] 'waiting' | 'failed' for un-acked sends
 * @param {string}  [p.seenWatermark] latest read moment among OTHER participants
 * @returns {string|null} a RECEIPT value, or null when no receipt should show
 */
export function receiptFor({ isMine, createdAt, pendingState, deliveredWatermark, seenWatermark } = {}) {
  // ⚠ RECEIPTS ARE FOR THE SENDER ONLY. Drawing one on a message you received
  // would be telling you whether YOU have read it, which you self-evidently
  // know — and on a shared profile it would quietly report your colleague's
  // reading back to you, which is the exposure §2.5 exists to prevent.
  if (!isMine) return null;

  // An un-acked send outranks everything: there is no server timestamp to
  // compare against yet, so nothing below can be evaluated honestly.
  if (pendingState === RECEIPT.FAILED)  return RECEIPT.FAILED;
  if (pendingState === RECEIPT.WAITING) return RECEIPT.WAITING;

  if (!createdAt) return RECEIPT.SENT;

  const sentAt = Date.parse(createdAt);
  if (!Number.isFinite(sentAt)) return RECEIPT.SENT;

  // `<=` not `<` on both: a watermark set in the same millisecond as the
  // message means the recipient was already there when it landed. Strict `<`
  // would strand that message a rung down forever, because nothing later moves
  // a watermark backwards onto it.
  if (passed(sentAt, seenWatermark))      return RECEIPT.SEEN;
  if (passed(sentAt, deliveredWatermark)) return RECEIPT.DELIVERED;
  return RECEIPT.SENT;
}

/**
 * Has `mark` reached `sentAt`?
 *
 * Anything unparseable is NO. A malformed timestamp claiming a rung would tell
 * the sender something untrue about another person — under-reporting is
 * recoverable, over-reporting is not.
 */
function passed(sentAt, mark) {
  if (!mark) return false;
  const at = Date.parse(mark);
  return Number.isFinite(at) && sentAt <= at;
}

/** Lit bars for a state, or 0 for anything unrecognised. */
export function litBars(state) {
  return LIT_BARS[state] ?? 0;
}
