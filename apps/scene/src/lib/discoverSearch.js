// Discover search — what matches, and what order it comes back in.
//
// Two separate jobs, deliberately kept apart because the owner described them
// separately (2026-08-17):
//
//   RELEVANCE decides WHICH gigs come back. "if someone types drum and bass
//   bellingen, or techno at mem hall, or lists a few artists together itll
//   show the gigs that most likley correspond" — so a query is a bag of words
//   matched across every field an event has, not one string matched against
//   its name.
//
//   TIME decides the ORDER. "i type the party im tyring to find, i dont want
//   the on from 4 years ago. closest time to me, upcoming first, then the rest
//   of whats coming up, then once all the upcoming events are shown, work
//   backwards in time."
//
// ⭐⭐ THE SEARCH INDEX MAY NEVER REVEAL WHAT THE EVENT PAGE HIDES. A withheld
// location is a decision (eventViewModel R1), and matching on a secret venue
// name would turn the search box into an oracle for it: type a venue, see
// whether the secret party is there. So the haystack is built THROUGH
// buildVenue rather than out of `config` directly, and it indexes exactly what
// a reader would have been shown — the area yes, the building no.
//
// Pure by design: no supabase, no React. The screen fetches, this ranks.

import { buildVenue, readDate } from '../screens/event/eventViewModel';

/**
 * Grammatical connectors only.
 *
 * ⚠ NOTHING WITH MEANING IN A GIG NAME. "night", "live", "club", "house" and
 * "bass" all look like noise and are all load-bearing here — dropping "house"
 * would break the single most likely genre search in the app. This list is
 * words that carry no signal in ANY query, which is why it is this short.
 *
 * Dropping "and" costs nothing: "drum and bass" still matches on drum + bass.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'at', 'for', 'from', 'in', 'into', 'of', 'on', 'or',
  'the', 'to', 'with',
]);

/** Enough for "drum and bass bellingen friday warehouse"; a bound on the work. */
const MAX_TOKENS = 8;

/**
 * A query string becomes a bag of lowercase words.
 *
 * ⚠ SPLITS ON EVERYTHING THAT IS NOT a-z0-9, apostrophes included. Tokens are
 * therefore strictly [a-z0-9]+, which is what makes them safe to interpolate
 * into a PostgREST `or=(…)` filter — a comma or a percent in a token would
 * otherwise change the meaning of the whole query string. ⛔ Do not relax this
 * without escaping at the call site.
 *
 * ⚠ A QUERY OF PURE STOPWORDS FALLS BACK TO ITSELF. Without that, typing "the"
 * yields no tokens, which every caller here reads as "no query" — and the
 * search would silently turn into "show me everything".
 */
export function tokenise(q) {
  const raw = String(q ?? '').toLowerCase();
  const seen = new Set();
  const out = [];
  for (const part of raw.split(/[^a-z0-9]+/)) {
    if (part.length < 2) continue;        // keeps "dj", drops stray letters
    if (STOPWORDS.has(part)) continue;
    if (seen.has(part)) continue;
    seen.add(part);
    out.push(part);
    if (out.length === MAX_TOKENS) break;
  }
  if (out.length) return out;
  const bare = raw.replace(/[^a-z0-9]+/g, '');
  return bare.length >= 2 ? [bare] : [];
}

/** How many of the query's words this text contains. */
export function scoreTokens(haystack, tokens) {
  if (!tokens.length) return 0;
  const h = String(haystack || '').toLowerCase();
  let n = 0;
  for (const t of tokens) if (h.includes(t)) n += 1;
  return n;
}

/**
 * Everything about an event that a search is allowed to see.
 *
 * ⚠ THE VENUE COMES FROM buildVenue, NOT FROM `config`. That is the whole
 * privacy guarantee: buildVenue is where `locationWithheld` is resolved, so a
 * secret address cannot reach this string by being read from a different
 * spelling of the same config key. The area (locality, state, and the postcode
 * buildVenue chose to expose) stays searchable even when withheld, exactly as
 * the Identity line still names the area.
 *
 * ⚠ `artistNames` ARE THE BILL AS PUBLISHED. They come from lineup_members
 * rows that are on_bill, which is the same set EventArtistsSection renders, so
 * indexing them reveals nothing a reader could not already scroll to.
 */
export function eventHaystack(event = {}, { artistNames = [] } = {}) {
  const cfg = event.config || {};
  const venue = buildVenue({ event, cfg, venueProfile: event.venue || null });
  const parts = [
    event.name,
    cfg.description, cfg.bio, cfg.genres,
    venue.locality, venue.state, venue.postcode,
  ];
  // ⛔ THE BUILDING, ONLY WHEN IT IS NOT A SECRET.
  if (!venue.withheld) parts.push(venue.name, venue.address);
  for (const n of artistNames) parts.push(n);
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/**
 * ⚠ `genre_string` HOLDS ROLE KEYS (`dj_prod`), so it is MATCHED here and must
 * never be printed from this string — see genreLabels() for display. Matching
 * on it is what makes a role or genre search find the right people.
 */
export function profileHaystack(p = {}) {
  return [
    p.name, p.sound, p.genre_string, p.location, p.suburb, p.state,
    p.bio, p.venue_type, p.type,
  ].filter(Boolean).join(' ').toLowerCase();
}

export const TIME_UPCOMING = 0;
export const TIME_PAST     = 1;
export const TIME_UNDATED  = 2;

/**
 * ⚠ A CALENDAR DATE, NOT AN INSTANT — and this is NOT the UTC slice trap.
 * `config.date` is authored by the app's own date picker as a local YYYY-MM-DD
 * string, so comparing it against today() (which is local, from lib/dates) is
 * a day-to-day comparison with no timezone in it. The slice only trims a
 * legacy row that stored a fuller string. ⛔ Do not "fix" this into a Date.
 */
export function timeBucket(date, todayStr) {
  if (!date) return TIME_UNDATED;
  return String(date).slice(0, 10) >= todayStr ? TIME_UPCOMING : TIME_PAST;
}

/**
 * Upcoming soonest-first, then the past working backwards, undated last.
 *
 * The two halves sort in OPPOSITE directions on purpose: the next gig and the
 * most recent past gig are both the ones nearest to now, and "nearest to now"
 * is the whole ask.
 */
export function compareByTime(a, b, todayStr) {
  const ba = timeBucket(a, todayStr);
  const bb = timeBucket(b, todayStr);
  if (ba !== bb) return ba - bb;
  if (ba === TIME_UNDATED) return 0;
  const x = String(a).slice(0, 10);
  const y = String(b).slice(0, 10);
  if (x === y) return 0;
  return ba === TIME_UPCOMING ? (x < y ? -1 : 1) : (x > y ? -1 : 1);
}

/**
 * Rank events: best match first, and within an equal match, nearest in time.
 *
 * ⭐ SCORE OUTRANKS TIME, AND FOR A ONE-WORD SEARCH THAT COSTS NOTHING —
 * every hit scores 1, so the whole list collapses to pure time order, which is
 * the case the owner described. It only bites on a multi-word query, where an
 * upcoming event matching one word out of three must not outrank the event
 * that matched all three.
 *
 * With no tokens (a filter-only search) nothing is dropped and the list is
 * ordered by time alone.
 */
export function rankEvents(events = [], tokens = [], { todayStr, artistNamesByEvent = {} } = {}) {
  const scored = events.map(ev => ({
    ev,
    score: tokens.length
      ? scoreTokens(eventHaystack(ev, { artistNames: artistNamesByEvent[ev.id] || [] }), tokens)
      : 0,
    date: readDate(ev.config || {}),
  }));
  const kept = tokens.length ? scored.filter(r => r.score > 0) : scored;
  kept.sort((a, b) => (b.score - a.score) || compareByTime(a.date, b.date, todayStr));
  return kept.map(r => r.ev);
}

/**
 * Rank profiles: best match first, then most recently updated.
 *
 * ⚠ Recency is the tiebreak rather than the sort, so a profile that matches
 * every word cannot be buried by a barely-related one that was touched today.
 */
export function rankProfiles(profiles = [], tokens = []) {
  if (!tokens.length) return profiles.slice();
  return profiles
    .map(p => ({ p, score: scoreTokens(profileHaystack(p), tokens) }))
    .filter(r => r.score > 0)
    .sort((a, b) => (b.score - a.score)
      || String(b.p.updated_at || '').localeCompare(String(a.p.updated_at || '')))
    .map(r => r.p);
}

/**
 * The `or=(…)` filter that fetches every profile matching ANY word.
 *
 * Deliberately WIDE at the database and narrow in rankProfiles: the query's
 * job is to bring back candidates, scoring decides which of them the reader
 * actually sees. Asking the database for "matches all words" instead would
 * lose "techno bellingen" the moment the town lives on one field and the genre
 * on another, which is the normal case.
 */
export function profileOrFilter(tokens, fields) {
  const clauses = [];
  for (const t of tokens) for (const f of fields) clauses.push(`${f}.ilike.%${t}%`);
  return clauses.join(',');
}
