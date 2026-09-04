/**
 * GET /api/venue-events?venue=<profile uuid> — a venue's upcoming public
 * events, as JSON, for a website YesPleez does not control.
 *
 * A Cloudflare Pages Function, the same shape as `functions/calendar/feed.js`:
 * it deploys with the site on every push and its esbuild bundling lets it
 * import THE APP's own rules — ⛔ no second definition of "which events are
 * public", which is the entire point.
 *
 * ── SECURITY MODEL ───────────────────────────────────────────────────
 * ⭐ THIS ENDPOINT IS PUBLIC BY DESIGN. There is no token, no session and no
 * capability URL — a venue's gig guide is meant to be readable by anyone, and
 * pretending otherwise with a secret the venue then pastes into a public HTML
 * embed would be theatre. It is therefore treated as though every byte it
 * returns is already on the open web, because it is.
 *
 * Three things carry that:
 *
 *   1. ⛔ THE OUTPUT IS A NAMED WHITELIST, built in `lib/venueEventsFeed.js`.
 *      Nothing is spread. `events.config` (unannounced lineups, host controls,
 *      the importer's private date reasoning) and `profiles`' 84 columns
 *      (`email`, `emergency_phone`, `abn`) never reach the projection.
 *
 *   2. ⛔ IT HOLDS NO SERVICE KEY. It calls PostgREST with the public anon key,
 *      so RLS applies exactly as it does to a signed-out browser — SEC-1's
 *      `read live or own events` means an unpublished event is not merely
 *      filtered here, it is not returned to this function at all.
 *
 *   3. ⛔ THE PROFILE MUST BE A VENUE. `?venue=` means a venue, so `type` is
 *      constrained in the query AND re-checked in the projection. Anything else
 *      — host, artist, band, standup, festival, and above all the Personal
 *      profile, which is never publicly discoverable — is the wrong input and
 *      is answered as though it did not exist. ⛔ This endpoint is deliberately
 *      NOT polymorphic; a Festival or Host location feed gets its own contract.
 *
 *      unparseable venue id  → 400, no upstream call
 *      unknown id, or a profile of any other type → 200 `{venue:null,
 *                              events:[]}` — the SAME answer for all of them,
 *                              so the endpoint cannot be used to probe which
 *                              profile ids exist or what type they are
 *      configured + resolved → 200 application/json, CORS open to any origin
 *
 * ⚠ Requires the same two Pages env vars the calendar feed does (Production AND
 * Preview): VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (SUPABASE_URL /
 * SUPABASE_ANON_KEY also accepted). Without them it answers 503 and says so,
 * ⛔ never a half-configured guess.
 */

import {
  venueEventsPayload,
  FEED_EVENT_SELECT,
  FEED_VENUE_SELECT,
  DEFAULT_LIMIT,
  VENUE_PROFILE_TYPE,
} from '../../src/lib/venueEventsFeed.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ⚠⚠ THE EDGE HAS NO VIEWER TIMEZONE, AND UTC IS THE WRONG ANSWER.
 *
 * `lib/dates.js` computes "today" in the VIEWER's timezone, which is right in a
 * browser and unavailable here — a Worker runs in UTC. UTC is up to 11 hours
 * BEHIND eastern Australia, so a UTC "today" keeps last night's gig on a
 * venue's website until mid-morning.
 *
 * ⛔ This is not a venue-specific setting and must not become one. YesPleez is
 * an Australian platform (`lib/auLocations.js`, `lib/postcodes.js`); this names
 * the platform's reference day in ONE constant. A venue in Perth sees an event
 * drop off up to three hours later than its own midnight, which errs towards
 * showing a gig slightly too long rather than hiding one that is still on.
 */
const FEED_TIMEZONE = 'Australia/Sydney';

/** YYYY-MM-DD in FEED_TIMEZONE. ⛔ Never `toISOString().slice(0,10)` — that is
 *  the UTC day, and lib/utcDateSweep.test.js exists because five call sites
 *  read it as the local one. */
function feedToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FEED_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const at = type => parts.find(p => p.type === type)?.value || '';
  return `${at('year')}-${at('month')}-${at('day')}`;
}

/** Public data, so a SHARED cache is correct — the opposite of the calendar
 *  feed, whose token makes its response private to one person. */
const CACHE = 'public, max-age=300';

const CORS = {
  /* ⭐ ANY ORIGIN, ON PURPOSE. The whole feature is "paste this into the
     website you already have", and we do not know what that domain is — for
     Bellingen Venetian Plastering, for the Federal Hotel, or for the next
     venue. An allowlist here would be a support queue. Nothing this endpoint
     returns is private, and it accepts no credentials (see below), so a
     browser attaching a YesPleez cookie to it is impossible. */
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  /* ⛔ NO `Access-Control-Allow-Credentials`. With `*` the browser refuses it
     anyway, and its absence is the statement: this endpoint never reads a
     session, so a signed-in visitor's request is byte-identical to a
     stranger's. */
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });
}

/**
 * ⚠ HEAD IS EXPORTED TOO. A Pages Function exporting only `onRequestGet` does
 * not claim HEAD, so a HEAD on this path falls through to the STATIC handler
 * and answers `200 text/html` — the SPA shell. That was a real defect on the
 * calendar feed; it is not repeated here. The body is dropped, ⛔ not the
 * headers, and it shares one handler so the two can never disagree.
 */
export async function onRequestHead(ctx) {
  const res = await serve(ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}

/** A cross-origin GET is a "simple request" and is not preflighted, so this is
 *  belt and braces — until someone's embed adds a header, at which point its
 *  absence would be a silent CORS failure with no error worth reading. */
export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}

export async function onRequestGet(ctx) {
  return serve(ctx);
}

async function serve({ request, env }) {
  const url = new URL(request.url);
  const venueId = url.searchParams.get('venue') || '';

  /* ⛔ REJECTED BEFORE ANY UPSTREAM CALL. A malformed id is a client mistake,
     not a lookup — and PostgREST answers a non-uuid filter with a 400 whose
     body names the column and the type, which is a small schema leak served to
     anyone who fuzzes the query string. */
  if (!UUID_RE.test(venueId)) {
    return json({ error: 'invalid_venue', message: 'venue must be a YesPleez profile id (uuid)' }, 400);
  }

  const base = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
  if (!base || !key) {
    return json({ error: 'not_configured', message: 'Venue events feed is not configured on this deployment.' }, 503);
  }

  const rest = path => fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });

  /* The venue FIRST, and the events only if it resolves. Two round trips rather
     than one parallel pair, so an id we are going to refuse never becomes a
     query made on its behalf. The 5-minute shared cache pays for both.

     ⛔⛔ `type=eq.venue` IS IN THE QUERY, not only in the projection. The
     parameter is called `venue` and it means one thing; a host, artist, band,
     standup, festival or Personal profile is the WRONG INPUT, not a venue with
     no gigs. Constraining the SELECT means such a row is never carried across
     the network at all — `publicVenue` re-checks it, and the two agree because
     both read VENUE_PROFILE_TYPE. */
  const venueRes = await rest(
    `profiles?select=${encodeURIComponent(FEED_VENUE_SELECT)}`
    + `&id=eq.${venueId}`
    + `&type=eq.${VENUE_PROFILE_TYPE}`
    + `&limit=1`,
  );
  if (!venueRes.ok) return json({ error: 'upstream_unavailable' }, 502);
  const venue = (await venueRes.json())?.[0] || null;

  /* ⭐ ONE SHAPE FOR "nothing to show". An unknown id, a profile of any other
     type, and a venue with an empty diary are indistinguishable from outside. */
  if (!venue) return json({ ...meta(venueId), venue: null, events: [] }, 200, { 'Cache-Control': CACHE });

  /* ⚠ THE PUBLICATION FILTER IS APPLIED HERE AS WELL AS IN THE PROJECTION.
     RLS already withholds anything that is not `status = 'live'`, and
     `venueEventsPayload` re-checks both clauses — but asking PostgREST for the
     same rule means an unpublished event is never carried across the network
     at all. The three agree because they read `useEvents.js`'s rule; ⛔ if that
     rule changes it changes in all of them. */
  const eventsRes = await rest(
    `events?select=${encodeURIComponent(FEED_EVENT_SELECT)}`
    + `&venue_profile_id=eq.${venueId}`
    + `&status=eq.live`
    + `&or=(is_public.eq.true,is_public.is.null)`
    + `&limit=200`,
  );
  if (!eventsRes.ok) return json({ error: 'upstream_unavailable' }, 502);
  const rows = await eventsRes.json();

  const payload = venueEventsPayload({
    venue,
    events: Array.isArray(rows) ? rows : [],
    today: feedToday(),
    limit: Number(url.searchParams.get('limit')) || DEFAULT_LIMIT,
  });

  return json({ ...meta(venueId), ...payload }, 200, { 'Cache-Control': CACHE });
}

/** Answered on every 200 so a site owner debugging an empty widget can see
 *  which id was asked for and which day it was answered for. */
function meta(venueId) {
  return { venue_id: venueId, today: feedToday(), generated_at: new Date().toISOString() };
}
