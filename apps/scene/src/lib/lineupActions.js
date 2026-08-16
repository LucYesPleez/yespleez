/**
 * TAKING SOMEBODY OFF A SET TIME, AND TAKING SOMEBODY OFF THE BILL.
 *
 * ⚠⚠ THESE WERE THE SAME OPERATION. Both buttons on the LINEUP tab ran
 * `delete performances where lineup_member_id` followed by
 * `delete lineup_members where id` — an identical, irreversible erasure. They
 * differed only in what they then wrote to `applications.status`
 * ('tentative' vs 'declined'), so the record that decided how destructive the
 * action was, was the one it did not act on.
 *
 * ⭐⭐ THE ORGANISER'S MODEL, which the code now matches:
 *
 *     APPLIED ──accept──▶ ON BILL ──give a slot──▶ AWAITING ──▶ CONFIRMED
 *                              ▲        │
 *                              └────────┘  removing a set time returns them
 *                                          to the Lineup, ⛔ NOT off the event
 *
 * `lineup_members` answers "are you on the bill", `performances` answers "when
 * do you play". Removing an answer to the second question must not delete the
 * answer to the first.
 *
 * ── ⚠⚠ `status = 'removed'` IS READ IN SIX PLACES AND WAS WRITTEN IN NONE ───
 *
 * `useEventData`, `HostDashboard`, `MySceneScreen` (×2), `ArtistDashboard` and
 * `ProfileScreen` all filter `.neq('status','removed')`. Nothing ever set it —
 * every removal was a hard DELETE. The soft state was designed, shipped and
 * left unreachable, which is why taking someone off a bill destroyed the record
 * that they had ever been on it.
 *
 * ⭐ Soft removal is what makes this reversible and keeps the history. The
 * performances still go, because a booking for a slot you are no longer on is
 * not a thing.
 */

/**
 * ⭐ NOTIFY ONLY WHAT WAS ACTUALLY SENT.
 *
 * Ratified 2026-08-15: adding someone to a bill is private and notifies nobody;
 * offering a SLOT is the actionable, notifying act. The mirror has to hold on
 * the way out — telling an artist "you have been removed from a slot at X" when
 * the slot was still a `draft` they were never told about announces a booking
 * and cancels it in the same message.
 *
 * ⛔ A `declined` performance is not notified either: they are the one who said
 * no, and being told they have been removed from the thing they turned down is
 * noise at best.
 */
export const SENT_STATUSES = ['offered', 'accepted'];

export function wasEverSent(perf) {
  return SENT_STATUSES.includes(perf?.status);
}

export function notifiablePerformances(perfs = []) {
  return (perfs || []).filter(wasEverSent);
}

/**
 * Can we address a notification to this member at all?
 *
 * A hand-entered act has no account. There is nobody to tell, and ⛔ nothing
 * should be written to a null recipient — see the identity rules on
 * `profiles.user_id` not being an identity.
 */
export function isReachable(member) {
  return !!member?.artist_id;
}

/**
 * ⛔⛔ THREE OPERATIONS DESTROY PERFORMANCES, AND THEY ARE NOT THE SAME THING.
 *
 *     CLEAR SET TIME      performances gone · stays ON BILL
 *     MOVE TO SHORTLIST   performances gone · back to SHORTLIST
 *     REMOVE FROM EVENT   performances gone · off the event
 *
 * ⚠⚠ Two of these were once literally one function and it caused real damage.
 * Every one of them goes through a planner here — ⛔ never an inline write at a
 * call site — so the difference between them stays a value in a plan rather
 * than a detail of whichever button was wired last.
 */

/**
 * ── PLANNING, KEPT PURE SO IT CAN BE TESTED ─────────────────────────────────
 *
 * @returns {{ deletePerformanceIds: string[],
 *             writeMemberStatus: ?{id: string, status: string},
 *             notifyCount: number,
 *             kind: 'unassign'|'move-to-shortlist'|'remove-from-event' }}
 *
 * ⚠ `writeMemberStatus` REPLACED `softRemoveMemberId` (2026-08-16). The old
 * name assumed the only status a plan could write was `removed`; the funnel now
 * has `shortlisted` too, and a field called "softRemove" carrying "shortlisted"
 * would be the kind of lie this module exists to prevent.
 */
export function planUnassign(member, perfs = []) {
  return {
    kind: 'unassign',
    // Every performance goes: they hold no slot afterwards.
    deletePerformanceIds: (perfs || []).map(p => p.id).filter(Boolean),
    // ⛔ THE MEMBER ROW IS UNTOUCHED. This is the whole fix.
    writeMemberStatus: null,
    notifyCount: isReachable(member) ? notifiablePerformances(perfs).length : 0,
  };
}

/**
 * ⭐⭐ BACK TO CONSIDERATION — the only exit from the LINEUP (ratified
 * 2026-08-16). `REMOVE FROM BILL` no longer exists on that tab; a lineup member
 * you have changed your mind about returns to SHORTLIST, and dropping them from
 * the event entirely is a separate, explicit act from there.
 *
 * ⛔ THE CALLER MUST REFUSE THIS WHERE THE ARTIST HAS ACCEPTED A SLOT. That is
 * a UI rule, not a data one — the card hides the control and shows a chip
 * saying to clear the set time first, so the host un-books the thing the artist
 * agreed to before un-booking the person. ⭐ Because of that, this plan can
 * never destroy an accepted performance, which is why it notifies nobody.
 */
export function planMoveToShortlist(member, perfs = []) {
  return {
    kind: 'move-to-shortlist',
    deletePerformanceIds: (perfs || []).map(p => p.id).filter(Boolean),
    writeMemberStatus: member?.id ? { id: member.id, status: 'shortlisted' } : null,
    notifyCount: isReachable(member) ? notifiablePerformances(perfs).length : 0,
  };
}

/**
 * Off the event entirely. ⚠ Offered from SHORTLIST, ⛔ not from the LINEUP —
 * see planMoveToShortlist.
 */
export function planRemoveFromEvent(member, perfs = []) {
  return {
    kind: 'remove-from-event',
    deletePerformanceIds: (perfs || []).map(p => p.id).filter(Boolean),
    // Soft, so it is reversible and the history survives.
    writeMemberStatus: member?.id ? { id: member.id, status: 'removed' } : null,
    notifyCount: isReachable(member) ? notifiablePerformances(perfs).length : 0,
  };
}

/** @deprecated Kept as the old name for `planRemoveFromEvent`. */
export const planRemoveFromBill = planRemoveFromEvent;

/**
 * ── EXECUTION ───────────────────────────────────────────────────────────────
 *
 * @param db        supabase client
 * @param plan      from planUnassign / planRemoveFromBill
 * @returns {Promise<{ok: boolean, error: ?string}>}
 */
export async function applyLineupPlan(db, plan) {
  if (!plan) return { ok: false, error: 'no plan' };

  if (plan.deletePerformanceIds.length) {
    const { error } = await db.from('performances').delete().in('id', plan.deletePerformanceIds);
    // ⚠ SURFACED, NEVER SWALLOWED. RLS filters a delete rather than erroring
    // it, so a failure here looks exactly like success — which is how 22 events
    // sat un-editable without anyone noticing.
    if (error) return { ok: false, error: error.message };
  }

  if (plan.writeMemberStatus?.id) {
    /* ⛔ THE STATUS COMES FROM THE PLAN, never from the function. Hardcoding
       'removed' here is what made "clear the set time" and "take them off the
       bill" indistinguishable at the point of execution. */
    const { error } = await db.from('lineup_members')
      .update({ status: plan.writeMemberStatus.status, updated_at: new Date().toISOString() })
      .eq('id', plan.writeMemberStatus.id);
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true, error: null };
}

/**
 * Put somebody back on the bill.
 *
 * ⭐ Possible only because removal is soft. ⛔ Their set times do NOT come back:
 * the performances were deleted, and inventing new ones would offer slots the
 * organiser has not chosen and the artist has not agreed to. They return where
 * everyone starts — on the bill, with no set time.
 */
export async function restoreToBill(db, memberId) {
  if (!memberId) return { ok: false, error: 'no member' };
  const { error } = await db.from('lineup_members')
    .update({ status: 'on_bill', updated_at: new Date().toISOString() })
    .eq('id', memberId);
  return { ok: !error, error: error?.message || null };
}

/**
 * ── ⛔ WHAT THIS MODULE DELIBERATELY DOES NOT DO ────────────────────────────
 *
 * It does not touch `applications.status`.
 *
 * Removing somebody from a bill is a decision about the BILL. The old code
 * reached across and wrote 'tentative' from one button and 'declined' from the
 * other, so which of two adjacent controls you pressed silently decided whether
 * a person had been shortlisted or rejected — and neither button said so.
 *
 * ⭐ Declining an applicant is its own act with its own control, on the surface
 * that is about applications: DROP on the SHORT LIST, DECLINE on the PIPELINE.
 * Those still exist and still write `applications.status`, which is the only
 * place it should be written from.
 *
 * ⚠ This is consistent with the ratified invariant — applications may FEED
 * membership, but membership does not reach back and rewrite them.
 */
