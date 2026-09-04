/**
 * THE VENUE EVENTS ENDPOINT'S SHELL CONTRACT — functions/api/venue-events.js
 * driven as a function, with PostgREST stubbed. The Workers runtime and node
 * both speak Request/Response, so the real handler runs here unmodified.
 *
 *     malformed venue id     → 400 before any network call
 *     unconfigured deploy    → 503, says so
 *     unknown venue          → 200 { venue: null, events: [] }
 *     Personal profile       → the SAME answer, so ids cannot be probed
 *     resolved venue         → 200 application/json, CORS open, publicly cacheable
 *
 * ⚠ These assert the SHELL: routing, scoping, headers and which query is sent.
 * What the payload may contain is `venueEventsFeed.test.js`'s subject.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestHead, onRequestOptions } from '../../functions/api/venue-events.js';

const VENUE_ID = '55c3728c-9542-4ca6-94fa-62f3cb6cffa5';
const ENV = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon-key' };

const VENUE_ROW = { id: VENUE_ID, name: 'The Federal Hotel', type: 'venue', suburb: 'Bellingen', location: '77 Hyde St', state: 'NSW' };

/** Far enough ahead that the handler's real clock cannot make it past. */
const EVENT_ROW = {
  id: 'ev-1',
  name: 'The Friday Mix Up',
  status: 'live',
  is_public: true,
  venue_profile_id: VENUE_ID,
  config: { date: '2099-09-11', time: '8:30', ampm: 'PM', bio: 'Deep disco.', poster: 'https://cdn.example/p.jpg' },
};

const req = (qs = '') => ({ request: new Request(`https://yespleez.com/api/venue-events${qs}`) });

/**
 * Run the handler with fetch stubbed. `answers` is consulted in order: the
 * venue lookup first, the events query second.
 */
async function run({ qs = `?venue=${VENUE_ID}`, env = ENV, answers = [[VENUE_ROW], [EVENT_ROW]], ok = true, handler = onRequestGet } = {}) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok, json: async () => answers[calls.length - 1] ?? [] };
  };
  try {
    const res = await handler({ ...req(qs), env });
    return { res, calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const bodyOf = res => res.text().then(t => (t ? JSON.parse(t) : null));

/* ── D · a random or invalid venue id ──────────────────────────────────────── */

test('⛔ a missing or malformed venue id is 400 with NO upstream call', async () => {
  for (const qs of ['', '?venue=', '?venue=abc', '?venue=../../etc/passwd', "?venue=1' or '1'='1", '?venue=*']) {
    const { res, calls } = await run({ qs });
    assert.equal(res.status, 400, qs);
    assert.equal(calls.length, 0, `PostgREST must never see a malformed id (${qs})`);
    const body = await bodyOf(res);
    assert.equal(body.error, 'invalid_venue');
    /* ⛔ The refusal says nothing about the schema. PostgREST's own 400 names
       the column and its type, which is a small free gift to anyone fuzzing. */
    assert.ok(!JSON.stringify(body).includes('uuid_'), 'no upstream error text is echoed');
  }
});

test('⛔ an UNKNOWN but well-formed venue answers 200 with nothing in it', async () => {
  const { res, calls } = await run({ answers: [[]] });
  assert.equal(res.status, 200);
  const body = await bodyOf(res);
  assert.equal(body.venue, null);
  assert.deepEqual(body.events, []);
  assert.equal(calls.length, 1, 'an id that resolves to nothing is not then queried for events');
});

test('⛔⛔ a PERSONAL profile id gets the SAME answer as an unknown one', async () => {
  /* Personal profiles are never publicly discoverable. If this answered 404
     for an unknown id and 200-with-a-name for a punter, the endpoint would be
     a membership oracle for every profile on the platform.

     ⚠ Stubbed as though PostgREST had returned the row, so the PROJECTION is
     what is under test here — the query's own `type=eq.venue` (asserted below)
     means production never gets this far. Both layers, deliberately. */
  const punter = { id: VENUE_ID, name: 'Federal Hotel', type: 'punter' };
  const { res } = await run({ answers: [[punter], []] });
  const body = await bodyOf(res);
  assert.equal(body.venue, null);
  assert.deepEqual(body.events, []);
  assert.ok(!JSON.stringify(body).includes('Federal Hotel'),
    'a Personal profile must not even confirm its own name');
});

test('⛔⛔ a HOST or ARTIST profile id gets the SAME answer as an unknown one', async () => {
  /* `?venue=` means a venue. The live "The Federal Hotel" HOST profile owns
     most of that venue's events, which makes it the plausible wrong input — and
     `venue_profile_id` is location, not authority (identity v1.3 O-R4). */
  for (const type of ['host', 'artist', 'band', 'standup', 'festival']) {
    const { res } = await run({ answers: [[{ id: VENUE_ID, name: 'The Federal Hotel', type, location: 'Bellingen', state: 'NSW' }], [EVENT_ROW]] });
    const body = await bodyOf(res);
    assert.equal(body.venue, null, type);
    assert.deepEqual(body.events, [], `${type} must not be served a venue's diary`);
    assert.ok(!JSON.stringify(body).includes('Federal'), `${type} leaked a name`);
  }
});

test('⛔⛔ the venue lookup CONSTRAINS type in the query — a non-venue row never crosses the network', async () => {
  const { calls } = await run({});
  assert.ok(calls[0].url.includes('type=eq.venue'),
    'a wrong-type profile is the wrong INPUT, not a venue with no gigs — do not fetch it and then discard it');
});

test('⛔ an unconfigured deployment answers 503, never a half-guess', async () => {
  const { res, calls } = await run({ env: {} });
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
  assert.equal((await bodyOf(res)).error, 'not_configured');
});

test('an upstream failure is 502 and carries no upstream detail', async () => {
  const { res } = await run({ ok: false });
  assert.equal(res.status, 502);
  assert.deepEqual(await bodyOf(res), { error: 'upstream_unavailable' });
});

/* ── the queries it actually sends ─────────────────────────────────────────── */

test('the venue lookup is by id, column-listed, with the ANON key and no session', async () => {
  const { calls } = await run({});
  const [venueCall] = calls;
  assert.ok(venueCall.url.startsWith('https://example.supabase.co/rest/v1/profiles?select='));
  assert.ok(venueCall.url.includes(`id=eq.${VENUE_ID}`));
  assert.equal(venueCall.init.headers.apikey, 'anon-key');
  assert.equal(venueCall.init.headers.Authorization, 'Bearer anon-key');

  /* ⛔⛔ NO SERVICE KEY, NO COOKIE, NO USER JWT — the three ways this could
     stop being an anonymous read without anybody noticing. */
  const headerNames = Object.keys(venueCall.init.headers).map(h => h.toLowerCase());
  assert.deepEqual(headerNames.sort(), ['accept', 'apikey', 'authorization']);
  assert.ok(!JSON.stringify(venueCall.init).toLowerCase().includes('service_role'));
  assert.ok(!JSON.stringify(venueCall.init).toLowerCase().includes('cookie'));

  /* ⛔ `select=*` is what handed a signed-out stranger `email` and
     `emergency_phone` from this very table. */
  assert.ok(!venueCall.url.includes('select=*'));
});

test('⭐ the events query carries the publication rule to the DATABASE, not just the projection', async () => {
  const { calls } = await run({});
  const eventsCall = calls[1];
  assert.ok(eventsCall.url.includes('/rest/v1/events?select='));
  assert.ok(eventsCall.url.includes(`venue_profile_id=eq.${VENUE_ID}`), 'scoped to the one venue');
  assert.ok(eventsCall.url.includes('status=eq.live'), 'unpublished events never cross the network');
  assert.ok(eventsCall.url.includes('is_public.eq.true'), 'private events never cross the network');
  assert.ok(eventsCall.url.includes('is_public.is.null'), 'pre-column rows are public — useEvents.js says so');
  assert.ok(!eventsCall.url.includes('select=*'));
});

/* ── C · usable by an unauthenticated external website ─────────────────────── */

test('⭐ a resolved venue answers JSON any external site may read', async () => {
  const { res } = await run({});
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /^application\/json/);

  /* CORS: the venue's own domain is not known to us and never will be. */
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  /* ⛔ NEVER credentials — a browser would refuse it beside `*` anyway, and its
     absence is the statement that this endpoint reads no session. */
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), null);
  /* PUBLIC, not private: the response is identical for every reader, which is
     what makes a shared cache correct here and wrong on the calendar feed. */
  assert.match(res.headers.get('Cache-Control'), /^public,/);

  const body = await bodyOf(res);
  assert.equal(body.venue.name, 'The Federal Hotel');
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].url, 'https://yespleez.com/#/event/ev-1');
  assert.equal(body.events[0].venue_name, 'The Federal Hotel');
  assert.equal(body.venue_id, VENUE_ID);
  assert.match(body.today, /^\d{4}-\d{2}-\d{2}$/);
});

test('⛔ the response never sets a cookie or varies by who is asking', async () => {
  const { res } = await run({});
  assert.equal(res.headers.get('Set-Cookie'), null);
  assert.equal(res.headers.get('Vary'), null,
    'a Vary header would mean the answer depends on the request — it must not');
});

test('a limit is honoured and clamped', async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ ...EVENT_ROW, id: `e${String(i).padStart(2, '0')}` }));
  const three = await run({ qs: `?venue=${VENUE_ID}&limit=3`, answers: [[VENUE_ROW], many] });
  assert.equal((await bodyOf(three.res)).events.length, 3);
  const huge = await run({ qs: `?venue=${VENUE_ID}&limit=9999`, answers: [[VENUE_ROW], many] });
  assert.equal((await bodyOf(huge.res)).events.length, 50);
});

/* ── method surface ────────────────────────────────────────────────────────── */

test('⭐ HEAD answers as GET does, with the JSON content type and NO body', async () => {
  const { res } = await run({ handler: onRequestHead });
  assert.equal(res.status, 200);
  /* ⚠ A Pages Function that exports only onRequestGet does not claim HEAD, and
     the request falls through to the static handler — which answers
     `200 text/html`, the SPA shell. That was a real defect on the calendar
     feed; it is not repeated here. */
  assert.match(res.headers.get('Content-Type'), /^application\/json/);
  assert.equal(await res.text(), '');

  const { res: get } = await run({});
  for (const h of ['Content-Type', 'Cache-Control', 'Access-Control-Allow-Origin']) {
    assert.equal(res.headers.get(h), get.headers.get(h), `${h} differs between HEAD and GET`);
  }
});

test('⛔ HEAD is scoped exactly like GET — a malformed id never reaches PostgREST', async () => {
  const { res, calls } = await run({ qs: '?venue=nonsense', handler: onRequestHead });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('OPTIONS preflights without touching the database', async () => {
  const res = onRequestOptions();
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(res.headers.get('Access-Control-Allow-Methods'), /GET/);
});
