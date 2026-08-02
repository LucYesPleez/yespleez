// EP-01 · the real event, as the page's sections want it.
//
// Everything above this line in the stack is a database row; everything below
// it is a section that takes clean props. This is the seam, and it is pure so
// that the messy half can be tested without a page or a network.
//
// ── Why this file has to exist ───────────────────────────────────────
// `events.config` is a JSONB blob carrying several generations of schema at
// once. On the 50 live rows a date appears as `date` OR `start_date`, an end
// date as `endDate` OR `end_date`, a ticket link as `ticketLink` OR
// `ticket_url`, and `events.lat`/`lng`/`postcode` are empty on ALL of them
// while the populated coordinates live on the venue's profile. A component
// that reached into `config` itself would have to know all of that, and every
// component would have to know it identically.
//
// ⚠ EVERY RULE HERE IS "ABSENT STAYS ABSENT". This layer never invents a
// default, never substitutes a placeholder and never promotes a guess to a
// fact — see docs/rendering-contract.md. Where a value is missing it returns
// null and the section decides whether to hide, and where a value is uncertain
// it passes the uncertainty along rather than flattening it.

import { DEFAULT_CROP_Y } from './heroMedia';

/* ── config readers ──────────────────────────────────────────────────
   One place per field, listing every spelling it has ever had. New writers
   must pick the FIRST name in each list; the rest are read-only legacy. */
const first = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '') ?? null;

export const readDate     = cfg => first(cfg.date, cfg.start_date);
export const readEndDate  = cfg => first(cfg.endDate, cfg.end_date);
export const readTickets  = cfg => first(cfg.ticketLink, cfg.ticket_url);

/**
 * `time: "7:30"` + `ampm: "PM"` — the shape the importer and the host editor
 * both write. Returns null rather than a bare number: "7:30" with no meridiem
 * is ambiguous, and the page would render an evening gig as a morning one.
 */
export function readClock(time, ampm) {
  const t = String(time || '').trim();
  if (!t) return null;
  const m = String(ampm || '').trim().toLowerCase();
  if (!m) return /[ap]m/i.test(t) ? t.toLowerCase() : null;
  return `${t}${m}`;
}

/**
 * Genres arrive as one string, separated by `·` or `,` depending on which
 * generation wrote it. Deduplicated case-insensitively — "House" and "house"
 * as two pills reads as a data bug to anyone looking at it.
 */
export function readGenres(raw) {
  const seen = new Set();
  return String(raw || '')
    .split(/[·,]/)
    .map(g => g.trim())
    .filter(g => {
      if (!g) return false;
      const k = g.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/**
 * R1 · unknown ≠ confirmed. The importer records how it arrived at a date;
 * anything other than an explicit confirmation is passed through as-is so the
 * Identity block can qualify it instead of stating it.
 */
export function readDateConfidence(cfg) {
  const c = first(cfg.date_confidence, cfg.dateConfidence);
  if (!c) return 'confirmed';        // nobody expressed doubt
  return String(c).toLowerCase();
}

/* ── the venue ───────────────────────────────────────────────────────
   ⚠ The PROFILE is the authority, not the config string. `venue_profile_id`
   is set on 46 of 50 events and was never read before this work, while
   `config.venue` is a free-typed name that nothing keeps in sync. Config is
   the fallback for the four rows with no linked venue. */
export function buildVenue({ event = {}, cfg = {}, venueProfile = null } = {}) {
  // R1 · withheld is a DECISION and must survive this layer intact. Checked
  // here and passed on; resolveVenue checks it again before it looks at any
  // coordinate, so a secret location cannot leak a map.
  const withheld = cfg.locationWithheld === true || cfg.location_withheld === true;

  const name     = first(venueProfile?.name, cfg.venue);
  const address  = first(venueProfile?.location, cfg.location, cfg.address);
  const locality = first(venueProfile?.suburb, cfg.suburb, venueProfile?.location && null);
  const state    = first(venueProfile?.state, cfg.state);

  return {
    name, address, locality, state, withheld,
    // No tile provider has been chosen, so there is no mapUrl to give. The
    // ladder falls to the address, which is honest — an empty map frame is
    // the hole R5 forbids. Coordinates are carried anyway so the day a
    // provider lands, this is the only line that changes.
    mapUrl: null,
    lat: first(venueProfile?.lat, event.lat),
    lng: first(venueProfile?.lng, event.lng),
    profile: venueProfile || null,
  };
}

/* ── the bill ────────────────────────────────────────────────────────
   Members are already ordered by the organiser (BILL, the resting order), and
   `memberProfiles` is keyed by lineup_members.id — see lineupProfiles.js. */
export function buildLineup({ lineupMembers = [], memberProfiles = {}, cfg = {} } = {}) {
  const artists = (lineupMembers || [])
    .filter(m => m && (m.artist_name || memberProfiles[m.id]?.name))
    .map(m => {
      const p = memberProfiles[m.id] || null;
      return {
        // ProfileCard routes on `id`. An unclaimed imported artist has no user
        // account, so without the profile id their card cannot be opened.
        id:       p?.id || m.artist_profile_id || m.id,
        name:     p?.name || m.artist_name,
        location: p?.location || null,
        avatar:   p?.avatar_thumb || p?.avatar || null,
        type:     p?.type || 'artist',
      };
    });

  // R1 · an organiser who has not announced their bill has made a decision;
  // one who has no bill yet has made none. Only the explicit flag says
  // "withheld" — an empty lineup on its own is absent.
  const withheld = artists.length === 0 &&
    (cfg.lineupWithheld === true || cfg.lineup_withheld === true);

  return { artists, withheld };
}

/* ── Event Details ───────────────────────────────────────────────────
   ⚠ NO DATE AND NO TICKETS in here (layout spec § 9) — both are stated in the
   Identity block above, and repeating them makes the page argue with itself.
   Rows are emitted only where a value exists: a missing age row must never
   render as "All ages", which would be a licensing claim made on the
   organiser's behalf. */
export function buildDetails(cfg = {}) {
  const rows = [
    { key: 'doors',         label: 'Doors',         value: readClock(cfg.doors, cfg.doors_ampm || cfg.ampm) },
    { key: 'price',         label: 'Entry',         value: first(cfg.price) },
    { key: 'age',           label: 'Age',           value: first(cfg.age, cfg.age_policy) },
    { key: 'accessibility', label: 'Accessibility', value: first(cfg.accessibility) },
    { key: 'bring',         label: 'What to Bring', value: first(cfg.bring, cfg.what_to_bring) },
    { key: 'parking',       label: 'Parking',       value: first(cfg.parking) },
  ];
  return rows.filter(r => r.value);
}

/* ── Information Sources ─────────────────────────────────────────────
   ⚠ CONFIDENCE IS A CLAIM AND NOTHING COMPUTES IT YET, so nothing states it.
   The section renders provenance it can stand behind — that this record came
   from a Studio import, and when it was last written — and stays silent about
   the rest. A hand-made event has no provenance story at all and the section
   hides entirely.

   `date_evidence` is deliberately NOT surfaced here: it explains one field,
   not the record, and reading it as the record's provenance is exactly the
   over-claim this section has to avoid. It reaches the reader as the
   qualified date in the Identity block instead. */
export function buildSources({ event = {}, cfg = {}, now = new Date() } = {}) {
  const imported = typeof event.external_ref === 'string' && event.external_ref.startsWith('studio:');
  if (!imported) return { origin: 'manual', contributors: [], lastChecked: null, confidence: null };

  return {
    origin: 'discovery',
    // The importer does not record which pages a candidate came from, so there
    // is nobody to name. Naming a guess here would be worse than naming none.
    contributors: [],
    lastChecked: relativeTime(event.updated_at, now),
    confidence: null,
  };
}

/** Coarse on purpose: "2 hours ago" is a fact, "2h 14m ago" is false precision. */
export function relativeTime(iso, now = new Date()) {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const mins = Math.floor((now - then) / 60000);
  if (mins < 0)    return null;                        // a future timestamp is not a check
  if (mins < 2)    return 'just now';
  if (mins < 60)   return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 2)     return 'an hour ago';
  if (hrs < 24)    return `${hrs} hours ago`;
  const days = Math.floor(hrs / 24);
  if (days < 2)    return 'yesterday';
  if (days < 30)   return `${days} days ago`;
  return null;                                          // older than a month is not "recently checked"
}

/* ── the whole page ──────────────────────────────────────────────────── */
export function buildEventView({
  event = {},
  ownerProfile = null,
  venueProfile = null,
  lineupMembers = [],
  memberProfiles = {},
  now = new Date(),
} = {}) {
  const cfg = event.config || {};

  const venue = buildVenue({ event, cfg, venueProfile });

  const when = {
    date:      readDate(cfg),
    endDate:   readEndDate(cfg),
    startTime: readClock(cfg.time, cfg.ampm),
    endTime:   readClock(cfg.end_time || cfg.endTime, cfg.end_ampm || cfg.endAmpm),
    confidence: readDateConfidence(cfg),
  };

  const poster = cfg.poster || null;

  return {
    name: event.name || '',

    hero: {
      // R1 · the Hero takes what exists and no more. There is no Cover field
      // in this schema yet, so imported events land on the poster rungs — and
      // the Poster section still renders the artwork whole further down. The
      // hero is an ARTEFACT, never an information source: duplication between
      // what the poster says and what the page says is expected and correct.
      cover: null,
      gallery: [],
      landscapeArtwork: null,
      poster: poster ? { url: cfg.poster_full || poster } : null,
      // The organiser's chosen band. Absent means no choice has been made, and
      // heroMedia falls to its top-weighted default — it does NOT mean 0.
      posterCropY: typeof cfg.posterCropY === 'number' ? cfg.posterCropY : null,
    },

    identity: {
      name: event.name || '',
      when,
      where: {
        // Withheld: the Identity line names the area, never the venue. The
        // Venue section carries the notice; this must not undo it.
        venue:    venue.withheld ? null : venue.name,
        locality: venue.locality,
        state:    venue.state,
      },
      genres: readGenres(cfg.genres),
    },

    summary: {
      ticketUrl: readTickets(cfg),
      // Attendance is not loaded on this path. `null` is "not known", which
      // renders nothing — a hard 0 would read as "nobody is going" (R3).
      attending: null,
      description: first(cfg.bio, cfg.description) || '',
    },

    lineup: buildLineup({ lineupMembers, memberProfiles, cfg }),

    venue,

    details: buildDetails(cfg),

    presentedBy: {
      // Owner presents where one is known, venue otherwise. Owner linkage
      // covers 32 of 50 rows and venue linkage 46, so the fallback is the
      // common path, not a theoretical one.
      presenter: ownerProfile?.name
        ? {
            name: ownerProfile.name,
            type: ownerProfile.type || 'host',
            bio:  ownerProfile.bio || null,
            profile: ownerProfile,
          }
        : null,
      venue: venue.name && !venue.withheld
        ? { name: venue.name, bio: venueProfile?.bio || null, profile: venueProfile }
        : null,
    },

    poster: poster ? { url: cfg.poster_full || poster, alt: event.name || 'Event poster' } : null,

    sources: buildSources({ event, cfg, now }),
  };
}

export { DEFAULT_CROP_Y };
