import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { notifDestination, isNavigable } from './notifDestination.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ⚠ REAL-SHAPED IDS. These fixtures used to be `e1`/`e2`, which read nicely and
 * are not ids — and the module now refuses anything that is not one, because a
 * sentinel travelling the writer chain produced `/event/__new__` in production.
 * ⛔ The assertions are unchanged in strength; only the fixtures became honest.
 */
const E1 = '2b919b64-8d2d-4799-9eff-f00b1ddf9bee';
const E2 = '1238c417-4365-4728-90e5-1a768ad63a69';

test('an event notice opens its event', () => {
  assert.equal(
    notifDestination({ type: 'slot_offer', data: { event_id: E1, performance_id: 'p1' } }),
    `/event/${E1}`);
  assert.equal(
    notifDestination({ type: 'slot_removed', data: { event_id: E2 } }),
    `/event/${E2}`);
});

/**
 * ⭐ A new application is WORK, and the event page has nowhere to do it.
 */
test('a new application opens the applications queue, not the event page', () => {
  assert.equal(
    notifDestination({ type: 'new_application', data: { event_id: E1 } }),
    `/event/${E1}/applications`);
});

/**
 * ⚠ The subject is the COLUMN. ⛔ `to_profile_id` is which of the reader's own
 * profiles the row is for — routing there sends somebody to their own page.
 */
test('a follow opens the follower, from about_profile_id', () => {
  const notif = {
    type: 'new_follower',
    about_profile_id: 'them',
    to_profile_id: 'me',
    data: { follower_id: 'u-1' },
  };
  assert.equal(notifDestination(notif), '/profile/them');
});

/**
 * ⛔⛔ THE POINT OF THE WHOLE MODULE. A type that usually leads somewhere can
 * arrive without the key — a legacy row, a writer that predates it — and a link
 * built on the type alone lands on `/event/undefined`.
 */
test('⛔⛔ a row that names no event is NOT navigable', () => {
  for (const notif of [
    { type: 'slot_offer', data: {} },
    { type: 'slot_offer' },
    { type: 'new_application', data: {} },
    { type: 'event_reminder', data: { event_name: 'Bass Heavy' } },
  ]) {
    assert.equal(notifDestination(notif), null, `${JSON.stringify(notif)} produced a destination`);
    assert.equal(isNavigable(notif), false);
  }
  assert.equal(String(notifDestination({ type: 'slot_offer', data: {} })).includes('undefined'), false);
});

/**
 * ⚠ `about_profile_id` is nullable BY DESIGN under U4 — the system refuses to
 * guess which of several owned profiles acted. ⛔ A correct answer, so it must
 * yield no link rather than a wrong one.
 */
test('a follow with no resolved subject is not navigable', () => {
  assert.equal(notifDestination({ type: 'new_follower', about_profile_id: null, to_profile_id: 'me' }), null);
});

test('types with nowhere to go stay inert', () => {
  for (const type of ['generic', 'payment_requested', 'payment_received', 'festival_opened', 'festival_accepted', 'festival_declined']) {
    assert.equal(notifDestination({ type, data: { event_id: 'e1' } }), null,
      `${type} must not invent a destination`);
  }
});

/**
 * ⭐ A DECISION ON A DIRECT ENQUIRY — the case that has no event at all.
 *
 * "You're booked!" was inert: `booking_confirmed` sits in the event family, a
 * date enquiry names no event, so the row resolved to null and the enquirer had
 * nowhere to press. It goes to their OWN enquiries section instead.
 */
test('a booking on a direct enquiry lands on the enquirer\'s own section', () => {
  assert.equal(
    notifDestination({ type: 'booking_confirmed', data: { enquiry_id: 7, applicant_type: 'artist' } }),
    '/industry/artist?section=enquiries&tab=BOOKED');
  assert.equal(
    notifDestination({ type: 'booking_confirmed', data: { enquiry_id: 7, applicant_type: 'host' } }),
    '/industry/host?section=enquiries&tab=BOOKED');
  // band and standup share the performer dashboard, by their own registry entry
  assert.equal(
    notifDestination({ type: 'shortlisted', data: { enquiry_id: 7, applicant_type: 'band' } }),
    '/industry/band?section=enquiries&tab=OUTGOING');
  assert.equal(
    notifDestination({ type: 'application_declined', data: { enquiry_id: 7, applicant_type: 'standup' } }),
    '/industry/standup?section=enquiries&tab=OUTGOING');
});

test('⭐ an enquiry that DOES name an event still opens the event', () => {
  assert.equal(
    notifDestination({ type: 'booking_confirmed', data: { enquiry_id: 7, applicant_type: 'artist', event_id: E1 } }),
    `/event/${E1}`);
});

/**
 * ⛔ The same discipline as every other branch: a row that cannot say where it
 * belongs stays inert rather than guessing a dashboard.
 */
test('⛔ a decision that names no applicant type, or a type with no dashboard, is inert', () => {
  for (const data of [
    { enquiry_id: 7 },                                  // legacy row, written before the key
    { enquiry_id: 7, applicant_type: null },
    { enquiry_id: 7, applicant_type: 'venue' },         // dashPath exists but a venue never applies
    { enquiry_id: 7, applicant_type: 'festival' },      // dashPath is null — the Portal is another app
    { enquiry_id: 7, applicant_type: 'punter' },
    { applicant_type: 'artist' },                       // names no enquiry
  ]) {
    const notif = { type: 'booking_confirmed', data };
    const dest = notifDestination(notif);
    assert.equal(dest === null || dest === '/industry/venue?section=enquiries&tab=BOOKED', true,
      `${JSON.stringify(data)} produced ${dest}`);
    if (dest) assert.equal(String(dest).includes('undefined'), false);
  }
  assert.equal(notifDestination({ type: 'booking_confirmed', data: { enquiry_id: 7, applicant_type: 'festival' } }), null);
  assert.equal(notifDestination({ type: 'booking_confirmed', data: { enquiry_id: 7 } }), null);
});

/**
 * ⛔⛔ A SENTINEL IS NOT AN ID. The invite sheet's picker offers "+ Create New
 * Event" as `__new__`; that value reached the notification unguarded, so the
 * link resolved to `/event/__new__` — an event that cannot exist — and the
 * reader was dropped on What's On. The row is written with null now; this pins
 * what the destination does with an invite either way.
 */
test('⭐ an invite that names no event goes to the act\'s own offers', () => {
  assert.equal(
    notifDestination({ type: 'event_invite', data: { event_id: null, applicant_type: 'artist' } }),
    '/industry/artist?section=enquiries&tab=INCOMING');
  assert.equal(
    notifDestination({ type: 'event_invite', data: { applicant_type: 'band' } }),
    '/industry/band?section=enquiries&tab=INCOMING');
});

test('an invite that DOES name an event still opens the event', () => {
  assert.equal(
    notifDestination({ type: 'event_invite', data: { event_id: E1, applicant_type: 'artist' } }),
    `/event/${E1}`);
});

test('⛔ an invite naming no act type stays inert rather than guessing a dashboard', () => {
  assert.equal(notifDestination({ type: 'event_invite', data: {} }), null);
  assert.equal(notifDestination({ type: 'event_invite', data: { applicant_type: 'punter' } }), null);
});

/**
 * ⛔⛔ AN ID, OR NOTHING — the class, not the instance.
 *
 * `acceptInvite`/`declineInvite` copy `data.event_id` from one notice into the
 * next, so junk travels the whole chain. `__new__` (the invite picker's
 * "+ Create New Event") did exactly that and produced `/event/__new__`, which
 * cannot load — so the reader was dropped on What's On, twice over.
 *
 * ⭐ Guarding at read time also repairs rows ALREADY WRITTEN: they become
 * inert instead of pointing somewhere that does not exist.
 */
test('⛔⛔ an event_id that is not an id is treated as absent', () => {
  for (const junk of ['__new__', 'new', '', 'undefined', 'null', 42, {}, true]) {
    for (const type of ['event_invite', 'invite_accepted', 'slot_offer', 'new_application']) {
      const dest = notifDestination({ type, data: { event_id: junk } });
      /* ⚠ THE ASSERTION IS "no event link", ⛔ not "the junk is absent from the
         string" — `''.includes('')` is true, so that form passed itself. */
      assert.equal(String(dest).includes('/event/'), false,
        `${type} built an event link out of ${JSON.stringify(junk)}: ${dest}`);
    }
  }
});

test('⭐ a real uuid still resolves', () => {
  assert.equal(
    notifDestination({ type: 'slot_offer', data: { event_id: '2b919b64-8d2d-4799-9eff-f00b1ddf9bee' } }),
    '/event/2b919b64-8d2d-4799-9eff-f00b1ddf9bee');
});

test('an unknown type is inert rather than guessed at', () => {
  assert.equal(notifDestination({ type: 'something_new', data: { event_id: 'e1' } }), null);
  assert.equal(notifDestination(null), null);
});

/**
 * ⛔ CONVERSATION TYPES NEVER REACH EITHER SURFACE — DEF-3 sends conversation
 * activity to the MESSAGES badge, CJ2 keeps `in_app` out of the bell. A
 * destination for them would be dead code implying the row can appear.
 */
test('⛔ no destination is defined for conversation types', () => {
  assert.equal(notifDestination({ type: 'new_message', data: { conversation_id: 'c1' } }), null);
  const src = readFileSync(join(SRC, 'lib/notifDestination.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/conversation_id/.test(src), false, 'it routes a type that cannot appear');
});

/**
 * ⭐ Every type the app can DISPLAY is accounted for — either it leads
 * somewhere or it is deliberately inert. ⛔ Adding a type to notifMeta without
 * deciding which is what this test exists to catch.
 */
test('⭐ every displayable notification type has a decision recorded', () => {
  const meta = readFileSync(join(SRC, 'lib/notifMeta.jsx'), 'utf8');
  const types = [...meta.matchAll(/^\s{2}([a-z_]+):\s*\{\s*label:/gm)].map(m => m[1]);
  assert.ok(types.length > 20, `expected the full type list, read ${types.length}`);

  const dest = readFileSync(join(SRC, 'lib/notifDestination.js'), 'utf8');
  const routed = new Set([...dest.matchAll(/'([a-z_]+)'/g)].map(m => m[1]));

  /* ⛔ INERT BY DECISION, each for a stated reason: no Scene route (festival),
     nothing to open (payments, generic), or a placeholder label. */
  const INERT = new Set([
    'generic', 'payment_requested', 'payment_received',
    'festival_opened', 'festival_accepted', 'festival_declined',
    'new_message',
  ]);

  const undecided = types.filter(t => !routed.has(t) && !INERT.has(t));
  assert.deepEqual(undecided, [],
    `these types are neither routed nor recorded as inert:\n  ${undecided.join('\n  ')}`);
});

/**
 * ⭐⭐ AN AVAILABILITY ENQUIRY MUST OPEN (owner, 2026-09-01: notifications
 * should take you to that spot in the app).
 *
 * ⛔⛔ EVERY ONE OF THESE WAS INERT. `availability_request` sat in EVENT_TYPES
 * only, and a direct date enquiry names no event, so it fell through to the
 * null return. Three of them were sitting unclickable in the owner's bell.
 */
test('an availability enquiry opens the RECIPIENT\'s enquiries, incoming', () => {
  assert.equal(
    notifDestination({
      type: 'availability_request',
      data: { enquiry_id: 65, recipient_type: 'venue' },
    }),
    '/industry/venue?section=enquiries&tab=INCOMING');
});

/**
 * ⛔ ENQUIRING IS UNIVERSAL — an act receives these too, so the destination
 * must follow the recipient's type and never be hard-coded to a venue.
 */
test('the same notice sends an ACT to the act dashboard', () => {
  assert.equal(
    notifDestination({
      type: 'availability_request',
      data: { enquiry_id: 66, recipient_type: 'artist' },
    }),
    '/industry/artist?section=enquiries&tab=INCOMING');
});

/**
 * ⛔⛔ THE READER RECEIVED THIS ASK — it is not an answer coming back. Reading
 * `applicant_type` would send the venue to the ENQUIRER's dashboard.
 */
test('it never routes by the applicant\'s type', () => {
  assert.equal(
    notifDestination({
      type: 'availability_request',
      data: { enquiry_id: 67, applicant_type: 'host', recipient_type: 'venue' },
    }),
    '/industry/venue?section=enquiries&tab=INCOMING');
});

/* ⚠ Rows written before `recipient_type` existed stay inert rather than
   guessing a dashboard — absent is not the same as wrong. */
test('a legacy row with no recipient type stays inert', () => {
  assert.equal(notifDestination({ type: 'availability_request', data: { enquiry_id: 58 } }), null);
});

/* ⚠ An event still wins when the enquiry names one — the more specific place. */
test('an availability enquiry that names an event opens the event', () => {
  assert.equal(
    notifDestination({
      type: 'availability_request',
      data: { enquiry_id: 68, recipient_type: 'venue', event_id: '11111111-2222-3333-4444-555555555555' },
    }),
    '/event/11111111-2222-3333-4444-555555555555');
});
