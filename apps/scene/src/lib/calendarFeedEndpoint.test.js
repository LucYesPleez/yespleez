/**
 * THE FEED ENDPOINT'S SHELL CONTRACT — functions/calendar/feed.js driven as
 * a function, with the RPC stubbed. The Workers runtime and node both speak
 * Request/Response, so the real handler runs here unmodified.
 *
 *     bad or missing token   → 404 before any network call
 *     unknown token          → 404
 *     unconfigured deploy    → 503, says so
 *     disabled feed          → 200 text/calendar, ZERO events
 *     enabled feed           → 200 text/calendar carrying the user's items
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../../functions/calendar/feed.js';

const TOKEN = '11111111-2222-3333-4444-555555555555';
const ENV = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon-key' };

const req = token => ({ request: new Request(`https://yespleez.com/calendar/feed${token ? `?token=${token}` : ''}`) });

/** Run the handler with fetch stubbed to answer the RPC with `payload`. */
async function run(payload, { token = TOKEN, env = ENV, ok = true } = {}) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok, json: async () => payload };
  };
  try {
    const res = await onRequestGet({ ...req(token), env });
    return { res, calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('⛔ a missing or malformed token is 404 with NO upstream call', async () => {
  for (const bad of [null, 'abc', '../../etc', "1' or '1'='1"]) {
    const { res, calls } = await run({}, { token: bad });
    assert.equal(res.status, 404, String(bad));
    assert.equal(calls.length, 0, 'the RPC must never see a malformed token');
  }
});

test('⛔ an unconfigured deployment answers 503, never a half-guess', async () => {
  const { res, calls } = await run({}, { env: {} });
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
});

test('⛔ an unknown token is 404 — indistinguishable from no feed at all', async () => {
  const { res } = await run({ found: false });
  assert.equal(res.status, 404);
});

test('the RPC is called with the anon key and the token as its one argument', async () => {
  const { calls } = await run({ found: true, enabled: false });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/rest/v1/rpc/calendar_feed_payload'));
  assert.equal(calls[0].init.headers.apikey, 'anon-key');
  assert.deepEqual(JSON.parse(calls[0].init.body), { feed_token: TOKEN });
});

test('a disabled feed serves a VALID, EMPTY text/calendar so clients clear items', async () => {
  const { res } = await run({ found: true, enabled: false });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /^text\/calendar/);
  const body = await res.text();
  assert.ok(body.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(!body.includes('BEGIN:VEVENT'));
});

test('an enabled feed serves the user\'s items with stable UIDs', async () => {
  const payload = {
    found: true, enabled: true, categories: {},
    gigs: [{
      event: { id: 'ev-1', name: 'Solstice Gathering', config: { date: '2026-08-29' } },
      venue: null,
      slots: [{ id: 'slot-a', event_id: 'ev-1', day_index: 0, position: 0, time: '9:00', ampm: 'PM', dur_mins: 60 }],
      stages: [],
      members: [{ id: 'm-1', artist_id: 'u-1', artist_profile_id: 'p-1', artist_name: 'Karioke Kev' }],
      performances: [{ id: 'p-1', lineup_member_id: 'm-1', slot_uuid: 'slot-a', status: 'accepted' }],
    }],
    attending: [], bookings: [], deadlines: [],
  };
  const { res } = await run(payload);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.includes('UID:yespleez-slot-slot-a@yespleez.com'));
  assert.ok(body.includes('DTSTART:20260829T210000'));
  assert.ok(body.includes('UID:yespleez-gig-ev-1@yespleez.com'));
  assert.match(res.headers.get('Cache-Control'), /private/);
});
