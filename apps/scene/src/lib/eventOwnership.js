/**
 * MAY THIS ACCOUNT MANAGE THIS EVENT?
 *
 * ⚠⚠ THE DEFECT THIS EXISTS FOR. `EventScreen` gated the entire management UI
 * on `session?.user?.id === event.host_id`. Measured 2026-08-15: **82 of 92
 * events have a NULL `host_id`**, including 35 that carry a bill and a real
 * `owner_profile_id`, 22 of them owned by CLAIMED profiles across 3 accounts.
 *
 * So the owner of `Creatures of the Swamp` opened their own event and got the
 * punter's page. Not a permission error, not an empty state — the management
 * surface simply was not rendered, with nothing to say why.
 *
 * ⭐ This is the SAME defect L1 fixed in RLS, one layer up. Fixing only the
 * database would have left the writes legal and the buttons unreachable.
 *
 * ── ⛔ THIS IS A GATE ON RENDERING, NOT A PERMISSION ────────────────────────
 *
 * `can_act_as()` in the database is the only authority (identity v1.1 §A4), and
 * every policy re-checks it. A wrong answer here shows or hides a button; it
 * cannot grant anything, because the write behind the button is checked again
 * by RLS. ⛔ Do not let this become the basis of a security claim.
 *
 * ⚠ Kept apart from `lib/actingProfile` deliberately. That module is explicit
 * that it answers ATTRIBUTION and "never permission" — a different question
 * about a different subject, which by the consumer-identity rule is a sibling
 * module rather than another export bolted onto it.
 */

/**
 * @param event               an `events` row: { host_id, owner_profile_id }
 * @param userId              the signed-in account, or null
 * @param ownedProfileIds     profile ids this account owns (getOwnerProfiles)
 */
export function isEventManager(event, { userId, ownedProfileIds = [] } = {}) {
  if (!event || !userId) return false;

  /**
   * ⚠ `event.host_id &&` IS LOAD BEARING, not defensive noise. Without it, a
   * NULL `host_id` compared against a NULL `userId` is a match, and every
   * signed-out visitor becomes the manager of 82 events. The shipped
   * expression happened to escape this only because a signed-out `userId` is
   * `undefined` rather than `null` — ⛔ an accident, not a guard.
   */
  if (event.host_id && event.host_id === userId) return true;

  return !!event.owner_profile_id && ownedProfileIds.includes(event.owner_profile_id);
}

/**
 * Which events out of a list this account manages.
 *
 * ⭐ THE HOST DASHBOARD'S QUESTION, and it must be answered the SAME WAY as the
 * event page's or the two disagree about what you own — an event that offers no
 * management UI while still appearing in your LINEUP, or the reverse.
 */
export function manageableEvents(events = [], opts = {}) {
  return (events || []).filter(e => isEventManager(e, opts));
}
