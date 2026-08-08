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
import { postcodeCoords } from '../../lib/geo';

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

  // Street coords where the record has them, otherwise the postcode centroid
  // from AU_POSTCODES — suburb-level, which is the right precision for an
  // image whose job is "which town". No geocoder, no second key.
  const postcode = first(venueProfile?.postcode, cfg.postcode, event.postcode);
  const lat = first(venueProfile?.lat, event.lat);
  const lng = first(venueProfile?.lng, event.lng);
  const centroid = postcodeCoords(postcode, state);
  const stored = (lat != null && lng != null) ? { lat, lng } : null;
  const coords = stored || centroid;

  /**
   * ⚠ WHERE TO AIM *NAVIGATION*, which is NOT always `coords`.
   *
   * `coords` above is deliberately allowed to be a postcode centroid, because
   * its other job is picking the town picture. Turn-by-turn directions cannot
   * use that precision: postcode 2454 runs from Bellingen out past Kalang, so
   * its centroid is bushland several kilometres from any venue in it. Aiming
   * a directions link there sends someone to a paddock — reported live
   * (owner, 2026-08-04: "why is this directions button loading up as kalang").
   *
   * The venue in that report had the centroid stored on its own profile, so
   * this is not merely the fallback leaking: a real `lat`/`lng` can itself BE
   * a centroid. Hence comparing the value rather than trusting its source.
   *
   * navigationUrl prefers coordinates over an address on every platform, and
   * that rule is right — for coordinates that mean something. This decides
   * whether they do. Null here lets the street address win, which is what a
   * human would have typed anyway.
   */
  const isCentroid = !!(stored && centroid
    && Math.abs(stored.lat - centroid.lat) < 1e-4
    && Math.abs(stored.lng - centroid.lng) < 1e-4);
  const navCoords = (stored && !isCentroid) ? stored : null;

  return {
    name, address, locality, state, withheld,
    // ⚠ NO mapUrl AND NO navUrl ARE BUILT HERE, deliberately.
    // Both need things this module must not touch: the storage client (which
    // reads env at import time and would break every test that imports this
    // file) and `navigator` (a browser global). This module stays PURE — it is
    // the reason the event page is testable at all.
    //
    // EventPage assembles both from the fields below. `profileId` is what the
    // stored map's object path is derived from; `coords` is where navigation
    // is aimed. A withheld location yields neither, and that decision is made
    // HERE so a caller cannot forget it.
    mapUrl: null,
    profileId: withheld ? null : (venueProfile?.id || null),
    coords:    withheld ? null : (coords || null),
    // Aim directions here, never at `coords` — see the note above.
    navCoords: withheld ? null : (navCoords || null),
    // The locality map is drawn from the POSTCODE — one picture per postcode,
    // shared by every venue in it. Null when withheld: a secret location does
    // not get a map of its town either.
    postcode:  withheld ? null : (postcode || null),
    lat, lng,
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
/**
 * § 11 · The collectables shelf — the official poster plus the logos of the
 * profiles actually involved in this event: the venue, the host/owner, and
 * every act on the bill (owner, 2026-08-02).
 *
 * `logosByProfile` is `{ [profile_id]: [{id, url, file_name}] }`, fetched by the
 * caller — see profileAssetStore.fetchDistributableLogos. Only LOGO_PACK is
 * world-readable; nothing else in profile_assets may reach a public page.
 *
 * ── WHY THIS IS A PURE FUNCTION ──────────────────────────────────────
 * It decides WHICH profiles are involved and in what order, which is the part
 * worth testing. The fetch is dumb by comparison. Order is deliberate: venue,
 * then host, then the bill in lineup order — the same top-down reading order
 * the rest of the page uses.
 *
 * A profile is listed ONCE even when it holds two roles (a venue that hosts its
 * own night is one logo, not two), and a profile with no logo contributes
 * nothing rather than an empty tile — R1, absent is absent.
 */
export function buildCollectables({
  ownerProfile = null,
  venueProfile = null,
  lineup = [],
  logosByProfile = {},
} = {}) {
  const seen = new Set();
  const out = [];

  const push = (profile) => {
    const id = profile?.id;
    if (!id || seen.has(id)) return;
    seen.add(id);
    for (const logo of logosByProfile[id] || []) {
      if (!logo?.url) continue;
      out.push({
        id:       logo.id,
        url:      logo.url,
        filename: logo.file_name || '',
        // The alt text names the owner, because that is the only thing that
        // distinguishes one logo tile from another to a screen reader.
        alt:      `${profile.name || 'Profile'} logo`,
      });
    }
  };

  push(venueProfile);
  push(ownerProfile);
  for (const act of lineup) push(act);

  return out;
}

export function buildEventView({
  event = {},
  ownerProfile = null,
  venueProfile = null,
  // Defaults to empty, so every existing caller and every test that predates
  // co-hosts keeps its exact current output rather than needing updating.
  coHostProfiles = [],
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
      // R1 · the Hero takes what exists and no more. An event with no Cover
      // lands on the poster rungs — and the Poster section still renders the
      // artwork whole further down. The hero is an ARTEFACT, never an
      // information source: duplication between what the poster says and what
      // the page says is expected and correct.
      //
      // ⭐ COVER IS NOW READ (2026-08-04). It was hardcoded `null` — "there is
      // no Cover field in this schema yet" — which collapsed spec §0 into one
      // image: `poster` drove the cropped Hero AND the whole-artwork Poster
      // section, so an event could not have a promo shot at the top and its
      // real flyer at the bottom. The spec has always separated them ("the
      // Cover sells the experience, the Poster preserves the artwork"), and
      // heroMedia's rungs 1–2 were already written for it; only this line was
      // missing.
      //
      // Additive by construction: no event carries `cfg.cover` today, so every
      // existing event keeps the exact hero it has. Setting one opts that
      // event up to rung 2, which §0.3 says supersedes the poster derivation.
      cover: cfg.cover ? { url: cfg.cover } : null,
      // Rung 1 — the carousel. Written by the editor's poster-crop tool: an
      // organiser keeps several bands off one flyer (the title, the dates, the
      // act) and they become slides. Stored as bare URLs, shaped here into the
      // {url} heroMedia expects, because the config should stay the simplest
      // thing that survives a hand-edit.
      //
      // Non-strings and blanks are dropped rather than passed on: heroMedia's
      // `usable` would reject them anyway, but silently — and a slide missing
      // from a carousel is far harder to notice than one that never loads.
      gallery: Array.isArray(cfg.gallery)
        ? cfg.gallery.filter(u => typeof u === 'string' && u.trim()).map(url => ({ url }))
        : [],
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
      // The owner presents, where one is known and is not simply the venue
      // again.
      //
      // ⚠ A VENUE THAT RUNS ITS OWN NIGHT IS ONE ENTITY, NOT TWO
      // (owner, The Bellingen Brewing Co / Tigersnake, 2026-08-02).
      // `owner_profile_id` frequently equals `venue_profile_id` — a pub
      // promoting its own gig is the normal case, not an edge one. Presenting
      // it here as well as in § 7 drew the same portrait twice on one page,
      // once labelled VENUE and once as the presenter, which reads as two
      // businesses with the same name rather than one doing both jobs.
      //
      // § 7's venue card is the survivor because it is the more specific
      // claim: it names where the event physically is. "Presented by" adds
      // nothing when the answer is the venue you just read.
      presenter: ownerProfile?.name && ownerProfile.id !== venueProfile?.id
        ? {
            name: ownerProfile.name,
            type: ownerProfile.type || 'host',
            bio:  ownerProfile.bio || null,
            profile: ownerProfile,
          }
        : null,

      /**
       * ⭐ CO-HOSTS — EQUAL BILLING, UNEQUAL AUTHORITY (owner, 2026-08-04:
       * "have one main host, then the other looks like they have equal
       * representation, but only the main host can edit").
       *
       * They render as the same card at the same size as the presenter above,
       * because that is what co-presenting a night looks like to a reader. The
       * distinction the owner drew is about who may CHANGE the event, and that
       * lives entirely in `owner_profile_id` and the `event_hosts` policies —
       * not in how large anyone's picture is. Attribution is not authorization
       * (Identity Architecture v1.0), and this is the clearest case of it on
       * the page: the two hosts look identical and can do different things.
       *
       * ⚠ Deduped against the presenter AND the venue. `useEventData` already
       * drops a row naming the owner, but a co-host that is ALSO the venue
       * would draw the same portrait § 7 just drew — the exact duplication
       * that got the venue fallback deleted from this section. Both guards
       * live here so the component never has to know.
       */
      coHosts: (coHostProfiles || [])
        .filter(p => p?.name && p.id !== ownerProfile?.id && p.id !== venueProfile?.id)
        .map(p => ({
          name: p.name,
          type: p.type || 'host',
          bio:  p.bio || null,
          profile: p,
        })),
      venue: venue.name && !venue.withheld
        ? { name: venue.name, bio: venueProfile?.bio || null, profile: venueProfile }
        : null,
    },

    poster: poster ? { url: cfg.poster_full || poster, alt: event.name || 'Event poster' } : null,

    sources: buildSources({ event, cfg, now }),
  };
}

export { DEFAULT_CROP_Y };
