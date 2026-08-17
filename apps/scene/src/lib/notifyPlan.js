/**
 * ── ⭐⭐ P6 · WHAT HAVE WE ACTUALLY TOLD THIS ARTIST? ────────────────────────
 *
 * THREE INDEPENDENT QUESTIONS, and this module answers only the third:
 *
 *   BOOKING       are they booked?            `hostLineup.isBooked`
 *   SCHEDULING    when are they playing?      `performances.slot_uuid`
 *   NOTIFICATION  what have we told them?     ⭐ HERE
 *
 * ⛔⛔ `set_times_locked` APPEARS NOWHERE IN THIS FILE, DELIBERATELY. It is an
 * EVENT-level editing flag that happens to be set by the publish action, and it
 * was being read as though it meant "everyone has been told". It cannot: it is
 * one boolean for a fact that is per artist. That conflation is why a set time
 * drafted after publishing had no route to the artist at all, and why the only
 * way to reach one person was to unlock, which reverts EVERY outstanding offer
 * to draft and then re-notifies people who were already told.
 *
 * ── ⭐⭐ THE COMMUNICATED STATE LIVES ON `lineup_members` ────────────────────
 *
 *     lineup_members.notified_at          when we last told them
 *     lineup_members.notified_slot_uuid   WHAT we told them
 *
 * ⚠⚠ AND IT COMPARES SLOTS, ⛔ NEVER TIMESTAMPS. `performances.updated_at >
 * notified_at` was the original design and it cannot work, twice over:
 *
 *   1. No app write sets `performances.updated_at` and no trigger exists on that
 *      table, so it never moves off its insert default.
 *   2. `assignMemberToSlot` DELETES and RE-INSERTS the row, so any timestamp or
 *      flag stored on a performance is destroyed by the next reassignment.
 *
 * ⭐ `lineup_members` is the durable identity: 23 call sites touch that table and
 * ⛔ NONE of them delete a row (removal is a soft `status='removed'`), and all
 * three updates write narrow field sets, so these two columns survive drag,
 * reorder, reassignment, clearing a set time and the delete-and-recreate.
 *
 * ⛔ NO BOOLEAN. `needs_notify` would be a fifth thing to keep in sync and would
 * drift the first time a write forgot it. Comparing what they hold against what
 * they were told cannot drift, because both sides are already recorded facts.
 *
 * ── ⛔⛔ THIS FILE IS A PURE DERIVATION LAYER (owner, 2026-08-17) ─────────────
 *
 * It reads rows and returns states. ⛔ IT MUST NEVER ACQUIRE:
 *
 *   ⛔ a supabase client, or any write of any kind
 *   ⛔ notification dispatch — no `writeNotifications`, no messages, no push
 *   ⛔ UI concerns — no components, no colours, no tab logic
 *   ⛔ `set_times_locked` in any form
 *
 * ⭐ `notifiedPatch` returns the SHAPE of the write and ⛔ does not perform it,
 * so the one writer that eventually persists it lives elsewhere and can be
 * pointed at. ⚠ The moment this file can send, "what were they told" and "tell
 * them" become one operation again, which is the exact collapse that made
 * `publishSetTimes` flip statuses, write notifications, rewrite application
 * statuses and lock the event behind a single press.
 */
import { isBooked } from './hostLineup';

/** ⭐ The state names. ⛔ Compare against these, never against a string. */
export const NOTHING_TO_SAY   = 'NOTHING_TO_SAY';
export const NEEDS_SET_TIME   = 'NEEDS_SET_TIME';
export const NOT_NOTIFIED     = 'NOT_NOTIFIED';
export const CLEAN            = 'CLEAN';
export const TIME_CHANGED     = 'TIME_CHANGED';
export const REMOVAL_TO_TELL  = 'REMOVAL_TO_TELL';

/**
 * ⚠ THE HOST-FACING WORDING, kept beside the rule so every surface says it the
 * same way. ⛔ NO EM DASHES: this is copy.
 *
 * ⚠ `NEEDS SET TIME` and `SET TIME NOT SENT` are `lineupWorkState`'s existing
 * ratified phrases (owner, 2026-08-16) and are reused verbatim: NEEDS names the
 * work, NOT SENT names a set time that exists and is being withheld.
 */
export const NOTIFY_LABELS = {
  [NOTHING_TO_SAY]:  null,
  [NEEDS_SET_TIME]:  'NEEDS SET TIME',
  [NOT_NOTIFIED]:    'SET TIME NOT SENT',
  [CLEAN]:           'SET TIME SENT',
  [TIME_CHANGED]:    'SET TIME CHANGED',
  [REMOVAL_TO_TELL]: 'REMOVAL NOT SENT',
};

/** ⭐ Which states are WORK. ⛔ CLEAN and NOTHING_TO_SAY are not. */
export function needsNotice(state) {
  return state === NOT_NOTIFIED || state === TIME_CHANGED || state === REMOVAL_TO_TELL;
}

/**
 * ⚠ THE SLOTS THEY CURRENTLY HOLD. A null-slot performance is the EVENT-LEVEL
 * OFFER (P4), ⛔ not a placement, so it is not a set time to communicate.
 */
export function placementsOf(perfs = []) {
  return [...new Set((perfs || []).filter(p => p?.slot_uuid).map(p => p.slot_uuid))];
}

/**
 * @param member  a `lineup_members` row, carrying `notified_at` and
 *                `notified_slot_uuid`
 * @param perfs   that member's `performances` rows
 * @param event   ⭐ decides what "booked" means. ⛔ Never bypassed: an artist who
 *                is not booked has no set time to be told about, whatever rows
 *                happen to exist.
 *
 * @returns {{state: string, label: ?string, needsNotice: boolean,
 *            placements: string[], notifiedSlotUuid: ?string, notifiedAt: ?string}}
 */
export function notifyState(member, perfs = [], event = null) {
  const notifiedAt   = member?.notified_at ?? null;
  const notifiedSlot = member?.notified_slot_uuid ?? null;
  const placements   = placementsOf(perfs);

  const out = state => ({
    state, label: NOTIFY_LABELS[state], needsNotice: needsNotice(state),
    placements, notifiedSlotUuid: notifiedSlot, notifiedAt,
  });

  /**
   * ⛔⛔ NOT BOOKED MEANS NOTHING TO SAY, and it is the FIRST test. A shortlisted
   * artist cannot hold a set time at all now (`canPlaceMember`), but if a row
   * from before that gate survives, ⛔ this must not invite the host to announce
   * a booking that does not exist.
   */
  if (!isBooked(member, perfs, event)) return out(NOTHING_TO_SAY);

  if (!placements.length) {
    /**
     * ⭐ TOLD ABOUT A TIME THEY NO LONGER HAVE. This is the state a performance
     * timestamp could never express, because the row carrying it is gone.
     * ⚠ `notified_slot_uuid` may itself be NULL here: the slot can be deleted
     * (ON DELETE SET NULL) while `notified_at` stands. Having been told is what
     * matters, ⛔ not whether the thing we said still exists.
     */
    return out(notifiedAt ? REMOVAL_TO_TELL : NEEDS_SET_TIME);
  }

  if (!notifiedAt) return out(NOT_NOTIFIED);

  /**
   * ⚠⚠ ONE PLACEMENT AND IT MATCHES IS THE ONLY WAY TO BE CLEAN.
   *
   * ⛔ A MEMBER MAY HOLD SEVERAL SLOTS (a festival act playing twice is normal,
   * and L3 constrains `(slot, member)` rather than the slot alone precisely so
   * that stays possible) while `notified_slot_uuid` records ONE. So a two-slot
   * act cannot be proven clean by this column, and it reads as CHANGED.
   *
   * ⭐ THAT IS THE SAFE DIRECTION, ⛔ not an oversight: the failure mode is
   * asking the host to send a notice they may not need, ⛔ never telling them
   * everything is settled when an artist has not heard about one of their sets.
   * ⚠ A multi-placement recording is a schema question and ⛔ not this phase's.
   */
  const clean = placements.length === 1 && placements[0] === notifiedSlot;
  return out(clean ? CLEAN : TIME_CHANGED);
}

/**
 * ⭐ ONE ANSWER PER ARTIST for a whole event, in the order given.
 *
 * ⛔ IT SENDS NOTHING and writes nothing. Naming what is owed is a different job
 * from doing it, which is the separation the old `publishSetTimes` collapsed:
 * that one press flipped statuses, wrote notifications, rewrote application
 * statuses and locked the event.
 */
export function notifyPlan({ members = [], perfsByMember = {}, event = null } = {}) {
  return (members || []).filter(Boolean).map(m => ({
    member: m,
    ...notifyState(m, (perfsByMember || {})[m.id] || [], event),
  }));
}

/** ⭐ Just the artists with something outstanding. */
export function artistsNeedingNotice(plan = []) {
  return (plan || []).filter(r => r?.needsNotice);
}

/**
 * ⭐⭐ THE PATCH TO PERSIST, AND ⛔ ONLY AFTER THE MESSAGE ACTUALLY WENT.
 *
 * ⚠⚠ ONE ARTIST'S ROW, keyed by member id by the caller. This is what makes a
 * newly scheduled artist notifiable WITHOUT touching anybody else: nothing here
 * is event-wide, so telling one person cannot retract or reissue another
 * person's offer. ⛔ That was the only mechanism available before.
 *
 * ⚠ Records the slot they were told about, ⛔ not "true". A patch that stored a
 * flag would answer "was anything sent" and could never answer "was THIS sent".
 *
 * @param slotUuid the placement being communicated, or null when the notice IS
 *                 that they no longer have one.
 */
export function notifiedPatch(slotUuid, at) {
  return {
    notified_at: at || new Date().toISOString(),
    notified_slot_uuid: slotUuid || null,
  };
}
