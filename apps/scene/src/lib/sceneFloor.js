import { eventCoords, withinRadius } from './geo';
import { ALL_GENRES, HOST_GENRES, HOST_CATEGORIES } from './profileTaxonomy';

/**
 * SCENE FLOOR — the catalogue slice that keeps My Scene alive.
 *
 * My Scene's personal sections are relationship-gated, so a punter with no
 * follows and no saved events used to see a page of dimmed placeholder rows.
 * The floor replaces that with REAL catalogue events, personalised by two
 * cheap defaults (radius + genres), and every floor card carries the save
 * heart — each tap converts a catalogue item into a relationship that feeds
 * the personal sections. The page bootstraps itself out of emptiness.
 *
 * Three sections, all computed here so the selection rules are testable and
 * the counts provably come from the code that filters (Discovery 2.1):
 *
 *   AROUND YOU     radius + genre filtered, with a deterministic fallback
 *                  ladder — expand radius first (genres intact), then relax
 *                  genres (back at the requested radius). The user's selected
 *                  radius is REMEMBERED; the list only borrows a wider one.
 *   JUST ANNOUNCED newest additions to the gig guide. No geo at all, so thin
 *                  location coverage can never empty the whole floor.
 *   THIS WEEKEND   Fri–Sun window. Hides when empty, same law as What's On.
 *
 * ⚠ UNKNOWN ≠ FAR. An event that cannot be placed is excluded from a km
 * radius (a distance we don't know is not a distance inside 20 km) but is
 * INCLUDED by "Anywhere" — the ladder's last rung — and is always eligible
 * for Just Announced / This Weekend. Nothing is silently dropped from the
 * floor as a whole for lacking a postcode.
 *
 * No demo data enters here, ever. The floor is real events or nothing — an
 * empty section hides rather than renders a placeholder.
 */

/** Radius steps the floor offers. null = "Anywhere" (no radius cap).
 *  2 km is deliberately absent — useful in a city, meaningless where the
 *  nearest venue can be 40 km away. 20 (not 25) matches geo.js RADIUS_STEPS. */
export const SCENE_RADIUS_STEPS = [5, 10, 20, 50, 100, null];

export const DEFAULT_SCENE_RADIUS = 50;

/** Chip-strip vocabulary: the canonical taxonomy minus the two entries that
 *  are event descriptions, not preferences. */
export const SCENE_GENRES = ALL_GENRES.filter(g => g !== 'Multi Genre' && g !== 'Other');

/**
 * PROGRESSIVE TUNE vocabulary — three broad categories that expand into
 * their genre buckets, straight from the canonical taxonomy (same labels the
 * host picker uses: Electronic Music / Bands / Comedy·Spoken Word).
 *
 * A selection may contain a CATEGORY KEY ('ELECTRONIC' — the "ALL" chip,
 * meaning the whole bucket) or individual genre labels. The two are mutually
 * exclusive PER CATEGORY — toggleSceneGenre enforces it — and
 * expandGenreSelection resolves both to plain genre labels before matching,
 * so buildSceneFloor never sees a key. Keys are stored in genre_string
 * alongside genres, mirroring how host profiles already store category keys.
 */
export const SCENE_CATEGORIES = HOST_CATEGORIES.filter(c => c.enabled).map(c => ({
  key: c.key,
  label: c.label,
  genres: (HOST_GENRES[c.key] || []).filter(g => g !== 'Multi Genre' && g !== 'Other'),
}));

export const SCENE_CATEGORY_KEYS = SCENE_CATEGORIES.map(c => c.key);

/** True for anything a stored selection may legally contain. Parsers use this
 *  so a host-format genre_string (subgenres, vibes) can't leak into prefs. */
export function isValidSceneToken(t) {
  return SCENE_CATEGORY_KEYS.includes(t) || SCENE_GENRES.includes(t);
}

/** Resolve a selection (genre labels + category keys) to plain genre labels. */
export function expandGenreSelection(selection) {
  const out = new Set();
  (selection || []).forEach(t => {
    const cat = SCENE_CATEGORIES.find(c => c.key === t);
    if (cat) cat.genres.forEach(g => out.add(g));
    else out.add(t);
  });
  return [...out];
}

/**
 * Toggle one chip in a selection, keeping ALL-vs-specific exclusive per
 * category: picking the ALL chip clears that category's individual genres;
 * picking a genre clears that category's ALL key. `categoryKey` is the
 * bucket the tap happened in — needed because a few genres (Hip-Hop, Funk)
 * appear in more than one bucket.
 */
export function toggleSceneGenre(selection, token, categoryKey) {
  const sel = selection || [];
  if (sel.includes(token)) return sel.filter(t => t !== token);
  const asCat = SCENE_CATEGORIES.find(c => c.key === token);
  if (asCat) return [...sel.filter(t => !asCat.genres.includes(t)), token];
  return [...sel.filter(t => t !== categoryKey), token];
}

const AROUND_CAP = 12;
const ANNOUNCED_CAP = 8;
const WEEKEND_CAP = 8;

function genreTokens(str) {
  return String(str || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
}

/**
 * Does this event match ANY selected genre?
 *
 * A selected genre matches an event token by equality OR containment
 * ("House" matches "Tech House", "Trance" matches "Psytrance") — those are
 * musically true positives, and the rule stays explainable in one sentence.
 * No selection = everything matches. An event with NO genres fails a genre
 * filter (we can't claim a match we can't see) but reaches the user via the
 * relax rung of the ladder and the non-genre sections.
 */
export function eventMatchesGenres(event, selected) {
  if (!selected || !selected.length) return true;
  const tokens = genreTokens(event?.config?.genres);
  if (!tokens.length) return false;
  // Category keys expand to their whole bucket; plain labels pass through.
  return expandGenreSelection(selected).some(g => {
    const needle = String(g).trim().toLowerCase();
    return needle && tokens.some(t => t === needle || t.includes(needle));
  });
}

/**
 * WHICH favourite an event belongs to — 'venue', 'host', or null.
 *
 * ONE implementation, three call sites: the floor sorts favourites first with
 * it, the screen badges cards with it, and Spotlight's favourite rules match
 * on it. If any of those disagreed, a card would jump the queue while
 * claiming no reason — exactly the silent failure the reason badges exist to
 * prevent. Venue is tested first because it is the more specific claim: an
 * event at your favourite venue that a followed host also runs reads better
 * as "your venue" than "your host".
 */
export function favouriteReason(ev, favProfileIds, favUserIds) {
  if (!ev) return null;
  if (favProfileIds?.has(ev.venue_profile_id)) return 'venue';
  if (favProfileIds?.has(ev.owner_profile_id) || favUserIds?.has(ev.host_id)) return 'host';
  return null;
}

function eventPostcode(ev) {
  // Same precedence as geo.js eventCoords: a linked event's own columns are
  // never read — the venue owns its location.
  return ev.venue_profile_id ? ev.venue?.postcode : ev.postcode;
}

function inRadius(ev, r, originCoords, originPostcode) {
  if (r === null) return true; // Anywhere — includes the unplaceable, deliberately
  const c = eventCoords(ev, ev.venue);
  if (!c) return false;        // unknown ≠ far, but a km radius cannot admit it
  return withinRadius(originCoords, c, r, originPostcode, eventPostcode(ev));
}

/**
 * @param {object}   o
 * @param {object[]} o.events          catalogue rows (useEvents shape: config,
 *                                     created_at, venue embed, postcode…)
 * @param {string}   o.todayIso        'YYYY-MM-DD' — passed in, never computed
 *                                     here, so the module stays pure/testable
 * @param {string}   o.weekendFrom     Friday, from lib/dates weekendRange()
 * @param {string}   o.weekendTo       Sunday
 * @param {string}   o.newSinceIso     created_at cutoff for Just Announced
 * @param {object}   [o.originCoords]  {lat,lng} or null when no postcode set
 * @param {string}   [o.originPostcode]
 * @param {number|null} o.radiusKm     requested radius; null = Anywhere
 * @param {string[]} [o.genres]        selected genre labels and/or category keys
 * @param {Set}      [o.excludeEventIds] events already in personal sections
 * @param {Set}      [o.favProfileIds] followed PROFILE ids — events at these
 *                                     venues / by these owners list FIRST in
 *                                     Around You (a deterministic rule, not a
 *                                     score: favourites lead, date order holds
 *                                     within each group)
 * @param {Set}      [o.favUserIds]    followed legacy ACCOUNT ids, matched
 *                                     against events.host_id
 */
export function buildSceneFloor({
  events, todayIso, weekendFrom, weekendTo, newSinceIso,
  originCoords, originPostcode, radiusKm, genres = [],
  excludeEventIds, favProfileIds, favUserIds,
}) {
  const isFavourite = ev => favouriteReason(ev, favProfileIds, favUserIds) !== null;
  const excluded = excludeEventIds || new Set();
  const upcoming = (events || [])
    .filter(ev => ev?.config?.date && ev.config.date >= todayIso && !excluded.has(ev.id))
    .sort((a, b) => a.config.date.localeCompare(b.config.date));

  // ── AROUND YOU ─────────────────────────────────────────────────────
  let aroundYou;
  if (!originCoords) {
    aroundYou = { items: [], count: 0, noOrigin: true, requestedRadius: radiusKm ?? DEFAULT_SCENE_RADIUS, usedRadius: null, genresRelaxed: false };
  } else {
    const steps = SCENE_RADIUS_STEPS;
    // A stored value that is no longer a step must never SHRINK the request —
    // snap up to the next step, or to Anywhere when it exceeds them all.
    let startIdx = steps.findIndex(s => s === (radiusKm ?? null));
    if (startIdx === -1) startIdx = steps.findIndex(s => s !== null && s >= radiusKm);
    if (startIdx === -1) startIdx = steps.length - 1;
    const requested = steps[startIdx];

    let found = null;
    outer:
    for (const useGenres of (genres.length ? [true, false] : [true])) {
      for (let i = startIdx; i < steps.length; i++) {
        const r = steps[i];
        const matched = upcoming.filter(ev =>
          inRadius(ev, r, originCoords, originPostcode)
          && (!useGenres || eventMatchesGenres(ev, genres)));
        if (matched.length) {
          found = { matched, usedRadius: r, genresRelaxed: !useGenres };
          break outer;
        }
      }
    }
    // Favourite venues / hosts lead the section; chronological within each
    // group (Array.prototype.sort is stable, and `matched` arrives date-
    // sorted from `upcoming`).
    if (found) found.matched.sort((a, b) => (isFavourite(a) ? 0 : 1) - (isFavourite(b) ? 0 : 1));
    aroundYou = found
      ? {
          // count and items come from the SAME filtered array — the label a
          // user reads is provably the list they scroll (Discovery 2.1).
          items: found.matched.slice(0, AROUND_CAP),
          count: found.matched.length,
          requestedRadius: requested,
          usedRadius: found.usedRadius,
          genresRelaxed: found.genresRelaxed,
          noOrigin: false,
        }
      : { items: [], count: 0, requestedRadius: requested, usedRadius: null, genresRelaxed: false, noOrigin: false };
  }

  // ── JUST ANNOUNCED ─────────────────────────────────────────────────
  // Dedupe against what is actually ON SCREEN above, not against everything
  // Around You matched — a match beyond the display cap isn't visible, so
  // suppressing it here would hide it twice.
  const shown = new Set(aroundYou.items.map(ev => ev.id));
  const justAnnounced = upcoming
    .filter(ev => !shown.has(ev.id) && ev.created_at && newSinceIso && ev.created_at >= newSinceIso)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, ANNOUNCED_CAP);
  justAnnounced.forEach(ev => shown.add(ev.id));

  // ── THIS WEEKEND ───────────────────────────────────────────────────
  const thisWeekend = upcoming
    .filter(ev => !shown.has(ev.id) && ev.config.date >= weekendFrom && ev.config.date <= weekendTo)
    .slice(0, WEEKEND_CAP);

  return { aroundYou, justAnnounced: { items: justAnnounced }, thisWeekend: { items: thisWeekend } };
}
