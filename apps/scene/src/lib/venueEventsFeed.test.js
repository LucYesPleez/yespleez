/**
 * THE PUBLIC VENUE EVENTS FEED — the publication rules and the projection.
 *
 * ⚠ The fixtures are shaped on REAL live rows for The Federal Hotel, Bellingen
 * (venue profile 55c3728c…): a Studio import carrying `date_evidence`, a
 * host-authored night carrying `days`/`slots` and `host_controls_config`, and a
 * config `venue` string with a trailing space. Those are the exact fields that
 * must not leave, so the test is worth no more than the realism of the row it
 * is given.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  venueEventsPayload,
  publicEvent,
  publicVenue,
  publicEventUrl,
  isPubliclyListable,
  isUpcoming,
  PUBLIC_EVENT_FIELDS,
  PUBLIC_VENUE_FIELDS,
  DESCRIPTION_MAX,
  MAX_LIMIT,
  VENUE_PROFILE_TYPE,
} from './venueEventsFeed.js';

const TODAY = '2026-09-04';
const VENUE_ID = '55c3728c-9542-4ca6-94fa-62f3cb6cffa5';

/** The venue profile row, as PostgREST returns it for FEED_VENUE_SELECT. */
const VENUE = {
  id: VENUE_ID,
  name: 'The Federal Hotel',
  type: 'venue',
  suburb: 'Bellingen',
  location: '77 Hyde St',      // ⚠ a venue keeps its STREET ADDRESS here
  state: 'NSW',
};

/**
 * An event row with everything a real one carries — including the parts that
 * must never be published.
 */
function ev(over = {}, cfg = {}) {
  return {
    id: over.id || 'ev-1',
    name: 'The Friday Mix Up feat Danger Waves',
    status: 'live',
    is_public: true,
    venue_profile_id: VENUE_ID,
    ...over,
    config: {
      date: '2026-09-11',
      time: '8:30',
      ampm: 'PM',
      venue: 'The Federal Hotel ',            // trailing space, as stored
      bio: 'Deep disco, funk and house in the old TAB room.',
      poster: 'https://cdn.example/poster.jpg',
      cover: 'https://cdn.example/cover.jpg',
      /* ── none of the following may ever appear in the feed ── */
      days: [{ name: 'Night one', slots: [{ artist: 'Undisclosed Support Act', time: '9:00' }] }],
      host_controls_config: { privateSetTimes: true, artistsCanRemove: true },
      date_evidence: 'Inferred from the poster; August 1st is a Saturday in 2026.',
      applications_open: true,
      fee: 350,
      agreed_fee: 350,
      notes: 'Pays cash after the door count.',
      ...cfg,
    },
  };
}

/* ── A · eligible upcoming events ──────────────────────────────────────────── */

test('a valid public venue returns its eligible upcoming events, soonest first', () => {
  const out = venueEventsPayload({
    venue: VENUE,
    today: TODAY,
    events: [
      ev({ id: 'later' }, { date: '2026-09-19' }),
      ev({ id: 'today' }, { date: TODAY }),
      ev({ id: 'soon' }, { date: '2026-09-11' }),
    ],
  });
  assert.deepEqual(out.events.map(e => e.id), ['today', 'soon', 'later']);
  assert.equal(out.venue.id, VENUE_ID);
  assert.equal(out.venue.name, 'The Federal Hotel');
});

test('TODAY\'S event is upcoming — a gig tonight is the most useful row on the page', () => {
  assert.equal(isUpcoming(ev({}, { date: TODAY }), TODAY), true);
});

test('a past event is gone, and a multi-day one stays while it is still running', () => {
  assert.equal(isUpcoming(ev({}, { date: '2026-09-03' }), TODAY), false);
  /* ⭐ RANGE OVERLAP, ⛔ not a start-date comparison — the defect eventDays.js
     exists to end: a Fri–Sun festival vanished from the guide on the Saturday. */
  assert.equal(isUpcoming(ev({}, { date: '2026-09-02', endDate: '2026-09-06' }), TODAY), true);
});

test('an undated row is never listed — a gig guide cannot advertise "sometime"', () => {
  assert.equal(isUpcoming(ev({}, { date: undefined }), TODAY), false);
  const out = venueEventsPayload({ venue: VENUE, today: TODAY, events: [ev({ id: 'x' }, { date: undefined })] });
  assert.deepEqual(out.events, []);
});

test('another venue\'s events are not served under this venue\'s id', () => {
  const other = ev({ id: 'elsewhere', venue_profile_id: '11111111-2222-3333-4444-555555555555' });
  const out = venueEventsPayload({ venue: VENUE, today: TODAY, events: [other] });
  assert.deepEqual(out.events, []);
});

/* ── E · the publication rules, and only the publication rules ─────────────── */

test('⛔ a PRIVATE event is excluded (is_public = false)', () => {
  assert.equal(isPubliclyListable(ev({ is_public: false })), false);
  const out = venueEventsPayload({ venue: VENUE, today: TODAY, events: [ev({ id: 'p', is_public: false })] });
  assert.deepEqual(out.events, []);
});

test('⛔ an UNPUBLISHED or withdrawn event is excluded — the host flipping it back to draft IS the removal', () => {
  /* There is no separate "cancelled" event status in this schema. Taking a
     night down means `status` leaves 'live' — the same act that removes it from
     What's On, Discover and the venue's own page. ⛔ A second, website-only
     switch is exactly what must not exist. */
  for (const status of ['draft', 'completed', 'cancelled', null, undefined]) {
    assert.equal(isPubliclyListable(ev({ status })), false, String(status));
    const out = venueEventsPayload({ venue: VENUE, today: TODAY, events: [ev({ id: 's', status })] });
    assert.deepEqual(out.events, [], String(status));
  }
});

test('⭐ is_public = NULL is PUBLIC — it means "written before the column existed"', () => {
  /* ⛔ `.eq('is_public', true)` here would silently hide every older event on
     the platform. useEvents.js says so; this is the same rule. */
  assert.equal(isPubliclyListable(ev({ is_public: null })), true);
  assert.equal(isPubliclyListable(ev({ is_public: undefined })), true);
});

/* ── D · what leaves, and what must never ──────────────────────────────────── */

test('⛔⛔ an event carries EXACTLY the declared public fields — no more, no fewer', () => {
  const out = venueEventsPayload({ venue: VENUE, today: TODAY, events: [ev()] });
  assert.deepEqual(Object.keys(out.events[0]).sort(), [...PUBLIC_EVENT_FIELDS].sort());
});

test('⛔⛔ the venue block carries EXACTLY the declared public fields', () => {
  const out = venueEventsPayload({ venue: VENUE, today: TODAY, events: [ev()] });
  assert.deepEqual(Object.keys(out.venue).sort(), [...PUBLIC_VENUE_FIELDS].sort());
});

test('⛔⛔ no lineup, host control, fee, note, enquiry or importer field survives the projection', () => {
  const out = venueEventsPayload({ venue: VENUE, today: TODAY, events: [ev()] });
  const serialised = JSON.stringify(out);
  for (const leak of [
    'slots', 'Undisclosed Support Act',       // an UNANNOUNCED LINEUP — SEC-2's whole subject
    'host_controls_config', 'privateSetTimes',
    'date_evidence', 'Inferred from the poster',
    'applications_open',
    'fee', 'agreed_fee', '350',               // proposed / agreed money
    'notes', 'door count',                    // private notes
  ]) {
    assert.ok(!serialised.includes(leak), `"${leak}" reached the public feed`);
  }
  /* ⛔ And the raw blob itself is not smuggled through under any name. */
  assert.equal('config' in out.events[0], false);
  assert.equal('host_controls' in out.events[0], false);
  assert.equal('status' in out.events[0], false);
  assert.equal('is_public' in out.events[0], false);
  assert.equal('owner_profile_id' in out.events[0], false);
  assert.equal('host_id' in out.events[0], false);
});

test('⛔ a private PROFILE column cannot ride along on the venue block', () => {
  const withPii = {
    ...VENUE,
    email: 'publican@example.com',
    phone: '0400 000 000',
    emergency_name: 'Next of kin',
    emergency_phone: '0400 111 111',
    abn: '11 111 111 111',
    user_id: '99999999-9999-9999-9999-999999999999',
  };
  const out = venueEventsPayload({ venue: withPii, today: TODAY, events: [ev()] });
  const serialised = JSON.stringify(out);
  for (const leak of ['publican@example.com', '0400 000 000', 'Next of kin', '0400 111 111', '11 111 111 111', '99999999']) {
    assert.ok(!serialised.includes(leak), `"${leak}" reached the public feed`);
  }
});

test('⛔ the venue STREET ADDRESS is not published as its "location"', () => {
  /* On a venue profile `location` is the street address and `suburb` is the
     town — the inversion LocalsRails got wrong. The feed publishes the town. */
  const v = publicVenue(VENUE);
  assert.equal(v.town, 'Bellingen');
  assert.ok(!JSON.stringify(v).includes('Hyde St'));
});

/* ── the fields that DO leave ──────────────────────────────────────────────── */

test('the public fields carry the values a listing needs', () => {
  const e = publicEvent(ev(), { venueName: 'The Federal Hotel' });
  assert.equal(e.id, 'ev-1');
  assert.equal(e.name, 'The Friday Mix Up feat Danger Waves');
  assert.equal(e.date, '2026-09-11');
  assert.equal(e.end_date, null);
  assert.equal(e.start_time, '8:30pm');
  assert.equal(e.doors, null, 'no doors time was set, and absent stays absent');
  assert.equal(e.image, 'https://cdn.example/cover.jpg', 'the COVER wins on a card');
  assert.equal(e.description, 'Deep disco, funk and house in the old TAB room.');
  /* ⚠ From the PROFILE, ⛔ not from `config.venue` — which is "The Federal
     Hotel " with a trailing space on the live row. */
  assert.equal(e.venue_name, 'The Federal Hotel');
});

test('a doors time is published when one is set', () => {
  const e = publicEvent(ev({}, { doors: '7:00', doors_ampm: 'PM' }), {});
  assert.equal(e.doors, '7:00pm');
});

test('an end date is published only when it is genuinely after the start', () => {
  assert.equal(publicEvent(ev({}, { endDate: '2026-09-13' }), {}).end_date, '2026-09-13');
  assert.equal(publicEvent(ev({}, { endDate: '' }), {}).end_date, null);
  assert.equal(publicEvent(ev({}, { endDate: '2026-09-01' }), {}).end_date, null, 'backwards ranges are ignored, not honoured');
});

test('a long blurb is truncated, not summarised, and a blank one is absent', () => {
  const long = publicEvent(ev({}, { bio: 'x'.repeat(DESCRIPTION_MAX + 200) }), {});
  assert.ok(long.description.length <= DESCRIPTION_MAX);
  assert.ok(long.description.endsWith('…'));
  assert.equal(publicEvent(ev({}, { bio: '   ' }), {}).description, null);
});

/* ── event links point at the real public page ─────────────────────────────── */

test('⭐ every event links to the normal public YesPleez event page', () => {
  const out = venueEventsPayload({ venue: VENUE, today: TODAY, events: [ev({ id: 'ev-9' })] });
  assert.equal(out.events[0].url, 'https://yespleez.com/#/event/ev-9');
  /* ⚠ The `#` is HashRouter's and it is load bearing — App.jsx serves
     `/event/:id` under a hash router, so a link without it is a 404. */
  assert.equal(publicEventUrl('abc'), 'https://yespleez.com/#/event/abc');
  assert.ok(!out.events[0].url.includes('localhost'), 'an embed is never served the dev origin');
  assert.equal(out.venue.url, `https://yespleez.com/#/profile/${VENUE_ID}`);
});

/* ── invalid / unlistable venues ───────────────────────────────────────────── */

test('⛔ an unknown venue answers { venue: null, events: [] } and nothing else', () => {
  const out = venueEventsPayload({ venue: null, today: TODAY, events: [ev()] });
  assert.deepEqual(out, { venue: null, events: [] });
});

test('⛔⛔ a PERSONAL profile is never turned into a public venue page', () => {
  /* Personal (`type='punter'`) is system-generated, inalienable and NEVER
     publicly discoverable. There IS a live "Federal Hotel" punter profile, and
     an endpoint that takes a profile id from a stranger is exactly the surface
     that would publish one.

     ⚠ Asserted SEPARATELY from the type check below, even though `punter` is
     not `venue` and so is already covered. This property must survive whatever
     VENUE_PROFILE_TYPE becomes — it is a rule about the Personal profile, not
     an accident of which type this endpoint happens to accept today. */
  const personal = { id: 'e706a478-d942-439b-8c41-db7f8befed4e', name: 'Federal Hotel', type: 'punter' };
  assert.equal(publicVenue(personal), null);
  const out = venueEventsPayload({
    venue: personal,
    today: TODAY,
    events: [ev({ id: 'x', venue_profile_id: personal.id })],
  });
  assert.deepEqual(out, { venue: null, events: [] },
    'a Personal profile must not even confirm its own name');
});

test('⛔⛔ a HOST, ARTIST, BAND, STANDUP or FESTIVAL profile CANNOT be used as a venue', () => {
  /* ⭐ `?venue=` MEANS A VENUE. The live "The Federal Hotel" HOST profile
     (35fd60ab…) is the tempting wrong answer here: same name, same town, and it
     OWNS most of the venue's events (`owner_profile_id`). It is authority, not
     location — identity v1.3 O-R4, three concepts, three columns.

     ⛔ Public fields are not a licence to answer. Returning an artist's name and
     town under a key called `venue` would be a true value and a false claim,
     printed on somebody else's website.

     ⛔ And this is NOT a step towards a polymorphic location feed. A Festival or
     Host location contract gets designed on purpose, not by widening a type
     check until this endpoint quietly means four things. */
  assert.equal(VENUE_PROFILE_TYPE, 'venue');

  const federalHost = { id: '35fd60ab-f15c-467e-9e88-858397e1fdbd', name: 'The Federal Hotel', type: 'host', location: 'Bellingen', state: 'NSW' };
  assert.equal(publicVenue(federalHost), null);

  for (const type of ['host', 'artist', 'band', 'standup', 'festival', 'promoter', '', null, undefined]) {
    const profile = { ...VENUE, id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', type };
    assert.equal(publicVenue(profile), null, `type ${String(type)} resolved as a venue`);

    /* ⭐ And nothing rides along with the refusal: no events, and NOT THE NAME.
       Identical to the answer for an id that does not exist, so the endpoint
       cannot be asked "is this id real, and what type is it". */
    const out = venueEventsPayload({
      venue: profile,
      today: TODAY,
      events: [ev({ id: 'x', venue_profile_id: profile.id })],
    });
    assert.deepEqual(out, { venue: null, events: [] }, `type ${String(type)}`);
    assert.ok(!JSON.stringify(out).includes('Federal'), `type ${String(type)} leaked a name`);
  }
});

/* ── limits ────────────────────────────────────────────────────────────────── */

test('the limit is clamped — a caller cannot ask for the whole catalogue', () => {
  const many = Array.from({ length: 80 }, (_, i) => ev({ id: `e${String(i).padStart(2, '0')}` }));
  assert.equal(venueEventsPayload({ venue: VENUE, today: TODAY, events: many, limit: 500 }).events.length, MAX_LIMIT);
  assert.equal(venueEventsPayload({ venue: VENUE, today: TODAY, events: many, limit: 0 }).events.length, 20);
  assert.equal(venueEventsPayload({ venue: VENUE, today: TODAY, events: many, limit: 'abc' }).events.length, 20);
  assert.equal(venueEventsPayload({ venue: VENUE, today: TODAY, events: many, limit: 3 }).events.length, 3);
});
