/**
 * PHASE 2A — THE ROLE-AWARE CALENDAR.
 *
 * ⭐⭐ THE LAWS UNDER TEST:
 *   1. The ROLE is the scope. "My events" is never ambiguous: an event I
 *      play at, host, own the room for and saved is ONE entry, not four.
 *   2. Roles come from PROFILES, ⛔ never from activity.
 *   3. Two roles on one account configure INDEPENDENTLY — neither toggle
 *      can switch the other off.
 *   4. ⛔⛔ No private enquiry field (note, proposed_fee) ever reaches the
 *      feed, from either side of the enquiry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  feedEvents, feedCalendar, mergeCategories, rolesForAccount,
  categoriesForRole, CALENDAR_CATEGORIES, CALENDAR_ROLES, QUESTIONS,
} from './calendarFeed.js';
import { icsUid } from './calendarEvent.js';

const NOW = new Date(Date.UTC(2026, 8, 2, 0, 0, 0));

const slotRow = (id, position, time, ampm, dur = 60) =>
  ({ id, event_id: 'ev-1', day_index: 0, day_name: '', position, time, ampm, dur_mins: dur, stage_id: null });

/** The gig/hosting/venue payload shape the RPC returns. */
function eventBundle({ id = 'ev-1', name = 'Solstice', date = '2026-08-29', members = [], performances = [], slots = null, booked = null, cfg = {} } = {}) {
  return {
    event: { id, name, config: { date, ...cfg }, updated_at: '2026-08-20T10:00:00Z' },
    venue: { id: 'vp-1', name: 'The Hall', location: '1 Main St', suburb: 'Bellingen', state: 'NSW' },
    slots: slots || [slotRow('slot-a', 0, '9:00', 'PM', 60)],
    stages: [],
    members,
    performances,
    ...(booked ? { booked } : {}),
  };
}

const ME = { id: 'm-1', artist_id: 'u-1', artist_profile_id: 'p-artist', artist_name: 'Lucious' };
const OTHER = { id: 'm-2', artist_id: 'u-9', artist_profile_id: 'p-other', artist_name: 'Someone Else' };
const accepted = (memberId, slot) => ({ id: `perf-${memberId}`, lineup_member_id: memberId, slot_uuid: slot, status: 'accepted' });

const base = (over = {}) => ({
  found: true, enabled: true, categories: {},
  profile_types: ['punter', 'artist', 'host', 'venue'],
  gigs: [], attending: [], bookings: [], deadlines: [],
  diary: [], hosting: [], venue_events: [], venue_bookings: [],
  ...over,
});

/* ── role resolution ───────────────────────────────────────────────── */

test('⭐ roles come from PROFILE TYPES, and common is always present', () => {
  assert.deepEqual(rolesForAccount(['punter']).map(r => r.key), ['common', 'punter']);
  assert.deepEqual(rolesForAccount(['punter', 'venue']).map(r => r.key), ['common', 'punter', 'venue']);
  /* band and standup are artists for calendar purposes */
  assert.ok(rolesForAccount(['band']).some(r => r.key === 'artist'));
  assert.ok(rolesForAccount(['standup']).some(r => r.key === 'artist'));
  /* ⛔ an account with no profiles still gets the common categories */
  assert.deepEqual(rolesForAccount([]).map(r => r.key), ['common']);
});

test('⛔ a role is NEVER inferred from activity — only from a held profile', () => {
  /* This payload is full of artist activity, but the account holds only a
     punter profile. It must not gain an Artist chip. */
  const roles = rolesForAccount(['punter']);
  assert.ok(!roles.some(r => r.key === 'artist'));
  assert.ok(!roles.some(r => r.key === 'venue'));
});

test('every category belongs to a declared role and answers one of the four questions', () => {
  const roleKeys = new Set(CALENDAR_ROLES.map(r => r.key));
  for (const c of CALENDAR_CATEGORIES) {
    assert.ok(roleKeys.has(c.role), `${c.key} has unknown role ${c.role}`);
    assert.ok(QUESTIONS[c.question], `${c.key} has unknown question ${c.question}`);
  }
  assert.ok(categoriesForRole('venue').length >= 3);
  assert.equal(categoriesForRole('nope').length, 0);
});

/* ── per-role projection ───────────────────────────────────────────── */

test('PUNTER · saved events are whole-day, and become timed only when doors are on', () => {
  const p = base({ attending: [eventBundle({ id: 'ev-9', name: 'Open Mic', cfg: { time: '7:30', ampm: 'PM' } })] });

  const allDay = feedEvents({ ...p, categories: { punter_doors: false } })
    .find(e => e.uid === icsUid('event', 'ev-9'));
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.dtstart, '20260829');

  const timed = feedEvents(p).find(e => e.uid === icsUid('event', 'ev-9'));
  assert.equal(timed.allDay, undefined);
  assert.equal(timed.dtstart, '20260829T193000');
  assert.equal(timed.dtend, null, 'nothing says when an event ENDS, so no end is invented');
});

test('⛔ PUNTER never gets an invented act time — only the organiser\'s own start', () => {
  /* A saved event with NO start time keeps its whole-day shape even with
     doors on, and ⛔ does not borrow the first set time from the schedule. */
  const p = base({
    attending: [eventBundle({ id: 'ev-9', slots: [slotRow('s', 0, '9:00', 'PM')], cfg: {} })],
    categories: { punter_doors: true },
  });
  const ev = feedEvents(p).find(e => e.uid === icsUid('event', 'ev-9'));
  assert.equal(ev.allDay, true);
});

test('ARTIST · playing, set times, bookings and deadlines each project', () => {
  const p = base({
    gigs: [eventBundle({ members: [ME], performances: [accepted('m-1', 'slot-a')] })],
    bookings: [{ enquiry: { id: 5, status: 'accepted', date_requested: '2026-09-12' }, venue: { name: 'Fed' } }],
    deadlines: [{ enquiry: { id: 6, status: 'pending', respond_by: '2026-09-05' }, venue: { name: 'Fed' } }],
  });
  const evs = feedEvents(p);
  assert.ok(evs.some(e => e.uid === icsUid('gig', 'ev-1')), "what's on");
  assert.ok(evs.some(e => e.uid === icsUid('slot', 'slot-a')), "when I'm needed");
  assert.ok(evs.some(e => e.uid === icsUid('booking', 5)), 'committed');
  assert.ok(evs.some(e => e.uid === icsUid('deadline', 6)), 'waiting on me');
});

test('HOST · events I host, their running order, and acts I booked', () => {
  const p = base({
    hosting: [eventBundle({
      id: 'ev-h', name: 'My Night',
      members: [OTHER], performances: [accepted('m-2', 'slot-a')],
      booked: [{ enquiry: { id: 77, status: 'accepted', date_requested: '2026-08-29' }, venue: { name: 'The Hall' } }],
    })],
  });
  const evs = feedEvents(p);
  const on = evs.find(e => e.uid === icsUid('hosting', 'ev-h'));
  assert.ok(on, "what's on");
  assert.match(on.summary, /hosting/);
  /* ⭐ the host's running order is the OTHER act's set — same projection */
  const slot = evs.find(e => e.uid === icsUid('slot', 'slot-a'));
  assert.ok(slot, "when I'm needed");
  assert.match(slot.summary, /Someone Else/);
  assert.ok(evs.some(e => e.uid === icsUid('booking', 77)), 'committed');
});

test('VENUE · events at my venue, my running order, my confirmed bookings', () => {
  const p = base({
    venue_events: [eventBundle({ id: 'ev-v', name: 'Friday', members: [OTHER], performances: [accepted('m-2', 'slot-a')] })],
    venue_bookings: [{ enquiry: { id: 88, status: 'booked', date_requested: '2026-09-01' }, venue: { name: 'The Hall' } }],
  });
  const evs = feedEvents(p);
  const on = evs.find(e => e.uid === icsUid('venue', 'ev-v'));
  assert.ok(on, "what's on");
  assert.match(on.summary, /at my venue/);
  assert.ok(evs.some(e => e.uid === icsUid('slot', 'slot-a')), "when I'm needed");
  assert.ok(evs.some(e => e.uid === icsUid('booking', 88)), 'committed');
});

test('COMMON · the diary projects, timed or whole-day, and carries its own note', () => {
  const p = base({
    diary: [
      { id: 'd1', title: 'Rehearsal', event_date: '2026-09-03', time_start: '6:00pm', notes: 'bring the SP404' },
      { id: 'd2', title: 'Day off', event_date: '2026-09-04' },
    ],
  });
  const evs = feedEvents(p);
  const timed = evs.find(e => e.uid === icsUid('diary', 'd1'));
  assert.equal(timed.dtstart, '20260903T180000');
  assert.equal(timed.summary, 'Rehearsal');
  assert.equal(timed.description, 'bring the SP404');
  const day = evs.find(e => e.uid === icsUid('diary', 'd2'));
  assert.equal(day.allDay, true);
  assert.equal(day.dtstart, '20260904');
});

/* ── the thing the role model exists to fix ────────────────────────── */

test('⭐⭐ ONE NIGHT, ONE ENTRY — playing at, hosting, owning the room, and saved', () => {
  const bundle = () => eventBundle({ id: 'ev-1', members: [ME], performances: [accepted('m-1', 'slot-a')] });
  const p = base({
    gigs: [bundle()],
    hosting: [bundle()],
    venue_events: [bundle()],
    attending: [bundle()],
  });
  const evs = feedEvents(p);
  const eventLevel = evs.filter(e => e.eventId === 'ev-1');
  assert.equal(eventLevel.length, 1, 'four roles, one banner');
  assert.equal(eventLevel[0].uid, icsUid('gig', 'ev-1'), 'the artist reading wins — the most personal claim');
  const slots = evs.filter(e => e.uid === icsUid('slot', 'slot-a'));
  assert.equal(slots.length, 1, 'one slot is one instant, however many roles see it');
});

/* ── independence ──────────────────────────────────────────────────── */

test('⭐⭐ TWO ROLES ON ONE ACCOUNT CONFIGURE INDEPENDENTLY', () => {
  const p = base({
    gigs: [eventBundle({ id: 'ev-a', members: [ME], performances: [accepted('m-1', 'slot-a')] })],
    venue_events: [eventBundle({ id: 'ev-v', members: [OTHER], performances: [] })],
  });
  /* venue off must not touch artist */
  const artistOnly = feedEvents({ ...p, categories: { venue_events: false, venue_settimes: false, venue_bookings: false } });
  assert.ok(artistOnly.some(e => e.uid === icsUid('gig', 'ev-a')));
  assert.ok(!artistOnly.some(e => e.uid === icsUid('venue', 'ev-v')));

  /* artist off must not touch venue */
  const venueOnly = feedEvents({ ...p, categories: { artist_playing: false, artist_sets: false } });
  assert.ok(!venueOnly.some(e => e.uid === icsUid('gig', 'ev-a')));
  assert.ok(venueOnly.some(e => e.uid === icsUid('venue', 'ev-v')));
});

test('each role toggle removes only its own items', () => {
  const p = base({
    gigs: [eventBundle({ id: 'ev-a', members: [ME], performances: [accepted('m-1', 'slot-a')] })],
    hosting: [eventBundle({ id: 'ev-h', members: [OTHER], performances: [] })],
    venue_events: [eventBundle({ id: 'ev-v', members: [OTHER], performances: [] })],
    diary: [{ id: 'd1', title: 'X', event_date: '2026-09-03' }],
  });
  const full = feedEvents(p);
  for (const [key, uid] of [
    ['host_events', icsUid('hosting', 'ev-h')],
    ['venue_events', icsUid('venue', 'ev-v')],
    ['diary', icsUid('diary', 'd1')],
    ['artist_playing', icsUid('gig', 'ev-a')],
  ]) {
    assert.ok(full.some(e => e.uid === uid), `${uid} present when all on`);
    const off = feedEvents({ ...p, categories: { [key]: false } });
    assert.ok(!off.some(e => e.uid === uid), `${key} off removes ${uid}`);
    assert.ok(off.length === full.length - 1, `${key} off removes exactly one item`);
  }
});

/* ── security ──────────────────────────────────────────────────────── */

test('⛔⛔ no private enquiry field reaches the feed, from EITHER side', () => {
  const leak = { note: 'they will take $300 cash', proposed_fee: '$300' };
  const p = base({
    bookings: [{ enquiry: { id: 5, status: 'accepted', date_requested: '2026-09-12', ...leak }, venue: { name: 'Fed' } }],
    venue_bookings: [{ enquiry: { id: 88, status: 'booked', date_requested: '2026-09-01', ...leak }, venue: { name: 'The Hall' } }],
    hosting: [eventBundle({ id: 'ev-h', booked: [{ enquiry: { id: 77, status: 'accepted', date_requested: '2026-08-29', ...leak }, venue: { name: 'The Hall' } }] })],
  });
  const ics = feedCalendar(p, { now: NOW });
  assert.ok(!ics.includes('300'), 'no fee anywhere');
  assert.ok(!ics.includes('cash'), 'no note anywhere');
});

test('⛔ master OFF still serves a valid empty calendar with every role populated', () => {
  const p = base({
    enabled: false,
    gigs: [eventBundle()], hosting: [eventBundle({ id: 'h' })],
    venue_events: [eventBundle({ id: 'v' })], diary: [{ id: 'd', title: 'X', event_date: '2026-09-03' }],
  });
  assert.deepEqual(feedEvents(p), []);
  const ics = feedCalendar(p, { now: NOW });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(!ics.includes('BEGIN:VEVENT'));
});

test('every new projection keeps CRLF, stable UIDs and a valid wrapper', () => {
  const p = base({
    hosting: [eventBundle({ id: 'ev-h', members: [OTHER], performances: [accepted('m-2', 'slot-a')] })],
    venue_events: [eventBundle({ id: 'ev-v' })],
    diary: [{ id: 'd1', title: 'Rehearsal; bring, gear\\stuff', event_date: '2026-09-03' }],
  });
  const a = feedCalendar(p, { now: NOW });
  const b = feedCalendar(p, { now: NOW });
  assert.equal(a, b, 'same input, same output — UIDs are deterministic');
  assert.ok(a.endsWith('END:VCALENDAR\r\n'));
  for (const piece of a.split('\r\n')) {
    assert.ok(!piece.includes('\n'), 'no bare line breaks');
  }
  assert.ok(a.includes('SUMMARY:Rehearsal\\; bring\\, gear\\\\stuff'), 'diary text is escaped');
});
