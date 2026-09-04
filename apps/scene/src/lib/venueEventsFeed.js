/**
 * THE PUBLIC VENUE EVENTS FEED — what a venue's OWN website may show.
 *
 * A venue that already has a website wants its YesPleez gig guide on it. This
 * module is the whole answer to "which events, and which fields of them, may
 * leave the platform for an address YesPleez does not control".
 *
 * ── ⛔ IT IS A PROJECTION, NOT A QUERY ───────────────────────────────
 * Every rule here is one the app already applies; NOTHING is invented:
 *
 *   status = 'live' AND (is_public = true OR is_public IS NULL)
 *       — `lib/useEvents.js`, itself copied verbatim from DiscoverScreen. That
 *         comment says "if this rule changes it must change in both"; this is
 *         now the third reader, and it reads the same rule from `isPubliclyListable`
 *         rather than spelling it a third time.
 *       — `is_public IS NULL` is NOT sloppiness: NULL means "written before the
 *         column existed" and the whole app reads that as public.
 *
 *   the window is a RANGE OVERLAP, via `eventSpan`
 *       — a Fri–Sun festival is still on, on the Saturday. ⛔ Never compare
 *         `config.date` by hand; that is the defect `lib/eventDays.js` exists
 *         to end.
 *
 *   the picture ladder is `eventCardImage`, the clock is `readClock`, the town
 *   is `displayTown`, the origin is `PUBLIC_ORIGIN`
 *       — one reader per field, everywhere. A widget that grew its own would
 *         eventually disagree with the event page it links to.
 *
 * ── ⛔⛔ WHY THE OUTPUT IS A WHITELIST AND NEVER A SPREAD ─────────────
 * `events.config` is a JSONB blob. It carries, today, on live rows: the day/slot
 * structure (an UNANNOUNCED LINEUP — the thing SEC-2 exists to protect),
 * `host_controls_config`, `applications_open`, and `date_evidence` — an
 * importer's private reasoning about how it guessed a date. `profiles` hands an
 * anonymous caller all 84 of its columns to anyone who names them, which is why
 * `publicProfileColumns.js` exists.
 *
 * So this module NAMES the fields that leave. ⛔ There is no `...event`, no
 * `...cfg`, and no "everything except" list anywhere in it. A field that is not
 * written out here cannot leak, whatever a future migration adds to either
 * table. `PUBLIC_EVENT_FIELDS` and `PUBLIC_VENUE_FIELDS` are the declared
 * contract and the tests assert the payload matches them EXACTLY — an extra key
 * fails, not just a missing one.
 *
 * ── PURE ────────────────────────────────────────────────────────────
 * No network, no clock, no `supabase`. `today` is passed in, so a test can
 * freeze it and so the Cloudflare function can decide what "today" means at the
 * edge (see `functions/api/venue-events.js`).
 */
import { eventSpan } from './eventDays';
import { eventCardImage, eventPosterImage } from './eventImage';
import { displayTown } from './formatLocation';
import { PUBLIC_ORIGIN } from './qrDestinations';
import { readDate, readEndDate, readClock, readGenres } from '../screens/event/eventViewModel';

/** How many events the feed answers with when the caller does not say. */
export const DEFAULT_LIMIT = 20;

/** The most it will ever answer with, however large a `limit` is asked for. */
export const MAX_LIMIT = 50;

/**
 * The blurb is TRUNCATED, not summarised. A venue's site gets enough to sell
 * the night and a link for the rest; shipping the full body would make this
 * feed a syndication channel for copy the organiser wrote for the event page.
 */
export const DESCRIPTION_MAX = 280;

/**
 * ⛔ THE EXACT SHAPE OF A PUBLIC EVENT. Nothing else is emitted, ever.
 * Adding a key here is a publication decision — it puts that field on every
 * external website carrying the widget, permanently and outside our control.
 */
export const PUBLIC_EVENT_FIELDS = Object.freeze([
  'id', 'name', 'url', 'date', 'end_date', 'start_time', 'doors',
  'image', 'poster', 'description', 'genres', 'venue_name',
]);

/** ⛔ Same rule, for the venue block. `location` is DELIBERATELY ABSENT — on a
 *  venue profile that column holds the STREET ADDRESS (see formatLocation.js).
 *  `town` is `displayTown`'s answer, which is what every card in the app shows. */
export const PUBLIC_VENUE_FIELDS = Object.freeze(['id', 'name', 'town', 'state', 'url']);

/**
 * The columns the feed asks PostgREST for.
 *
 * ⛔ NOT `select=*`. `resolveProfileRoute` learned this the expensive way: `*`
 * handed a signed-out stranger `email`, `emergency_phone` and `abn`. Naming
 * columns is the only version of this that stays correct as the table grows.
 */
export const FEED_EVENT_SELECT = 'id,name,status,is_public,venue_profile_id,config';
export const FEED_VENUE_SELECT = 'id,name,type,suburb,location,state';

/**
 * ⚠ The `#` is HashRouter's and it is load bearing — App.jsx routes
 * `/event/:id` under a hash router. The same expression is inlined three times
 * in `lib/calendarEvent.js`; ⛔ that file is calendar infrastructure and is not
 * touched here. If the router ever moves, both change together.
 */
export function publicEventUrl(id, origin = PUBLIC_ORIGIN) {
  return id ? `${origin}/#/event/${id}` : null;
}

export function publicProfileUrl(id, origin = PUBLIC_ORIGIN) {
  return id ? `${origin}/#/profile/${id}` : null;
}

/**
 * ⭐ THE PUBLICATION GATE — the app's own rule, in one place.
 *
 * An event that is cancelled, unpublished or made private disappears from this
 * feed the same way it disappears from What's On: the host flips it back to
 * `draft` or clears `is_public`, and the next fetch simply does not contain it.
 * ⛔ There is no separate "remove from website" switch and there must never be
 * one — a second publication control is a second thing to forget.
 */
export function isPubliclyListable(event) {
  if (!event) return false;
  if (event.status !== 'live') return false;
  return event.is_public === true || event.is_public === null || event.is_public === undefined;
}

/**
 * Is this event still to come, on `todayIso`?
 *
 * ⚠ The comparison is against the span's LAST day, so a multi-day event stays
 * listed while it is running. An undated row is NOT upcoming — `eventSpan`
 * returns null and an event nobody can attend on a known day has no business
 * on a venue's gig guide.
 */
export function isUpcoming(event, todayIso) {
  const span = eventSpan(event);
  if (!span || !todayIso) return false;
  return span.end >= todayIso;
}

/** Trim, collapse runaway whitespace, cap. Absent stays absent. */
function publicDescription(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= DESCRIPTION_MAX) return text;
  return `${text.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…`;
}

/**
 * ⛔⛔ THE ONE PROFILE TYPE THIS ENDPOINT ACCEPTS.
 *
 * `/api/venue-events?venue=…` says *venue*, so the profile must BE one. It is
 * deliberately ⛔ NOT a "not punter" test and ⛔ NOT polymorphic:
 *
 *   ⛔ "not punter" is a rule about the ONE type that must never be published,
 *     and it silently accepts the other five. An artist id would then return an
 *     artist's name and town under a key called `venue` — public fields, but a
 *     lie about what they are, on somebody else's website.
 *
 *   ⛔ Accepting `host` or `festival` "because a future location might be one"
 *     is a contract decided by accident. A Festival or Host location feed will
 *     have its own questions — which events, whose dates, what a stage means —
 *     and answering them by widening a type check here is how one endpoint ends
 *     up meaning four things. ⭐ Give them their own deliberate contract.
 *
 * ⚠ It also subsumes the Personal filter it replaces: `punter` is not `venue`,
 * so a Personal profile — system-generated, inalienable, NEVER publicly
 * discoverable — cannot resolve here either. That property is asserted on its
 * own in the tests, because it must survive whatever this constant becomes.
 */
export const VENUE_PROFILE_TYPE = 'venue';

/**
 * The venue block, or null.
 *
 * ⚠ A profile that is not a venue answers null, and the caller then answers
 * with NO EVENTS and NO NAME — see `venueEventsPayload`. Identical to the
 * answer for an id that does not exist at all, so the endpoint cannot be used
 * to ask "which profile ids are real, and what type are they".
 */
export function publicVenue(profile, origin = PUBLIC_ORIGIN) {
  if (!profile?.id) return null;
  if (profile.type !== VENUE_PROFILE_TYPE) return null;
  return {
    id: profile.id,
    name: profile.name || null,
    town: displayTown(profile) || null,
    state: profile.state || null,
    url: publicProfileUrl(profile.id, origin),
  };
}

/**
 * One event, projected.
 *
 * `venue_name` comes from the PROFILE, not from `config.venue` — the profile is
 * the authority (eventViewModel.js says so, and the config string is a free-text
 * import artefact: "The Federal Hotel " with a trailing space is a live row).
 *
 * `end_date` is emitted only when it is genuinely after the start; a blank or
 * backwards `endDate` is absent, not zero — the same rule `eventSpan` applies.
 */
export function publicEvent(event, { venueName = null, origin = PUBLIC_ORIGIN } = {}) {
  const cfg = event?.config || {};
  const date = readDate(cfg);
  const end = readEndDate(cfg);
  return {
    id: event.id,
    name: event.name || null,
    url: publicEventUrl(event.id, origin),
    date: date ? String(date).slice(0, 10) : null,
    end_date: end && String(end).slice(0, 10) > String(date).slice(0, 10) ? String(end).slice(0, 10) : null,
    start_time: readClock(cfg.time, cfg.ampm),
    doors: readClock(cfg.doors, cfg.doors_ampm || cfg.ampm),
    image: eventCardImage(event),
    /* ⭐ BOTH PICTURES, because they answer different questions. `image` is what
       goes in a landscape frame (cover-led); `poster` is the artwork itself, or
       NULL where there is none. ⛔ The feed does not choose between them — a
       poster wall and a card grid want opposite things, and a feed that picked
       one would be deciding a layout it cannot see. */
    poster: eventPosterImage(event),
    description: publicDescription(cfg.bio),
    /* ⚠ `readGenres` is the app's own reader: one stored string, separated by
       `·` OR `,` depending on which generation wrote it, deduplicated
       case-insensitively. ⛔ Not `cfg.genres.split(',')` — "House, Funky House,
       Reworks  " is a live row and the naive split keeps the trailing spaces.
       An ARRAY, so the surface displaying it chooses the separator; a joined
       string here would be this module deciding a venue's typography. */
    genres: readGenres(cfg.genres),
    venue_name: venueName,
  };
}

/**
 * THE WHOLE FEED.
 *
 * @param venue   a `profiles` row, or null/undefined when nothing resolved
 * @param events  `events` rows for that venue, unfiltered
 * @param today   YYYY-MM-DD — the day the feed is answered for. ⛔ Required and
 *                never defaulted from a clock in here: this file is pure.
 * @param limit   how many to answer with, clamped to [1, MAX_LIMIT]
 *
 * ⭐ NO VENUE MEANS NO EVENTS. An unknown id, one naming a Personal profile and
 * one naming a host, artist, band, standup or festival profile all answer
 * `{ venue: null, events: [] }` — the SAME answer, so a caller cannot use this
 * endpoint to tell "no such profile" from "a profile of the wrong type", nor
 * read a name off either.
 */
export function venueEventsPayload({ venue, events = [], today, limit = DEFAULT_LIMIT, origin = PUBLIC_ORIGIN } = {}) {
  const publicVenueBlock = publicVenue(venue, origin);
  if (!publicVenueBlock) return { venue: null, events: [] };

  const cap = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));

  const rows = events
    .filter(ev => ev?.venue_profile_id === publicVenueBlock.id)
    .filter(isPubliclyListable)
    .filter(ev => isUpcoming(ev, today))
    /* Soonest first — a gig guide is read forwards. Ties fall back to the id so
       the order is stable between two fetches of the same day. */
    .sort((a, b) => {
      const sa = eventSpan(a).start;
      const sb = eventSpan(b).start;
      return sa === sb ? String(a.id).localeCompare(String(b.id)) : sa < sb ? -1 : 1;
    })
    .slice(0, cap)
    .map(ev => publicEvent(ev, { venueName: publicVenueBlock.name, origin }));

  return { venue: publicVenueBlock, events: rows };
}
