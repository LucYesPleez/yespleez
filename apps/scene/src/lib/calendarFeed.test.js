/**
 * THE FEED CORE'S CONTRACT — one user's commitments, one VCALENDAR, and the
 * boundaries that make it safe to hand a calendar client a capability URL.
 *
 * ⭐⭐ THE LAWS UNDER TEST:
 *   1. The feed is built by the SAME chain as the app (resolveSchedule →
 *      calendarEventsBySlot), so a set's UID and wall-clock time here are
 *      byte-identical to the one-off download's.
 *   2. Master OFF and unknown token serve NO events — and turning a category
 *      off removes exactly that category.
 *   3. Private material (notes, fees) NEVER appears in the output, even when
 *      a payload row carries it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  feedEvents, feedCalendar, mergeCategories, untouchedCategories, CALENDAR_CATEGORIES,
  calendarFeedUrl, calendarWebcalUrl,
} from './calendarFeed.js';
import { slotUid, icsUid, venueLocation, buildCalendar, eventCalendarEvent } from './calendarEvent.js';

const NOW = new Date(Date.UTC(2026, 8, 1, 2, 0, 0));

/* ── fixtures — the RPC payload's shapes ───────────────────────────── */
const slotRow = (id, position, time, ampm, dur = 60) =>
  ({ id, event_id: 'ev-1', day_index: 0, day_name: '', position, time, ampm, dur_mins: dur, label: null, stage_id: null });

function gigFixture(overrides = {}) {
  return {
    event: {
      id: 'ev-1', name: 'Solstice Gathering', updated_at: '2026-08-20T10:00:00Z',
      config: { date: '2026-08-29', venue: 'Bellingen Memorial Hall' },
    },
    venue: {
      id: 'vp-1', name: 'Bellingen Memorial Hall',
      location: '32 Hyde St, Bellingen, NSW, 2454', suburb: 'Bellingen', state: 'NSW', postcode: '2454',
    },
    slots: [slotRow('slot-a', 0, '9:00', 'PM', 60), slotRow('slot-b', 1, '10:00', 'PM', 90)],
    stages: [],
    members: [{ id: 'm-1', artist_id: 'user-1', artist_profile_id: 'prof-1', artist_name: 'Karioke Kev' }],
    performances: [{ id: 'p-1', lineup_member_id: 'm-1', slot_uuid: 'slot-a', status: 'accepted', updated_at: '2026-08-21T10:00:00Z' }],
    ...overrides,
  };
}

const payload = (overrides = {}) => ({
  found: true, enabled: true, categories: {},
  gigs: [gigFixture()], attending: [], bookings: [], deadlines: [],
  ...overrides,
});

const enquiry = (overrides = {}) => ({
  enquiry: {
    id: 42, status: 'accepted', date_requested: '2026-09-12', respond_by: null,
    event_id: null, proposed_time: null, set_duration: null, created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  },
  venue: { name: 'The Federal Hotel', suburb: 'Bellingen', state: 'NSW' },
});

/* ── the master switch and unknown tokens ──────────────────────────── */

test('⛔ a disabled feed and an unknown token both project NOTHING', () => {
  assert.deepEqual(feedEvents({ found: true, enabled: false }), []);
  assert.deepEqual(feedEvents({ found: false }), []);
  assert.deepEqual(feedEvents(null), []);
  const ics = feedCalendar({ found: true, enabled: false }, { now: NOW });
  assert.ok(ics.includes('BEGIN:VCALENDAR'), 'disabled still serves a VALID calendar');
  assert.ok(!ics.includes('BEGIN:VEVENT'), 'with zero events, so clients clear their items');
});

/* ── the set projection rides the app's own chain ──────────────────── */

test('⭐⭐ my accepted set appears with the SAME slot UID and wall time as the download', () => {
  const evs = feedEvents(payload());
  const set = evs.find(e => e.uid === slotUid('slot-a'));
  assert.ok(set, 'the accepted set is projected');
  assert.equal(set.uid, 'yespleez-slot-slot-a@yespleez.com');
  assert.equal(set.dtstart, '20260829T210000');
  assert.equal(set.dtend, '20260829T220000');
  assert.equal(set.summary, 'Karioke Kev at Solstice Gathering');
});

test('⛔ a slot nobody accepted projects no set — the other slot stays out', () => {
  const evs = feedEvents(payload());
  assert.ok(!evs.some(e => e.uid === slotUid('slot-b')), 'slot-b has no performance and must not appear');
});

test('⛔ an offered or draft performance is not a commitment', () => {
  for (const status of ['offered', 'draft', 'declined']) {
    const p = payload({ gigs: [gigFixture({ performances: [{ id: 'p-1', lineup_member_id: 'm-1', slot_uuid: 'slot-a', status }] })] });
    assert.ok(!feedEvents(p).some(e => e.uid === slotUid('slot-a')), status);
  }
});

test('⭐ a moved set time updates the SAME UID, never a new identity', () => {
  const before = feedEvents(payload()).find(e => e.uid === slotUid('slot-a'));
  const moved = payload({ gigs: [gigFixture({ slots: [slotRow('slot-a', 0, '11:30', 'PM', 60)] })] });
  const after = feedEvents(moved).find(e => e.uid === slotUid('slot-a'));
  assert.equal(after.uid, before.uid);
  assert.notEqual(after.dtstart, before.dtstart);
  assert.equal(after.dtstart, '20260829T233000');
});

test('⭐ cancellation is expressed by omission — a removed booking leaves the feed', () => {
  const evs = feedEvents(payload({ gigs: [] }));
  assert.deepEqual(evs, [], 'no rows, no events; the subscribed client then clears them');
});

/* ── the whole-day projections ─────────────────────────────────────── */

test('a gig event is a whole-day item with an EXCLUSIVE DTEND', () => {
  const ev = feedEvents(payload()).find(e => e.uid === icsUid('gig', 'ev-1'));
  assert.ok(ev, 'the on-bill event is projected');
  assert.equal(ev.allDay, true);
  assert.equal(ev.dtstart, '20260829');
  assert.equal(ev.dtend, '20260830');
  assert.equal(ev.summary, 'Solstice Gathering (performing)');
  const ics = feedCalendar(payload(), { now: NOW });
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260829'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20260830'));
});

test('a multi-day festival spans its dates; a backwards endDate is ignored', () => {
  const ev = eventCalendarEvent({ event: { id: 'e', name: 'Fest', config: { date: '2026-08-28', endDate: '2026-08-30' } }, kind: 'gig' });
  assert.equal(ev.dtstart, '20260828');
  assert.equal(ev.dtend, '20260831', 'exclusive end: the 30th is INCLUDED');
  const bad = eventCalendarEvent({ event: { id: 'e', name: 'Fest', config: { date: '2026-08-28', endDate: '2026-08-20' } } });
  assert.equal(bad.dtend, '20260829', 'a backwards endDate must not eat the event');
});

test('attending appears once, and performing beats attending on the same event', () => {
  const p = payload({
    attending: [
      { event: { id: 'ev-1', name: 'Solstice Gathering', config: { date: '2026-08-29' } } },
      { event: { id: 'ev-2', name: 'Other Night', config: { date: '2026-09-05' } } },
    ],
  });
  const evs = feedEvents(p);
  assert.ok(evs.some(e => e.uid === icsUid('event', 'ev-2')), 'the saved event appears');
  assert.ok(!evs.some(e => e.uid === icsUid('event', 'ev-1')), 'the gig I also saved appears as the gig only');
  assert.ok(evs.some(e => e.uid === icsUid('gig', 'ev-1')));
});

/* ── enquiry bookings and deadlines ────────────────────────────────── */

test('an accepted enquiry is a booked night; proposed_time makes it a timed one', () => {
  const allDay = feedEvents(payload({ bookings: [enquiry()] }))
    .find(e => e.uid === icsUid('booking', 42));
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.dtstart, '20260912');
  assert.equal(allDay.summary, 'Gig at The Federal Hotel');

  const timed = feedEvents(payload({ bookings: [enquiry({ proposed_time: '19:30:00', set_duration: 90 })] }))
    .find(e => e.uid === icsUid('booking', 42));
  assert.equal(timed.allDay, undefined);
  assert.equal(timed.dtstart, '20260912T193000');
  assert.equal(timed.dtend, '20260912T210000');
});

test('a respond-by deadline projects; an enquiry without one does not', () => {
  const withDeadline = enquiry({ status: 'pending', respond_by: '2026-09-05' });
  const without = enquiry({ id: 43, status: 'pending', respond_by: null });
  const evs = feedEvents(payload({ deadlines: [withDeadline, without] }));
  const d = evs.find(e => e.uid === icsUid('deadline', 42));
  assert.ok(d, 'the deadline appears');
  assert.equal(d.allDay, true);
  assert.equal(d.dtstart, '20260905');
  assert.equal(d.summary, 'Respond to The Federal Hotel enquiry');
  assert.ok(!evs.some(e => e.uid === icsUid('deadline', 43)), 'no respond_by, no deadline');
});

/* ── categories ────────────────────────────────────────────────────── */

test('⭐ each category switch removes exactly its own items', () => {
  const full = payload({
    attending: [{ event: { id: 'ev-2', name: 'Other Night', config: { date: '2026-09-05' } } }],
    bookings: [enquiry()],
    deadlines: [enquiry({ id: 77, status: 'pending', respond_by: '2026-09-05' })],
  });
  const all = feedEvents(full);
  assert.ok(all.some(e => e.uid.startsWith('yespleez-slot-')));
  assert.ok(all.some(e => e.uid.startsWith('yespleez-gig-')));
  assert.ok(all.some(e => e.uid.startsWith('yespleez-event-')));
  assert.ok(all.some(e => e.uid.startsWith('yespleez-booking-')));
  assert.ok(all.some(e => e.uid.startsWith('yespleez-deadline-')));

  const noSets = feedEvents({ ...full, categories: { sets: false } });
  assert.ok(!noSets.some(e => e.uid.startsWith('yespleez-slot-')));
  assert.ok(noSets.some(e => e.uid.startsWith('yespleez-gig-')), 'bookings stay when only sets is off');

  const noBookings = feedEvents({ ...full, categories: { bookings: false } });
  assert.ok(!noBookings.some(e => e.uid.startsWith('yespleez-gig-')));
  assert.ok(!noBookings.some(e => e.uid.startsWith('yespleez-booking-')));
  assert.ok(noBookings.some(e => e.uid.startsWith('yespleez-slot-')), 'sets stay when bookings is off');

  const noDeadlines = feedEvents({ ...full, categories: { deadlines: false } });
  assert.ok(!noDeadlines.some(e => e.uid.startsWith('yespleez-deadline-')));
});

test('mergeCategories answers for every registry key, and an explicit false is honoured', () => {
  const merged = mergeCategories({ artist_deadlines: false });
  assert.equal(merged.artist_deadlines, false);
  assert.deepEqual(Object.keys(mergeCategories()).sort(), CALENDAR_CATEGORIES.map(c => c.key).sort());
});

test('⭐⭐ F1 · A CATEGORY NEW IN 2A IS OFF UNTIL IT IS ASKED FOR', () => {
  /* ⛔⛔ A subscribed calendar is REPLACED on every poll, so a category that
     arrived switched ON would push entries into a real diary unbidden. */
  const fresh = mergeCategories({});
  for (const k of ['diary', 'punter_doors',
                   'host_events', 'host_settimes',
                   'venue_events', 'venue_settimes', 'venue_bookings']) {
    assert.equal(fresh[k], false, `${k} must be OFF for an untouched account`);
  }
});

test('⭐⭐ F1 · AND THE CAL1 CATEGORIES STAY ON — silent CONTRACTION is the same bug', () => {
  /* The four artist keys and `attending` are CAL1's shipped categories under
     role-scoped names. Defaulting them OFF would empty every existing
     subscriber's calendar. */
  const fresh = mergeCategories({});
  for (const k of ['attending', 'artist_playing', 'artist_sets', 'artist_bookings', 'artist_deadlines']) {
    assert.equal(fresh[k], true, `${k} is a CAL1 category and must stay ON`);
  }
});

test('⭐ an explicit ON for a new category survives — ⛔ the default must not spring back', () => {
  assert.equal(mergeCategories({ venue_events: true }).venue_events, true);
  assert.equal(mergeCategories({ diary: true }).diary, true);
  /* and turning it back off is honoured too */
  assert.equal(mergeCategories({ diary: false }).diary, false);
  /* ⛔ enabling one must not enable its neighbours */
  assert.equal(mergeCategories({ venue_events: true }).venue_settimes, false);
});

test('untouchedCategories names only what the reader has never answered for', () => {
  const u = untouchedCategories({ venue_events: true, sets: false });
  assert.ok(!u.includes('venue_events'), 'explicitly set');
  assert.ok(!u.includes('artist_sets'), 'answered via its CAL1 predecessor');
  assert.ok(u.includes('diary'), 'never answered');
  assert.deepEqual(untouchedCategories({}).sort(), CALENDAR_CATEGORIES.map(c => c.key).sort());
});

test('⭐⭐ a PRE-2A stored preference still switches off what it always did', () => {
  /* ⛔⛔ Absence means ON, so only an explicit false carries information —
     dropping the old keys would silently turn every deliberate OFF back ON. */
  assert.equal(mergeCategories({ sets: false }).artist_sets, false);
  assert.equal(mergeCategories({ deadlines: false }).artist_deadlines, false);
  assert.equal(mergeCategories({ attending: false }).attending, false);
  /* ⚠ The old `bookings` covered TWO of the new questions. */
  const b = mergeCategories({ bookings: false });
  assert.equal(b.artist_playing, false);
  assert.equal(b.artist_bookings, false);
  /* ⛔ and it must not reach beyond what it used to control */
  assert.equal(b.artist_sets, true, 'a CAL1 sibling it never governed stays ON');
  /* ⚠ These are 2A categories, so they are OFF by their own default rather
     than by the legacy key — the legacy key must not be what decides them. */
  assert.equal(b.venue_bookings, false);
  assert.equal(b.host_settimes, false);
  assert.equal(mergeCategories({ bookings: true }).venue_bookings, false,
    'a legacy ON must not switch on a category it never governed');
});

test('a new-key setting wins and legacy keys never resurrect an explicit OFF', () => {
  assert.equal(mergeCategories({ sets: false, artist_sets: false }).artist_sets, false);
  assert.equal(mergeCategories({ venue_events: false }).venue_events, false);
});

/* ── privacy ───────────────────────────────────────────────────────── */

test('⛔⛔ notes and fees NEVER reach the calendar, even when a row carries them', () => {
  const leaky = enquiry({ note: 'They will do it for $350 mates rates', proposed_fee: '$350' });
  const ics = feedCalendar(payload({ bookings: [leaky], deadlines: [] }), { now: NOW });
  assert.ok(!ics.includes('350'), 'the fee must not appear anywhere');
  assert.ok(!ics.includes('mates rates'), 'the note must not appear anywhere');
});

test('⛔ a withheld location exports no LOCATION on any projection', () => {
  const secret = gigFixture();
  secret.event = { ...secret.event, config: { ...secret.event.config, locationWithheld: true } };
  const ics = feedCalendar(payload({ gigs: [secret] }), { now: NOW });
  assert.ok(!ics.includes('LOCATION'), 'no LOCATION lines at all');
  assert.ok(!ics.includes('Hyde St'), 'the address is nowhere in the file');
});

/* ── the LOCATION duplication fix ──────────────────────────────────── */

test('⭐ an address that already contains the suburb is not doubled', () => {
  const ics = feedCalendar(payload(), { now: NOW });
  const line = ics.split('\r\n').map((l, i, a) =>
    l.startsWith('LOCATION') ? l + (a[i + 1]?.startsWith(' ') ? a[i + 1].slice(1) : '') : null)
    .find(Boolean);
  assert.ok(line.includes('Bellingen Memorial Hall'));
  assert.equal((line.match(/Bellingen/g) || []).length, 2, 'venue name + region only — the address is truncated at the suburb');
  assert.ok(!/NSW.*NSW/.test(line), 'the state appears once');
});

test('venueLocation keeps a clean address intact', () => {
  assert.equal(
    venueLocation({ name: 'The Hall', address: '1 Main St', locality: 'Bellingen', state: 'NSW', postcode: null, withheld: false }),
    'The Hall, 1 Main St, Bellingen, NSW'
  );
  assert.equal(venueLocation({ name: 'X', withheld: true }), null);
});

/* ── the calendar wrapper and URLs ─────────────────────────────────── */

test('the feed is one valid VCALENDAR with a name, CRLF throughout', () => {
  const ics = feedCalendar(payload(), { now: NOW });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes('X-WR-CALNAME:YesPleez'));
  assert.equal((ics.match(/BEGIN:VCALENDAR/g) || []).length, 1, 'one calendar, many events');
  for (const piece of ics.split('\r\n')) {
    assert.ok(!piece.includes('\n') && !piece.includes('\r'), 'no bare line breaks');
  }
});

test('buildCalendar skips a broken projection rather than emitting a half event', () => {
  const ics = buildCalendar([{ uid: 'x@y' }, null], { now: NOW });
  assert.ok(!ics.includes('BEGIN:VEVENT'));
});

test('the subscription URLs are the printed origin, https and webcal', () => {
  assert.equal(calendarFeedUrl('t-1'), 'https://yespleez.com/calendar/feed?token=t-1');
  assert.equal(calendarWebcalUrl('t-1'), 'webcal://yespleez.com/calendar/feed?token=t-1');
});
