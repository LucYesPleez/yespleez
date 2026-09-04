/* ⭐ THE BOOKING GATE lives with the booking rules, ⛔ not here — `canPlaceMember`
   answers through `isBooked`, so the contract decides. ⚠ `hostLineup` imports
   only `eventProvenance` and `eventSlots`, both leaves, so this adds no cycle to
   a file that was otherwise dependency-free. */
import { canPlaceMember } from './hostLineup';
/* ⭐ P6.3c-2 · the removal notice now RECORDS what it sent. ⛔ Only the pure patch
   builder and the kind constant are used; the derivation stays where it is. */
import { notifiedPatch, SLOT_REMOVED } from './notifyPlan';

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
 * ── ⭐⭐ THE ONE EXECUTOR ────────────────────────────────────────────────────
 *
 * `applyLineupPlan` writes; this decides who gets TOLD and says the right thing.
 * It lived inside `EventHostView` as `runLineupAction`, which meant the rule for
 * "does this removal notify" was reachable from exactly one screen. The
 * dashboard therefore shipped with ⛔ no REMOVE at all rather than a second
 * copy — an honest choice, but it left the two surfaces unequal.
 *
 * ⭐⭐ A SCREEN CANNOT IMPLEMENT REMOVE DIFFERENTLY, because this is the only
 * thing that implements it. That is a mechanism, ⛔ not a convention that two
 * files must agree — §11's rule was written down, then broken by its own author
 * within hours, because documents do not enforce.
 *
 * ⛔⛔ ELIGIBILITY READS THE RAW ROW. `perfs` are `performances` rows straight
 * from the database, now reachable as `claim.performance`. ⛔ Never pass the
 * translated `claim.status`: it reports a hand-entered act as `confirmed` when
 * the row says `offered`, and this function would then announce the withdrawal
 * of an offer that was never made, to somebody with no account to receive it.
 *
 * @param db     supabase client
 * @param plan   from planUnassign / planMoveToShortlist / planRemoveFromEvent
 * @param opts.member  the `lineup_members` row (⛔ raw, for `artist_id`)
 * @param opts.perfs   the RAW performance rows this plan destroys
 * @param opts.event   `{ id, name, owner_profile_id }`
 * @param opts.notify  injected notification writer, for tests
 * @param opts.resolveProfileId  injected `userId → { profileId }`, for tests
 * @returns {Promise<{ok: boolean, error: ?string, notified: boolean}>}
 */
/**
 * ── ⭐⭐ P6.3c-2 · SHOULD TAKING THIS SET TIME AWAY BE ANNOUNCED? ─────────────
 *
 * ⛔⛔ `performances.status` IS NO LONGER THE AUTHORITATIVE EVIDENCE. The whole
 * purpose of P6 was to stop deriving communication history from booking status,
 * and `unlockSetTimes` proves why: it reverts `offered → draft` event-wide, so a
 * status-only gate goes SILENT about a removal the artist was genuinely told
 * about.
 *
 * ⭐ THE CLEAN RULE, which this becomes once no ambiguous rows remain:
 *
 *     notified_at exists AND the placement is being removed → send
 *
 * ⚠⚠ THE MIGRATION EXCEPTION, ratified as an exception and ⛔ NOT as a rule
 * (owner, 2026-08-18). Five legacy placements are `offered`/`accepted` with NO
 * record, and the old model probably did tell those artists. So:
 *
 *     notified_at set                        → send   (we KNOW we told them)
 *     no record + offered/accepted           → send   (we do NOT know, and a
 *                                                      removal notice is the
 *                                                      SAFE error)
 *     no record + draft                      → silent (we KNOW we never did)
 *
 * ⛔⛔ THE MIDDLE BRANCH IS NOT "STATUS IS EVIDENCE AGAIN". It is "when we cannot
 * establish whether they were told, telling them twice is recoverable and leaving
 * them believing they are playing is not". ⛔ NOT_RECORDED is still converted
 * neither to "was told" nor to "wasn't told".
 *
 * ⭐ IT SELF-RETIRES: any row that ever gets a recorded send leaves the ambiguous
 * branch for good, so the exception disappears with no migration.
 */
export function removalNeedsNotice(member, acting = []) {
  /* ⛔ Nobody to tell. Same rule every notification path applies. */
  if (!isReachable(member)) return false;
  /* ⛔ Nothing was placed, so there is no set time to take away. */
  if (!(acting || []).some(p => p?.slot_uuid)) return false;
  if (member?.notified_at) return true;
  return notifiablePerformances(acting).length > 0;
}

export async function executeLineupPlan(db, plan, opts = {}) {
  const { member, perfs = [], event, notify, resolveProfileId } = opts;
  if (!plan) return { ok: false, error: 'no plan', notified: false };

  /**
   * ⚠ WHAT THIS PLAN IS REMOVING, ⛔ not everything the member holds. An act
   * playing two slots keeps the other one, so clearing one must not announce
   * the loss of the second. The caller scopes `perfs` for that reason.
   */
  const acting = (perfs || []).filter(p => plan.deletePerformanceIds.includes(p.id));

  const { ok, error } = await applyLineupPlan(db, plan);
  // ⚠ SURFACED, NEVER SWALLOWED — RLS filters a write rather than erroring it.
  if (!ok) return { ok: false, error: error || 'That change was not saved.', notified: false };

  if (!removalNeedsNotice(member, acting)) return { ok: true, error: null, notified: false };

  const { profileId } = resolveProfileId ? await resolveProfileId(member.artist_id) : { profileId: null };
  /**
   * ⛔⛔ THE RESULT IS INSPECTED. This used to be a bare `await notify?.(...)`
   * with the return value discarded, so a removal notice that never left reported
   * `notified: true`. ⛔ Nothing may be RECORDED on the strength of a send that
   * failed — that is the whole ordering invariant of P6.3.
   */
  const sendError = await notify?.({
    toUserId:       member.artist_id,
    toProfileId:    profileId ?? null,
    aboutProfileId: event?.owner_profile_id ?? null,
    type:    SLOT_REMOVED,
    message: messageFor(plan.kind, event?.name),
    data:    { event_id: event?.id, event_name: event?.name },
  });
  if (sendError) {
    return { ok: true, error: null, notified: false, notifyError: sendError.message || String(sendError) };
  }

  /**
   * ── ⭐⭐ P6.3c-2 · RECORD WHAT WAS ACTUALLY SENT ────────────────────────────
   *
   * ⚠ THE TIMESTAMP COMES FROM AFTER THE SUCCESSFUL SEND (owner), ⛔ never from
   * the planner: `notifiedPatch` stamps it here, at the moment we know a message
   * went, exactly as the offer path does.
   *
   * ⭐ THE SLOT WE RECORD is what we last TOLD them about if we know it, falling
   * back to the placement this plan destroyed. ⛔ Not the current placement:
   * there is not one, which is the point.
   *
   * ⚠⚠ THE RECORD SURVIVES AN UNBOOKING, DELIBERATELY (owner). After
   * move-to-shortlist or remove-from-event the member is no longer booked, so
   * `notifyPlan` reads NOTHING_TO_SAY and this row becomes HISTORY rather than
   * work — it answers "what was the last scheduling thing we sent them". ⛔ It is
   * not cleared, and ⛔ booking state still takes precedence in the derivation.
   */
  const toldAbout = member?.notified_slot_uuid
    || acting.find(p => p?.slot_uuid)?.slot_uuid
    || null;
  const { error: recErr } = await db.from('lineup_members')
    .update(notifiedPatch(toldAbout, undefined, SLOT_REMOVED))
    .eq('id', member.id);

  /* ⚠⚠ SENT BUT NOT RECORDED, and it must be said. The artist HAS been told, so
     ⛔ this is not a failure of the removal — but the record now disagrees with
     reality and the row will keep asking to be told. */
  return recErr
    ? { ok: true, error: null, notified: true, recordError: recErr.message }
    : { ok: true, error: null, notified: true, recorded: true };
}

/**
 * ⛔⛔ THIS WAS BROKEN AND SILENT. The screen tested `plan.kind ===
 * 'remove-from-bill'`, and ⛔ no planner has ever produced that value — the
 * kinds are `unassign`, `move-to-shortlist` and `remove-from-event`. So the
 * branch was unreachable and EVERY removal said "you are still on the lineup",
 * including the ones that took somebody off it.
 *
 * ⚠ It has not yet misinformed anybody: the only `remove-from-event` call site
 * passes no performances, so `sent` is empty and nothing is sent. ⭐ That is
 * luck, ⛔ not a design — the moment that call site passes the rows it destroys,
 * it would have told the artist they were still booked.
 *
 * ⭐ A default that ASSUMES the gentler message is how that survived. An
 * unknown kind now refuses to guess.
 */
export function messageFor(kind, eventName) {
  const at = eventName || 'the event';
  switch (kind) {
    case 'unassign':
      return `Your set time at ${at} has been removed. You are still on the lineup.`;
    case 'move-to-shortlist':
    case 'remove-from-event':
      return `You are no longer on the lineup for ${at}.`;
    default:
      // ⛔ Say the true, small thing rather than the confident, possibly wrong one.
      return `Your booking at ${at} has changed.`;
  }
}

/**
 * ── ⛔⛔ PUTTING SOMEBODY ON A SLOT — THE ONE WRITER ─────────────────────────
 *
 * ⚠⚠ THE BUG THIS EXISTS TO KILL: every insert site wrote
 * `slot_id: slot.id`, and `slot.id` has been the `event_slots` UUID since L2.
 * `slot_id` is the LEGACY TEXT key (`sat_1`, `d0s3`). The L3 trigger only
 * resolves `slot_uuid` where `event_slots.legacy_key = new.slot_id`, and a UUID
 * never equals `sat_1` — measured across all 19 readable slots, `legacy_key`
 * is never null and never equal to the id.
 *
 * ⛔ So the row landed with `slot_uuid = NULL`, and `indexPerformances` skips
 * exactly those rows. Filling a slot WROTE A PERFORMANCE NOBODY COULD SEE, and
 * the DELETE that was meant to replace the previous occupant matched nothing
 * either. `DaySlots` found this for the DRAG and fixed it there; the three
 * insert sites were never converted.
 *
 * ⭐⭐ WRITES `slot_uuid`, ⛔ NEVER `slot_id` — the same rule `DaySlots` states.
 * ⛔ Do not "restore" the legacy write: if a row's two columns disagree the
 * read follows `slot_uuid`, and the operation appears to have done nothing.
 *
 * ⚠ SCOPED TO THE EVENT AS WELL AS THE SLOT. Kept from the original even though
 * a UUID is unique on its own: it costs nothing and it is the predicate that is
 * true, rather than the one that happens to work.
 *
 * @param status 'draft' | 'offered' | 'accepted' — ⛔ FROM THE CALLER. Who is
 *   told, and when, is the difference between adding to the bill and offering a
 *   slot. Hardcoding it here is how the two became one operation before.
 * @returns {Promise<{ok, error, performance}>}
 */
export async function assignMemberToSlot(db, { slotId, eventId, memberId, status = 'draft' }) {
  if (!slotId || !eventId || !memberId) return { ok: false, error: 'missing slot, event or member', performance: null };

  /**
   * ── ⛔⛔ THE BOOKING GATE. SET TIMES SCHEDULES; IT DOES NOT BOOK ────────────
   *
   * ⚠⚠ CHECKED HERE, IN THE WRITER, AND ⛔ NOT AT THE BUTTON. Four callers reach
   * this function: the event page's ASSIGN SET TIME, the fill-slot sheet's three
   * paths, and the application route. `promoteMemberToBill` learned the same
   * lesson one level up and its comment states it: a rule enforced on one of two
   * doors is not enforced. BVP got a set time while `shortlisted` because every
   * door trusted its caller and this function trusted `memberId`.
   *
   * ⚠ IT READS THE DATABASE rather than taking facts as arguments, for exactly
   * the reason `billHasRoom` does: a caller that can forget to pass the member's
   * status is a caller that can bypass the rule. ⛔ Three cheap reads on a write
   * path is the correct trade against an invalid booking.
   *
   * ⚠ `maybeSingle` on both: a missing member or an unreadable event must REFUSE
   * rather than throw. RLS can hide either, and a hidden row is not permission.
   */
  const [{ data: member }, { data: perfs }, { data: event }] = await Promise.all([
    db.from('lineup_members').select('id, status, artist_id, artist_profile_id').eq('id', memberId).maybeSingle(),
    db.from('performances').select('id, status, slot_uuid').eq('lineup_member_id', memberId),
    db.from('events').select('id, booking_model').eq('id', eventId).maybeSingle(),
  ]);

  const gate = canPlaceMember(member, perfs || [], event);
  if (!gate.ok) return { ok: false, error: gate.reason, refused: gate.code, performance: null };

  /**
   * ── ⛔⛔ P6.2.1 · A RESCHEDULE MAY NOT DESTROY A BOOKING ─────────────────────
   *
   * ⚠⚠ THIS FUNCTION USED TO `delete … where slot_uuid = destination` AND THEN
   * INSERT. Three things died with that row:
   *
   *   `accepted_at`  the ARTIST's own act. A host moving a set time is ⛔ not
   *                  permission to erase the fact that somebody agreed to play.
   *   `status`       an `accepted` row came back as whatever the caller passed,
   *                  so an agreement was silently downgraded to `draft`.
   *   `id`           ⛔⛔ REFERENCED FROM OUTSIDE THE TABLE. `publishSetTimes`
   *                  writes `notifications.data.performance_id`, and the accept
   *                  and decline handlers key on it. Deleting the row orphans an
   *                  outstanding offer: the artist taps ACCEPT and the update
   *                  matches nothing, silently.
   *
   * ⭐⭐ SO THE ROW IS UPDATED IN PLACE, and the incumbent is LEFT ALONE (owner,
   * 2026-08-17). L3 constrains `(slot, member)` rather than the slot alone
   * precisely because two acts on one slot is real — B2B, and three such slots
   * exist in production. Removing the previous occupant is its own decision with
   * its own named control (`planUnassign`), ⛔ never a side effect of placing
   * somebody else.
   *
   * ⭐ THE TARGET, IN ORDER. ⛔ Not an upsert on `(event, member)`: a member may
   * legitimately hold several slots, so that key would collapse two placements
   * into one.
   */
  /**
   * ⚠⚠ INTERIM, RATIFIED AS SUCH (owner, 2026-08-17). Assigning a member who
   * ALREADY holds a different slot ADDS a second placement; it does ⛔ not move
   * them. That is honest to the schema — L3 permits it and a festival act playing
   * twice is real — and ⛔ no data is ever lost.
   *
   * ⛔⛔ BUT IT CAN SILENTLY DOUBLE-BOOK A HOST WHO MEANT "MOVE". The ratified
   * destination is an EXPLICIT CHOICE at the point of action: when the member
   * already holds a slot, the sheet asks "move them here" or "add a second set".
   * ⛔ Do NOT close this gap by guessing from how many slots they hold — an
   * invisible rule that is usually right is the shape this codebase keeps being
   * bitten by. ⭐ Until that UI exists, adding is the safe half of the ambiguity.
   *
   * ⚠ A true MOVE already exists and is lossless: `persistReorder` (drag) does
   * `update slot_uuid` on the row itself.
   */
  const mine = (perfs || []).filter(p => p?.id);
  const onDestination = mine.find(p => p.slot_uuid === slotId);
  /* ⚠ THE EVENT-LEVEL OFFER (P4) IS THE THING TO PLACE. A row with no slot is an
     artist who accepted a place at the event; giving them a time must reuse it,
     or their acceptance is stranded on a row nobody reads. */
  const unplaced = mine.find(p => !p.slot_uuid);
  const target   = onDestination || unplaced;

  if (target) {
    /**
     * ⛔⛔ `status` IS INSERT-ONLY (owner, 2026-08-17). It records what the
     * ARTIST has agreed to, so a placement may never rewrite it: that is exactly
     * how an `accepted` set time became a `draft` again. Moving somebody changes
     * WHERE they play, ⛔ not WHETHER they said yes. A genuine status transition
     * is a separate, named act.
     *
     * ⚠ `updated_at` is set by hand because ⛔ NO TRIGGER EXISTS on this table.
     */
    if (onDestination) {
      /* ⭐ ALREADY THERE. ⛔ No write at all: re-pressing must not restamp a row
         or the audit trail records edits that never happened. */
      return { ok: true, error: null, performance: target, unchanged: true };
    }
    const { data, error } = await db.from('performances')
      .update({ slot_uuid: slotId, updated_at: new Date().toISOString() })
      .eq('id', target.id)
      .select('id, status, slot_uuid, lineup_member_id, event_id, accepted_at').single();
    /* ⚠⚠ AN UPDATE RLS FILTERED RETURNS NO ERROR AND NO ROW. ⛔ A missing row is
       therefore a FAILURE, not a success: a set time that did not save must not
       look like one that did. */
    if (error) return { ok: false, error: error.message, performance: null };
    if (!data)  return { ok: false, error: 'The set time was not saved. You may not have permission to change this event.', performance: null };
    return { ok: true, error: null, performance: data };
  }

  const { data, error } = await db.from('performances').insert({
    lineup_member_id: memberId, event_id: eventId, slot_uuid: slotId, status,
  }).select('id, status, slot_uuid, lineup_member_id, event_id').single();

  /* ⚠ SURFACED, NOT SWALLOWED — an INSERT blocked by RLS fails loudly (42501)
     while an UPDATE fails silently, and a set time that did not save must not
     look like one that did. */
  if (error) return { ok: false, error: error.message, performance: null };
  return { ok: true, error: null, performance: data };
}

/**
 * Put somebody back on the bill.
 *
 * ⭐ Possible only because removal is soft. ⛔ Their set times do NOT come back:
 * the performances were deleted, and inventing new ones would offer slots the
 * organiser has not chosen and the artist has not agreed to. They return where
 * everyone starts — on the bill, with no set time.
 *
 * ⚠⚠ THE ONLY ROUTE ONTO A BILL THAT DOES NOT RESOLVE OPEN REQUESTS, because it
 * is the only one with NO CALLERS — nothing in the app invokes it, so it cannot
 * currently put anybody anywhere. The other four go through
 * `lib/answerOpenRequests` (see `EventHostView` and `FillSlotModal`).
 *
 * ⛔ IF YOU GIVE THIS FUNCTION A CALLER, WIRE IT TOO. It takes only a
 * `memberId`, so it will need the event and the member's `artist_profile_id`
 * threading in; a bill route that silently skips the answer is exactly the gap
 * that left Cosmatik on a lineup and in the pipeline at the same time.
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

/**
 * ── ⭐⭐ P4 · OFFERING SOMEBODY A PLACE AT THE EVENT ─────────────────────────
 *
 * ⛔⛔ THIS IS NOT A SET-TIME OFFER. The host is saying "we would like you to
 * play at this event", ⛔ NOT "we would like you to play at 9pm". The running
 * order is a later, private layer and may not exist yet.
 *
 * ⭐ A `performances` row with `slot_uuid = NULL` IS that offer. §2 already
 * defines this table as the "slot, OFFER and ACCEPTANCE lifecycle", so a
 * null-slot row reads as *a place at the event, no time yet* — and it inherits
 * acceptance (`lib/notifActions`, unchanged) and, later, communication.
 *
 * ⛔⛔ IT SENDS NOTHING. Creating an offer is PLANNING. The artist hears about
 * it only through NOTIFY ARTISTS (P7), which is the single communication
 * boundary. ⛔ Do not add a notification here — that is the leak this whole
 * model exists to close.
 *
 * ⚠ `status: 'draft'` on purpose: in today's vocabulary that means CREATED BUT
 * NOT SENT, which is exactly what an unnotified offer is. ⛔ Not 'offered' —
 * that word claims the artist has been asked.
 */
export function planEventOffer(member, perfs = []) {
  if (!member?.id) return { ok: false, reason: 'no member' };

  /**
   * ⛔ IDEMPOTENT. The button can be double-tapped and two surfaces can offer
   * the same person. ⚠ A second null-slot row would be a second live offer for
   * one place — the partial unique index catches it in the database, and this
   * catches it before the round trip.
   */
  const existing = (perfs || []).find(p => !p?.slot_uuid);
  if (existing) return { ok: false, reason: 'they have already been offered a place', existing };

  /* ⚠ Already holding a SLOT means already past this step. ⛔ Offering a place
     to somebody who is scheduled would be a second, contradictory offer. */
  if ((perfs || []).some(p => p?.slot_uuid)) {
    return { ok: false, reason: 'they already have a set time' };
  }

  return { ok: true, reason: null, memberId: member.id };
}

/**
 * @returns {Promise<{ok, error, performance}>}
 * ⛔ Writes ONE row. ⛔ Deletes nothing — this is not `assignMemberToSlot`,
 * which replaces a slot's occupant. Nobody is displaced by an offer.
 */
export async function createEventOffer(db, { eventId, memberId }) {
  if (!eventId || !memberId) return { ok: false, error: 'missing event or member', performance: null };

  const { data, error } = await db.from('performances').insert({
    lineup_member_id: memberId,
    event_id: eventId,
    slot_uuid: null,
    status: 'draft',
  }).select('id, status, slot_uuid, lineup_member_id, event_id').single();

  /* ⚠ SURFACED, NEVER SWALLOWED — an INSERT blocked by RLS fails loudly, and a
     unique violation here means somebody already holds the offer. */
  if (error) return { ok: false, error: error.message, performance: null };
  return { ok: true, error: null, performance: data };
}

/**
 * ── ⭐⭐ PUBLISH SET TIMES — the acts nobody can ask ─────────────────────────
 *
 * ⛔⛔ THIS IS NOT THE OLD `publishSetTimes`, AND MUST NEVER GROW INTO IT. That
 * one flipped statuses, wrote notifications, rewrote application statuses and
 * locked the event, all behind one press; it was dismantled deliberately and
 * `notifyPlan.js` names the collapse. This plan promotes performances and ⛔
 * does nothing else: no notification, no `applications` write, no
 * `set_times_locked`, no member status change.
 *
 * ── WHY IT EXISTS (owner, 2026-08-22, from a live event) ────────────────────
 *
 * "Back to the Clitoverse" had all four slots assigned and every one of them
 * read "Open slot" to the public. The four acts were hand-entered against
 * unclaimed profiles: `artist_id` NULL, so `isReachable` is false, so no offer
 * could ever be sent and nobody existed to accept one. The performances sat at
 * `draft`, RLS shows the public only `accepted` rows, and the set times were
 * therefore unpublishable BY ANY ROUTE IN THE APP.
 *
 * ⚠ `toClaim` already carried the rule — "there is no account to send an offer
 * to and no one to accept it, so the booking is CONFIRMED by the act of
 * writing it down" — but that was a DISPLAY translation the host saw and the
 * database never agreed with. This is the same rule, written down where the
 * public read can see it.
 *
 * ⛔⛔ REACHABLE ARTISTS ARE NEVER TOUCHED. Someone with an account gets asked,
 * and their answer is theirs to give: promoting their draft here would publish
 * a booking they have not agreed to and put a name on a public bill without
 * consent. That is the whole reason this filters rather than sweeps.
 *
 * @param members  lineup_members rows for the event
 * @param perfs    performances rows for the event
 * @returns {{ promoteIds: string[], skippedReachable: number, names: string[] }}
 */
export function planPublishSetTimes(members = [], perfs = []) {
  const byId = new Map((members || []).map(m => [m.id, m]));

  const promote = (perfs || []).filter(p => {
    /* A set time, not a bare place-offer: a null slot is "you are on the
       bill", which has nothing to publish. */
    if (!p?.slot_uuid) return false;
    if (p.status !== 'draft') return false;
    const member = byId.get(p.lineup_member_id);
    return !!member && !isReachable(member);
  });

  const skippedReachable = (perfs || []).filter(p =>
    p?.slot_uuid && p.status === 'draft' && isReachable(byId.get(p.lineup_member_id))).length;

  return {
    promoteIds: promote.map(p => p.id),
    skippedReachable,
    /* Named, not counted, because the confirmation says WHO goes public — a
       number cannot be checked against the bill by the person pressing it. */
    names: promote.map(p => byId.get(p.lineup_member_id)?.artist_name).filter(Boolean),
  };
}

/**
 * Apply a plan from `planPublishSetTimes`.
 *
 * ⚠ `accepted_at` IS STAMPED, because the column means "when this became a
 * booking" and every reader downstream tests it. ⛔ Leaving it null would make
 * a published set time look like an unanswered offer to `slotTally`, which
 * counts filled slots by acceptance.
 *
 * ⛔ ONE UPDATE, SCOPED BY ID. Never `.eq('event_id', …).eq('status','draft')`
 * — that would sweep in a reachable artist's draft the instant one is created
 * between the plan and the write.
 */
export async function applyPublishSetTimes(db, plan) {
  const ids = plan?.promoteIds || [];
  if (!ids.length) return { ok: true, error: null, published: 0 };

  /**
   * ⛔⛔ `.select()` IS THE VERIFICATION, NOT A CONVENIENCE. RLS FILTERS AN
   * UPDATE RATHER THAN ERRORING IT: a policy that forbids this write returns
   * `error: null` and touches nothing, so trusting the absence of an error
   * reports success over a database that did not move. That is exactly how 22
   * events sat un-editable without anyone noticing (see the slot editor's
   * error banner), and this function shipped with the same hole on
   * 2026-08-22 — the comment warning about it was there, the check was not.
   *
   * ⚠ COUNT THE ROWS BACK. Returning fewer than asked is a PARTIAL write:
   * some slots published, some blocked, and the host must be told which
   * rather than left comparing the grid against the public page by eye.
   */
  const { data, error } = await db.from('performances')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .in('id', ids)
    .select('id');

  if (error) return { ok: false, error: error.message, published: 0 };

  const published = (data || []).length;
  if (published === 0) {
    return {
      ok: false,
      published: 0,
      error: 'The database refused the change and reported nothing. This is usually a permissions rule on the event.',
    };
  }
  if (published < ids.length) {
    return {
      ok: false,
      published,
      error: `Only ${published} of ${ids.length} could be published. The rest were refused by a permissions rule.`,
    };
  }
  return { ok: true, error: null, published };
}
