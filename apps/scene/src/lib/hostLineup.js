/**
 * THE HOST'S LINEUP — built from the events they own and the acts on the bill.
 *
 * ⚠⚠ THE DEFECT THIS REPLACES. The LINEUP section was built by querying
 * `applications` where `status = 'accepted'` and grouping the result by event.
 * `lineup_members` was read only to fill the set-times strip. Measured with the
 * service role on 2026-08-15:
 *
 *     lineup_members (live)                                  152
 *     invisible on the dashboard (no accepted application)    149   across 39 events
 *     applications in the entire database                      13
 *
 * So the section was not showing a subset of the bill — it was showing almost
 * none of it. An event appeared only once somebody applied AND was accepted, so
 * an act the organiser added themselves was invisible, and `Bass Heavy` was
 * missing altogether.
 *
 * ⭐⭐ THE RATIFIED INVARIANT (owner, 2026-08-15):
 *
 *     `lineup_members` is the source of truth for the event's lineup.
 *     `applications.status` may FEED or CREATE lineup membership, but an
 *     accepted application must NEVER be the condition for an event or its
 *     lineup to appear here.
 *
 * ⛔ So there is no application query in this file at all. Applications are
 * passed in only to fill the SHORT LIST and PIPELINE tabs, which are about
 * applications and nothing else — and they cannot affect which events appear.
 */
import { requiresConfirmation } from './eventProvenance';
import { rankPerformance } from './eventSlots';

/**
 * What state an act on the bill is in.
 *
 * ⚠ A MEMBER WITH NO PERFORMANCE IS THE NORMAL CASE, not an edge one — 123 of
 * 152 members are in exactly that state. It means "on the bill, no set time
 * yet", which is the whole point of separating Lineup from Set Times: the
 * creative decision happens before the production one.
 *
 * ⚠ A HAND-ENTERED ACT IS CONFIRMED once given a slot. There is no account to
 * offer to and nobody to accept, so reading `offered` literally would show them
 * as awaiting a reply from nobody. Same rule as `eventSlots.toClaim`.
 */
export function memberState(member, perfs = []) {
  if (!perfs.length) return 'ON BILL';
  const best = [...perfs].sort((a, b) => rankPerformance(a) - rankPerformance(b))[0];
  if (best.status === 'accepted') return 'CONFIRMED';
  if (best.status === 'declined') return 'DECLINED';
  if (best.status === 'draft')    return 'DRAFT';
  if (!member?.artist_id)         return 'CONFIRMED';
  return 'AWAITING';
}

export const STATE_COLOURS = {
  CONFIRMED: '#00E5A0',
  AWAITING:  '#FF8C42',
  DECLINED:  '#FF3399',
  DRAFT:     'rgba(255,255,255,.35)',
  'ON BILL': 'rgba(255,255,255,.35)',
};

/**
 * @param events          the events this host owns — ⭐ ALL of them
 * @param members         lineup_members rows across those events
 * @param performances    performances rows across those events
 * @param slotsByEvent    { [eventId]: day array } from `groupSlotsIntoDays`
 * @param memberProfiles  { [lineup_members.id]: profiles row }
 *
 * @returns one group per event, in the order the events were given.
 */
export function buildHostLineup({
  events = [], members = [], performances = [], slotsByEvent = {}, memberProfiles = {},
} = {}) {
  const perfsByMember = {};
  (performances || []).forEach(p => {
    if (!p?.lineup_member_id) return;
    (perfsByMember[p.lineup_member_id] ||= []).push(p);
  });

  const membersByEvent = {};
  (members || []).forEach(m => {
    if (!m?.event_id) return;
    (membersByEvent[m.event_id] ||= []).push(m);
  });

  return (events || []).filter(Boolean).map(event => {
    const rows = (membersByEvent[event.id] || []).map(m => {
      const perfs = perfsByMember[m.id] || [];
      return {
        id:      m.id,
        member:  m,
        profile: memberProfiles[m.id] || null,
        perfs,
        state:   memberState(m, perfs),
        /* ⚠ A member can hold SEVERAL slots — a festival act playing twice in a
           day is normal, and L3 constrains (slot, member) rather than the slot
           alone precisely so that stays possible. */
        slotCount: perfs.filter(p => p.slot_uuid).length,
      };
    });

    const days  = slotsByEvent[event.id] || [];
    const slots = days.flatMap(d => d.slots || []);

    return {
      event,
      members: rows,
      days,
      /**
       * ⚠ `filled` COUNTS SLOTS SOMEBODY AGREED TO PLAY, matching `slotTally`.
       * Counting "anything not declined" reported an unanswered offer as a
       * booked slot, which told an organiser their night was covered when it
       * was not.
       *
       * ⚠⚠ AND IT GOES THROUGH `memberState`, NOT `status === 'accepted'`.
       * A hand-entered act has no account to accept, so its performance sits at
       * `offered` forever while the act is genuinely booked. Testing the raw
       * status made this dashboard disagree with the event page — `slotTally`
       * reads claims that have ALREADY had the hand-entered rule applied. Two
       * surfaces answering "how full is this night" differently is the exact
       * divergence the ownedByFilter note at the top of HostDashboard warns
       * about.
       */
      totalSlots:  slots.length,
      filledSlots: slots.filter(sl =>
        (performances || []).some(p => {
          if (p.slot_uuid !== sl.id) return false;
          const m = (members || []).find(x => x.id === p.lineup_member_id);
          return memberState(m, [p]) === 'CONFIRMED';
        })).length,
      onBill:      rows.length,
      /* How many are on the bill with nowhere to play yet — the number the
         Lineup workspace exists to act on. */
      unscheduled: rows.filter(r => r.slotCount === 0).length,
    };
  });
}

/**
 * ⭐ THE COUNT IN THE HEADER IS THE BILL, not accepted applications.
 *
 * It read `count(applications where status='accepted')`, which was 3 across the
 * whole database while 152 acts were actually booked.
 */
export function totalOnBill(groups = []) {
  return (groups || []).reduce((n, g) => n + (g.members?.length || 0), 0);
}

/**
 * ⭐⭐ THE BILL CANNOT EXCEED THE RUNNING ORDER (owner, 2026-08-16: "i dont
 * want it to be possible to have 7/5 on the lineup").
 *
 * ⚠⚠ THIS REVERSES the warning-only decision taken earlier the same day. The
 * amber `7 / 5` tile stays — it still has to describe the events already in
 * that state, which a new rule cannot retroactively fix — but no NEW add may
 * create one.
 *
 * ⛔⛔ NO SLOTS MEANS NO CAP, ⛔ NOT A CAP OF ZERO. An event with "set times
 * needed" switched off has zero `event_slots` rows on purpose — a community
 * night with no running order. Reading that as "room for nobody" would make
 * the bill unusable on exactly the events that need the least ceremony, and it
 * would look like a bug rather than a rule.
 *
 * @returns {{ capped: boolean, full: boolean, remaining: number, total: number }}
 */
export function billCapacity(onBillCount = 0, totalSlots = 0) {
  const total = Number(totalSlots) || 0;
  if (total <= 0) return { capped: false, full: false, remaining: Infinity, total: 0 };
  const remaining = total - (Number(onBillCount) || 0);
  return { capped: true, full: remaining <= 0, remaining: Math.max(remaining, 0), total };
}

/**
 * ⚠ THE SENTENCE THE HOST READS. Kept beside the rule so every surface refuses
 * in the same words — ⛔ a screen inventing its own phrasing is how two places
 * come to describe one rule differently.
 *
 * ⚠ It says what to DO, not merely what failed: the way out is to add a slot
 * or take somebody off, and neither is obvious from "the lineup is full".
 */
export function billFullMessage(total) {
  return `This event has ${total} set ${total === 1 ? 'time' : 'times'} and the lineup is already full. Add another set time, or move somebody to the shortlist first.`;
}

/**
 * ── ⭐⭐ P3 · IS THIS ARTIST ACTUALLY BOOKED? ────────────────────────────────
 *
 * The one question the new model turns on, and it has TWO right answers
 * depending on which contract the event lives under (`lib/eventProvenance`).
 *
 *   legacy / imported   the bill is AUTHORITATIVE AS IT STANDS. Those acts
 *                       were booked before this model existed, or booked
 *                       somewhere else entirely. ⛔ They are not asked to
 *                       reconfirm, and `status = 'on_bill'` remains the answer.
 *
 *   managed             booking is MUTUAL. The host offering is not a booking;
 *                       only the artist's acceptance is —
 *                       `performances.status = 'accepted'`.
 *
 * ⛔⛔ THE RAW ROW, ⛔ NEVER THE DISPLAY STATUS. `memberState` above returns
 * 'CONFIRMED' for a hand-entered act with no account, because for PIXELS that
 * is the honest reading — nobody is waiting on a reply. ⛔ Reading that here
 * would book somebody the artist never agreed to. This function looks only at
 * `performances.status`, which is what the database was told.
 *
 * ⚠ `accepted` is checked ⛔ not `confirmed`: `confirmed` belongs to the
 * applications vocabulary, and mixing the two is the defect that once left
 * PIPELINE and SHORT LIST empty on every event.
 */
export function isBooked(member, perfs = [], event = null) {
  if (!requiresConfirmation(event)) return member?.status === 'on_bill';
  return (perfs || []).some(p => p?.status === 'accepted');
}

/**
 * The confirmed bill for an event — LINEUP, derived rather than stored.
 *
 * @param groups the shape `buildHostLineup` already returns
 *               (`{ member, perfs, … }` per artist), so ⛔ this needs no loader
 *               of its own and cannot disagree with what the screens read.
 */
export function bookedMembers(groups = [], event = null) {
  return (groups || []).filter(g => isBooked(g?.member, g?.perfs, event));
}

/**
 * ⭐ BOOKED, BUT NOT YET SCHEDULED — the state that keeps SHORTLIST honest.
 *
 * ⚠⚠ THIS IS WHY THE LINEUP TAB CAN DISAPPEAR. A booked artist with no set
 * time appears nowhere in a slot grid, so without this they would silently
 * vanish the moment SET TIMES replaced LINEUP. They stay at the top of
 * SHORTLIST with a BOOKED chip until the host gives them a time.
 *
 * ⚠ "Scheduled" means holding a performance with a REAL slot. ⛔ A null-slot
 * performance is the EVENT-LEVEL OFFER (P4), ⛔ not a placement.
 */
export function isScheduled(perfs = []) {
  return (perfs || []).some(p => p?.slot_uuid);
}

export function bookedUnscheduled(groups = [], event = null) {
  return bookedMembers(groups, event).filter(g => !isScheduled(g?.perfs));
}
