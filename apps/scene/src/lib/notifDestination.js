/**
 * ── ⭐ WHERE A NOTIFICATION TAKES YOU ────────────────────────────────────────
 *
 * ONE definition of a notification's destination, for both surfaces. ⛔ NOT a
 * `switch` in `NotifPanel` and another in `NotificationsScreen` — those two are
 * twins and every rule that has been written twice in them has drifted (§11 was
 * written to stop exactly that and was broken within hours by its own author).
 *
 * ⭐⭐ THE DESTINATION IS DERIVED FROM WHAT THE ROW CARRIES, ⛔ never assumed
 * from its type alone. A `slot_offer` names an event in `data.event_id`; a
 * `new_follower` names nobody in `data` at all and its subject lives in the
 * COLUMN `about_profile_id`. A type that usually has a destination can arrive
 * without one — a legacy row, a held row, a writer that predates the key — and
 * ⛔ a link built on the assumption lands on `/event/undefined`.
 *
 * ⛔⛔ NULL IS A FIRST-CLASS ANSWER, AND THE CALLER MUST HONOUR IT. A row with
 * no destination is ⛔ not clickable and ⛔ must not LOOK clickable: no pointer
 * cursor, no hover state, no dead tap. That is the rendering contract — absent
 * is not the same as unknown, and an affordance that does nothing is the defect
 * this codebase has shipped more than once (three dead host controls on the
 * dashboard, `SlotCard`'s buttons rendering from `isHost` alone).
 *
 * ⚠ CONVERSATION TYPES ARE ABSENT ON PURPOSE. `new_message` and its siblings
 * never reach either surface — DEF-3 sends conversation activity to the MESSAGES
 * badge and CJ2 keeps `in_app` rows out of the bell. A destination for them here
 * would be dead code that implies the row can appear.
 */

/* ⚠ ALIASED. This file already owns a local `PROFILE_TYPES` — the set of
   notification types that route to a profile — and the two are different
   things entirely. Importing the registry under its own name shadowed it and
   the module would not even parse. */
import { PROFILE_TYPES as PROFILE_REGISTRY } from './profileTypes';

/**
 * ⭐ A DECISION ON AN ENQUIRY, WHICH USUALLY NAMES NO EVENT.
 *
 * A venue answering a date enquiry writes `booking_confirmed` (or shortlisted /
 * declined) with an `enquiry_id` and NO `event_id` — a direct enquiry has no
 * event to open. Those rows resolved to null and were therefore inert: the
 * enquirer read "You're booked!" and had nowhere to press.
 *
 * ⛔ The answer is NOT to invent an event route. It is the reader's own
 * enquiries section, which is where the accepted row actually lives.
 *
 * ⚠ `event_id` still wins when the enquiry names one — a booking FOR an event
 * is better served by that event's page, and only this branch's absence of one
 * makes the dashboard the most specific place to land.
 */
const ENQUIRY_DECISION_TYPES = new Set([
  'booking_confirmed', 'booking_cancelled', 'shortlisted', 'application_declined',
  /* ⭐ AN INVITE OFTEN NAMES NO EVENT — the venue is inviting an act to a night
     it has not built yet, which is the normal case, not an edge one. Sent to
     the act's own OFFERS rather than left inert. */
  'event_invite',
]);

/** Which tab of the enquiries panel the decision belongs to. */
const ENQUIRY_TAB = {
  booking_confirmed: 'BOOKED',
  booking_cancelled: 'OUTGOING',
  shortlisted:       'OUTGOING',
  application_declined: 'OUTGOING',
  /* ⚠ INCOMING, not OUTGOING: an invite is something the act RECEIVED. */
  event_invite:      'INCOMING',
};

/**
 * ⛔⛔ AN ID, OR NOTHING. `data.event_id` is copied from writer to writer —
 * `acceptInvite` and `declineInvite` pass whatever the invite carried straight
 * into the next notice — so a value that is not an id travels the whole chain.
 *
 * ⚠⚠ THIS IS NOT HYPOTHETICAL. The invite sheet's "+ Create New Event" option
 * is the sentinel `__new__`; it reached a notification unguarded and produced
 * `/event/__new__`, which cannot load, so pressing the notice dropped the
 * reader on What's On — twice over, because accepting that invite copied the
 * sentinel into a second notice.
 *
 * ⭐ Guarding HERE kills the class rather than the instance: every writer,
 * present and future, and every row ALREADY WRITTEN, because the destination
 * is computed at read time. A row carrying junk becomes inert instead of
 * pointing somewhere that does not exist.
 */
const looksLikeId = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v);

/** `/event/:id` — the notice is about one event, and the row names it. */
const EVENT_TYPES = new Set([
  'slot_offer', 'slot_changed', 'slot_removed', 'slot_accepted', 'slot_declined',
  'event_invite', 'invite_accepted', 'invite_declined',
  'event_reminder', 'event_updated', 'event_published', 'event_nearly_full',
  'set_times_released', 'booking_confirmed', 'booking_cancelled',
  'shortlisted', 'application_declined', 'availability_request',
]);

/**
 * `/event/:id/applications` — ⭐ the HOST's queue, ⛔ not the event page. A new
 * application is work to triage, and the event page has no surface for it.
 */
const APPLICATION_TYPES = new Set(['new_application']);

/**
 * `/profile/:id` — the notice is about a PERSON or an ACT.
 *
 * ⚠ The subject is `about_profile_id`, the column. ⛔ Not `to_profile_id`, which
 * is which of the READER's profiles the row is for — routing there would send
 * somebody to their own page to see who followed them.
 */
const PROFILE_TYPES = new Set([
  'new_follower', 'venue_followed', 'artist_updated', 'profile_claimed',
]);

/**
 * @param {object} notif  a `notifications` row
 * @returns {string|null} a route path, or null when the row names nowhere to go
 */
export function notifDestination(notif) {
  if (!notif) return null;
  const type = notif.type;
  const data = notif.data || {};

  /* ⛔ Read through the guard, never off `data` directly — see `looksLikeId`. */
  const eventId = looksLikeId(data.event_id) ? data.event_id : null;

  if (APPLICATION_TYPES.has(type)) {
    return eventId ? `/event/${eventId}/applications` : null;
  }
  // An event, when the row names one — the most specific place to land.
  if (EVENT_TYPES.has(type) && eventId) return `/event/${eventId}`;

  /* ⭐ Otherwise a decision on a direct enquiry goes to the reader's own
     enquiries section. ⛔ `dashPath` comes from the profile-type registry,
     never a restated map — a venue and a festival both correctly have nowhere
     to send an applicant, and the registry already says so (null). */
  /* ⚠ `enquiry_id` OR an invite: the invite's own row id is not carried in
     `data`, and requiring it would leave every invite inert. What both need is
     an act whose dashboard exists, which is the check below. */
  if (ENQUIRY_DECISION_TYPES.has(type) && (data.enquiry_id || type === 'event_invite')) {
    const dash = PROFILE_REGISTRY[data.applicant_type]?.dashPath;
    if (!dash) return null;
    const tab = ENQUIRY_TAB[type];
    return `${dash}?section=enquiries${tab ? `&tab=${tab}` : ''}`;
  }

  if (EVENT_TYPES.has(type)) return null;
  if (PROFILE_TYPES.has(type)) {
    /* ⚠ `about_profile_id` is nullable BY DESIGN under U4 — the system refuses
       to guess which of several profiles acted. ⛔ That is a correct answer, so
       it yields no destination rather than a wrong one. */
    return notif.about_profile_id ? `/profile/${notif.about_profile_id}` : null;
  }
  /* ⛔ Everything else — `generic`, the payment pair, the festival types (which
     have no Scene route at all) — goes nowhere, deliberately. */
  return null;
}

/** ⭐ For the surfaces: a row is only interactive where it actually leads somewhere. */
export function isNavigable(notif) {
  return notifDestination(notif) !== null;
}
