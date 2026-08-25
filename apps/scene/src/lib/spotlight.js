import { eventCoords, withinRadius } from './geo';
import { favouriteReason } from './sceneFloor';

/**
 * SPOTLIGHT — the heartbeat of My Scene.
 *
 * My Scene answers "what should I be paying attention to today?", so Spotlight
 * is not a featured-events carousel: it is the small set of things that have
 * EARNED attention, each carrying a human-readable reason.
 *
 * ── THE TWO AXES ─────────────────────────────────────────────────────
 *
 *   RELATIONSHIP STRENGTH decides which KINDS of attention qualify — that is
 *   the rule order below, walked top to bottom.
 *   IMMINENCE decides which INSTANCE — each rule has a horizon that gates
 *   eligibility, and within a rule the soonest event wins.
 *
 * Without the second axis a punter hosting five gigs over six months gets a
 * rail of their own events — one of them five months away — while tonight's
 * gig at their favourite venue never appears. Relationship order alone
 * answers "what is my strongest tie?", which is not the question this page asks.
 *
 * ── WHY A DECLARED TABLE AND NOT A SCORE ─────────────────────────────
 *
 * A weighted score would collapse the reason into a number, and the reason is
 * the product. A rule table is explainable (the badge IS the explanation),
 * debuggable (exactly one rule selected each card), extensible (a new
 * capability is a new row, not a retuned model) and honest (a RESERVED row
 * declares a capability that does not exist yet rather than faking it).
 *
 * A score becomes justified only when two rules demonstrably conflict often in
 * real usage and neither should dominate. That conflict has to be NAMED from
 * live data first — see docs/../memory my-scene-philosophy.
 *
 * ── THE TWO WAYS THIS RAIL FAILS ─────────────────────────────────────
 *
 *   1. It duplicates the section below it. Five cards from one rule is just
 *      UPCOMING with a different heading, so every rule carries a CAP and
 *      the rail is built from a SPREAD of reasons.
 *   2. It pads. The rail is UP TO five, never exactly five — its length is an
 *      honest readout of how well the user has taught their scene, which is
 *      the reward loop expressed as page structure rather than a progress bar.
 */

/** Default attention horizon. Tunable; per-rule overrides sit in the table. */
export const DEFAULT_HORIZON_DAYS = 14;

/** Most cards the rail will ever show. Fewer is normal and correct. */
export const SPOTLIGHT_LIMIT = 5;

/**
 * THE RULES TABLE — read this top to bottom and you know everything My Scene
 * can currently perceive.
 *
 *   badge        the explanation shown to the user; never invent one that
 *                would not be honest printed on the card
 *   cap          most cards this one rule may contribute (spread of reasons)
 *   horizonDays  how far ahead this rule looks
 *   order        'date' = soonest event first (the default, and the rule the
 *                imminence axis implies). 'created' is used ONLY where the
 *                reason IS the announcement rather than the date.
 *   reserved     declared but never matches — the capability does not exist
 *                yet. Deliberately NOT placeholder behaviour: the row
 *                documents the gap, and lights up when the data arrives.
 */
export const SPOTLIGHT_RULES = [
  {
    key: 'my_event', badge: 'MY EVENT', cap: 2, horizonDays: DEFAULT_HORIZON_DAYS,
    match: (ev, c) => c.myEventIds.has(ev.id),
  },
  {
    key: 'playing', badge: 'PLAYING', cap: 2, horizonDays: DEFAULT_HORIZON_DAYS,
    match: (ev, c) => c.playingEventIds.has(ev.id),
  },
  {
    // RESERVED · today a hosted event IS "my event" (events.host_id is the
    // account that created it), so this rule could only ever restate the
    // first one. It lights up if a hosting relationship distinct from
    // ownership ever exists — e.g. co-hosting an event owned by another
    // profile. Left declared so the gap is visible rather than forgotten.
    key: 'hosting', badge: 'HOSTING', cap: 1, horizonDays: DEFAULT_HORIZON_DAYS,
    reserved: true,
  },
  {
    // RESERVED · no crew/working relationship type exists. There is no table
    // that records "I am working this event but not performing at it".
    key: 'working', badge: 'WORKING', cap: 1, horizonDays: DEFAULT_HORIZON_DAYS,
    reserved: true,
  },
  {
    // RESERVED · a followed event is the ONLY attendance state today, and it
    // renders as SAVED. Splitting Interested from Going is Stage D work,
    // deliberately deferred until friends-attending gives "Going" a social
    // meaning that earns the extra friction.
    key: 'going', badge: 'GOING', cap: 2, horizonDays: DEFAULT_HORIZON_DAYS,
    reserved: true,
  },
  {
    key: 'saved', badge: 'SAVED', cap: 2, horizonDays: DEFAULT_HORIZON_DAYS,
    match: (ev, c) => c.savedEventIds.has(ev.id),
  },
  {
    key: 'fav_venue', badge: 'FAVOURITE VENUE', cap: 2, horizonDays: DEFAULT_HORIZON_DAYS,
    match: (ev, c) => favouriteReason(ev, c.favProfileIds, c.favUserIds) === 'venue',
  },
  {
    key: 'fav_host', badge: 'FAVOURITE HOST', cap: 2, horizonDays: DEFAULT_HORIZON_DAYS,
    match: (ev, c) => favouriteReason(ev, c.favProfileIds, c.favUserIds) === 'host',
  },
  /* ⚠ THE `fav_genre` RULE IS GONE (2026-08-24). It matched on the punter's
     declared genres, and YOUR SCENE — the only surface that could ever write
     `profiles.genre_string` for a punter — was removed with it. A rule whose
     input nothing can set does not fail quietly, it never fires: better to
     delete the row than leave the table claiming a capability it lost.
     If genre attention returns it should be DERIVED (the genres of the events
     you save and the acts you follow), not declared — see the derived-state
     law. The `genres` context key and eventMatchesGenres went with it. */
  {
    // The reason here is the ANNOUNCEMENT, not the date — so this rule orders
    // by created_at and looks further ahead than the default. A festival that
    // just dropped is attention-worthy at two months out; a gig next Tuesday
    // announced six weeks ago is not news.
    key: 'just_announced', badge: 'JUST ANNOUNCED', cap: 1, horizonDays: 60, order: 'created',
    match: (ev, c) => !!(c.newSinceIso && ev.created_at && ev.created_at >= c.newSinceIso),
  },
  {
    key: 'this_weekend', badge: 'THIS WEEKEND', cap: 1, horizonDays: DEFAULT_HORIZON_DAYS,
    match: (ev, c) => !!(ev.config?.date >= c.weekendFrom && ev.config?.date <= c.weekendTo),
  },
  {
    // FALLBACK · a curated pick, with a deliberately longer horizon. "Don't
    // miss this" reaches further than "what's on this week", and without the
    // longer reach a quiet fortnight in a thin region leaves a brand-new
    // punter with no heartbeat at all on first open.
    //
    // ⚠ config.featured IS set by hand in Studio, so this is genuine curation
    // — but the badge must never imply a staffed editorial desk. SPOTLIGHT
    // claims nothing about who chose it, which is why it is the honest word.
    key: 'spotlight', badge: 'SPOTLIGHT', cap: 1, horizonDays: 90,
    match: (ev) => !!ev.config?.featured,
  },
];

/** ISO date `days` after `iso`. Pure — no Date.now(), so it stays testable. */
function addDays(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Build the rail.
 *
 * @returns {{items: Array<{event: object, badge: string, ruleKey: string}>}}
 *          At most SPOTLIGHT_LIMIT entries, possibly zero. NEVER padded.
 */
export function buildSpotlight({
  events, todayIso,
  myEventIds, playingEventIds, savedEventIds,
  favProfileIds, favUserIds,
  originCoords, originPostcode, radiusKm,
  weekendFrom, weekendTo, newSinceIso,
  limit = SPOTLIGHT_LIMIT,
}) {
  const ctx = {
    myEventIds:     myEventIds     || new Set(),
    playingEventIds: playingEventIds || new Set(),
    savedEventIds:  savedEventIds  || new Set(),
    favProfileIds:  favProfileIds  || new Set(),
    favUserIds:     favUserIds     || new Set(),
    weekendFrom, weekendTo, newSinceIso,
    // Same "unknown is not far" rule the floor uses: an event we cannot place
    // is not claimed to be nearby. With no radius set, nearby is vacuously true.
    isNearby: (ev) => {
      if (!originCoords || radiusKm === null || radiusKm === undefined) return true;
      const c = eventCoords(ev, ev.venue);
      if (!c) return false;
      const pc = ev.venue_profile_id ? ev.venue?.postcode : ev.postcode;
      return withinRadius(originCoords, c, radiusKm, originPostcode, pc);
    },
  };

  const upcoming = (events || []).filter(ev => ev?.config?.date && ev.config.date >= todayIso);
  const taken = new Set();
  const items = [];

  for (const rule of SPOTLIGHT_RULES) {
    if (items.length >= limit) break;
    if (rule.reserved) continue;          // declared, never matches — by design

    const until = addDays(todayIso, rule.horizonDays);
    const matched = upcoming.filter(ev =>
      !taken.has(ev.id) && ev.config.date <= until && rule.match(ev, ctx));

    matched.sort(rule.order === 'created'
      ? (a, b) => (b.created_at || '').localeCompare(a.created_at || '')
      : (a, b) => a.config.date.localeCompare(b.config.date));

    for (const ev of matched.slice(0, rule.cap)) {
      if (items.length >= limit) break;
      taken.add(ev.id);
      items.push({ event: ev, badge: rule.badge, ruleKey: rule.key });
    }
  }

  return { items };
}
