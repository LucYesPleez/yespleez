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

  if (APPLICATION_TYPES.has(type)) {
    return data.event_id ? `/event/${data.event_id}/applications` : null;
  }
  if (EVENT_TYPES.has(type)) {
    return data.event_id ? `/event/${data.event_id}` : null;
  }
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
