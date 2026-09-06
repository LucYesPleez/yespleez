/**
 * WHICH SOUND A NOTIFICATION MAKES.
 *
 * ⭐⭐ THIRTY TYPES, FIVE SOUNDS (owner, 2026-09-06). `lib/notifMeta.jsx`
 * catalogues thirty notification types. Giving each its own sound would teach
 * the ear nothing — a sound you cannot name the instant you hear it is noise,
 * and thirty of them is thirty kinds of noise. They are grouped by WHAT THE
 * SOUND ASKS OF YOU, which is the only question a person answers before they
 * have looked at the screen:
 *
 *   arrive  someone is talking to you        the one that fires most
 *   ask     a decision is wanted from you    the only one meant to carry
 *   yes     you got a yes
 *   no      you got a no
 *   moved   something you are in has changed information, not a request
 *   (none)  ambient                          worth seeing, never worth a sound
 *
 * ⛔ THIS FILE MAPS, IT DOES NOT PLAY. `lib/uiSound.js` owns the audio, the
 * levels and the iOS unlock; it knows nothing about notifications. Keeping the
 * two apart is what lets a new notification type be given a sound by adding one
 * line here, with no audio change at all.
 *
 * ⚠⚠ A TYPE THAT IS NOT LISTED IS SILENT, AND THAT IS THE SAFE DIRECTION. A new
 * type ships making no sound until somebody decides which class it belongs to.
 * ⛔ Do not add a default: guessing a class for an unknown type is how a
 * follow notification ends up making the same sound as a booking offer.
 */

/**
 * ⛔ KEYS MUST MATCH `notifMeta.jsx` EXACTLY. They are the values of
 * `notifications.type`, and a typo here is silent in both directions — no
 * sound plays and no error is raised.
 */
export const NOTIFICATION_SOUND = {
  // Someone is talking to you.
  new_message:          'arrive',

  // A decision is wanted from you. ⚠ The only class that should carry across a
  // room, because it is the only one where looking at the phone is the point.
  slot_offer:           'ask',
  event_invite:         'ask',
  availability_request: 'ask',
  new_application:      'ask',
  payment_requested:    'ask',
  shortlisted:          'ask',

  // You got a yes.
  booking_confirmed:    'yes',
  slot_accepted:        'yes',
  invite_accepted:      'yes',
  festival_accepted:    'yes',
  payment_received:     'yes',

  /* You got a no. ⚠ Deliberately not harsh: in this app a no is common and is
     not a failure. A sting here would make the whole product feel punishing. */
  application_declined: 'no',
  slot_declined:        'no',
  invite_declined:      'no',
  booking_cancelled:    'no',
  festival_declined:    'no',

  // Something you are in has changed. Information, not a request.
  slot_changed:         'moved',
  slot_removed:         'moved',
  event_updated:        'moved',
  event_published:      'moved',
  set_times_released:   'moved',
  event_reminder:       'moved',
  event_nearly_full:    'moved',
  festival_opened:      'moved',

  /* ⛔ AMBIENT IS ABSENT ON PURPOSE, ⛔ not forgotten:
     new_follower · venue_followed · profile_claimed · artist_updated · generic
     Worth seeing in the app, never worth a sound at 2am. They are listed here
     in a comment so the next reader can tell a decision from an omission. */
};

/**
 * The sound key for a notification row, or null for silence.
 *
 * ⚠ Takes the TYPE STRING, not the row, so it can be called from a realtime
 * payload, a fetched row or a test without any of them agreeing on a shape.
 */
export function soundForNotification(type) {
  return NOTIFICATION_SOUND[String(type || '').toLowerCase()] || null;
}
