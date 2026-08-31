/**
 * ── ⭐⭐ ACCEPTING SOMEONE FOR A NIGHT PRODUCES THE NIGHT ────────────────────
 *
 * RATIFIED 2026-08-31. A venue that accepts an act has agreed to a booking, so
 * the draft event exists from that moment rather than waiting for the organiser
 * to go and build it. The card's verb becomes EDIT, not CREATE.
 *
 * ⛔⛔ THE GUARD IS THE WHOLE FEATURE. Acceptance is PER ACT; an event is PER
 * NIGHT. A venue accepting three artists for one Saturday must end with ONE
 * event holding three acts, ⛔ never three events — that is exactly the split
 * the one-event law exists to prevent, and "merge the duplicates afterwards" is
 * the answer that law rejects.
 *
 *     accepted, no event that night   → CREATE a draft and shortlist them
 *     accepted, event already exists  → ATTACH: shortlist them onto it
 *
 * ⚠ ONLY WHERE THE ACCEPTER OWNS THE EVENT. A venue accepting a PROMOTER is
 * agreeing to host someone else's night — the promoter owns and creates it, so
 * nothing is created here (see project_role_ownership_events). That side keeps
 * WAITING ON THEM, which is already true.
 */
import { eventOwnerSide } from './enquiryNextStep';
import { isPastDate } from './dates';

/** A night is the same night when the venue and the date both match. */
export function findEventForNight(events = [], { venueProfileId, date } = {}) {
  if (!date) return null;
  return events.find(e => {
    const cfg = e?.config || {};
    /* ⚠ Compared on the STORED start date, ⛔ not on a derived "runs on" —
       a multi-day festival already has its own event and is not what an
       availability enquiry produces. */
    if (cfg.date !== date) return false;
    // A venue's own event may name the venue by column or be its own night.
    return !venueProfileId || !e.venue_profile_id || e.venue_profile_id === venueProfileId;
  }) || null;
}

/**
 * What should happen when this enquiry is accepted?
 *
 * @returns {{action:'create'|'attach'|'none', event?:object, reason?:string}}
 */
export function planAcceptedEnquiry({
  viewerType, otherType, date, venueProfileId, events = [], hasEventAlready = false,
  /* ⚠ INJECTABLE, like `eventBucket`'s. A test pinned to a hardcoded future
     date silently becomes a test of nothing the day that date passes. */
  todayStr = undefined,
} = {}) {
  // ⛔ Not ours to create — the other party owns the night.
  if (eventOwnerSide(viewerType, otherType) !== 'you') {
    return { action: 'none', reason: 'the other party owns the event' };
  }
  /* ⛔ A performer never reaches here, because they are never the owner side.
     The check above is the only gate needed, and it is the same function the
     card's chip uses, so the two cannot disagree about who acts. */
  if (!date) return { action: 'none', reason: 'the enquiry names no date' };

  /* ⛔⛔ A NIGHT THAT HAS PASSED IS NOT A NIGHT TO CREATE. New enquiries can no
     longer name a past date at all, but rows accepted today may have been SENT
     months ago — accepting one produced a draft event that was archived the
     moment it existed, findable only in ARCHIVE. ⭐ The acceptance still
     stands; it simply produces no event. */
  if (isPastDate(date, todayStr ?? undefined)) return { action: 'none', reason: 'that date has passed' };

  // The enquiry already points at an event — nothing to create or attach.
  if (hasEventAlready) return { action: 'none', reason: 'the enquiry already names an event' };

  const existing = findEventForNight(events, { venueProfileId, date });
  return existing
    ? { action: 'attach', event: existing }
    : { action: 'create' };
}

/**
 * The draft event a fresh acceptance produces.
 *
 * ⭐ DRAFT, ⛔ never live. The organiser has agreed to a booking, not decided to
 * announce a night — publishing is a separate, deliberate act, and an event
 * that announced itself the moment somebody was accepted would put half-built
 * nights on the public calendar.
 *
 * ⚠ The title is a STARTING POINT and says what is actually known: who and
 * where. ⛔ It must not invent a name the organiser then has to notice and
 * undo.
 */
export function draftEventForAcceptance({ actName, venueName, date, venueProfileId, ownerProfileId, userId } = {}) {
  const title = [actName, venueName].filter(Boolean).join(' at ') || 'New event';
  return {
    name: title,
    status: 'draft',
    // ⛔ Not public, for the same reason it is not live.
    is_public: false,
    applications_open: false,
    host_id: userId,
    owner_profile_id: ownerProfileId,
    venue_profile_id: venueProfileId || null,
    /* ⚠ `days: []` — set times are OFF until the organiser asks for them, the
       same default a new event now opens with. A running order nobody chose is
       the thing that made the editor feel like homework. */
    config: { date, days: [], venue: venueName || '' },
    /* ⛔ `managed`, exactly as the editor writes: acts arrive through the
       shortlist and are offered a slot. An acceptance is not a bill. */
    booking_model: 'managed',
  };
}
