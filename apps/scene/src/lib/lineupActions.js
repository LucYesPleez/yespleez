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
 * ── PLANNING, KEPT PURE SO IT CAN BE TESTED ─────────────────────────────────
 *
 * @returns {{ deletePerformanceIds: string[], softRemoveMemberId: ?string,
 *             notifyCount: number, kind: 'unassign'|'remove-from-bill' }}
 */
export function planUnassign(member, perfs = []) {
  return {
    kind: 'unassign',
    // Every performance goes: they hold no slot afterwards.
    deletePerformanceIds: (perfs || []).map(p => p.id).filter(Boolean),
    // ⛔ THE MEMBER ROW SURVIVES. This is the whole fix.
    softRemoveMemberId: null,
    notifyCount: isReachable(member) ? notifiablePerformances(perfs).length : 0,
  };
}

export function planRemoveFromBill(member, perfs = []) {
  return {
    kind: 'remove-from-bill',
    deletePerformanceIds: (perfs || []).map(p => p.id).filter(Boolean),
    // Soft, so it is reversible and the history survives.
    softRemoveMemberId: member?.id || null,
    notifyCount: isReachable(member) ? notifiablePerformances(perfs).length : 0,
  };
}

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

  if (plan.softRemoveMemberId) {
    const { error } = await db.from('lineup_members')
      .update({ status: 'removed', updated_at: new Date().toISOString() })
      .eq('id', plan.softRemoveMemberId);
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
