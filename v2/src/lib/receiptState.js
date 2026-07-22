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
 * ── WHY `delivered` IS DEFINED BUT NEVER RETURNED ────────────────────
 *
 * Because there is nothing honest for it to mean yet. A message row exists the
 * instant it is sent, so "delivered" would be the same event as "sent" wearing
 * a second name — a bar that always lit at the same moment as the one before
 * it, which is a decoration pretending to be information.
 *
 * There IS a real distinction waiting to be built: M8e writes a notification
 * row per human who can act as the recipient profile, and for an UNCLAIMED
 * profile it writes a single HELD row addressed to nobody. So "delivered" can
 * one day mean "a real person was actually notified", and its absence can mean
 * "this went to a profile no one has claimed yet" — which matters enormously
 * for artist invites. It needs read access to the recipient's notification rows,
 * which does not exist. Named now so the ladder has a shape; not faked.
 *
 * ── SEEN IS A WATERMARK COMPARISON, NOT A FLAG ───────────────────────
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
export function receiptFor({ isMine, createdAt, pendingState, seenWatermark } = {}) {
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
  const seenAt = seenWatermark ? Date.parse(seenWatermark) : NaN;
  if (!Number.isFinite(sentAt) || !Number.isFinite(seenAt)) return RECEIPT.SENT;

  // `<=` not `<`: a watermark set in the same millisecond as the message means
  // the reader was already looking at the thread when it landed. Strict `<`
  // would leave that message stuck on `sent` forever, because nothing later
  // will move the watermark backwards onto it.
  return sentAt <= seenAt ? RECEIPT.SEEN : RECEIPT.SENT;
}

/** Lit bars for a state, or 0 for anything unrecognised. */
export function litBars(state) {
  return LIT_BARS[state] ?? 0;
}
