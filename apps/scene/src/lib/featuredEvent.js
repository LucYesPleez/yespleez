import { eventCoords, withinRadius } from './geo';
import { eventCardImage } from './eventImage';
import { effectiveDate } from './eventBuckets';

/**
 * FEATURED EVENT — an exposure allocator, not a popularity leaderboard.
 *
 * The hero slot on What's On answers "the event YesPleez thinks is most worth
 * showing this person right now" — never "the event with the highest score in
 * Australia". Its constitutional rule:
 *
 *   Featured exists to distribute useful exposure fairly, not to reward
 *   whoever is already biggest or whoever pays the most.
 *
 * ── WHY A SCORE HERE, WHEN SPOTLIGHT REFUSES ONE ─────────────────────
 *
 * `spotlight.js` argues at length against scoring and it is right — for My
 * Scene. There the badge IS the product: every card states the relationship
 * that earned it, and a number would destroy that explanation.
 *
 * This surface asks a different question. What's On is the anonymous
 * catalogue; there is no relationship to name, so there is no badge to
 * protect. And the rules here genuinely conflict — an imminent gig, a
 * well-made listing and an act that has never had a turn all have a claim on
 * one slot, and none should always dominate. That is exactly the "two rules
 * demonstrably conflict and neither should win" test spotlight.js sets as the
 * bar for a score. ⛔ Do not copy this reasoning back to My Scene.
 *
 * ── ⚠⚠ THREE OF THE SEVEN FACTORS HAVE NO DATA, AND SAY SO ───────────
 *
 * Popularity, engagement and paid promotion are declared at their intended
 * weights and return `null` — the capability does not exist yet:
 *
 *   POPULARITY / ENGAGEMENT · blocked twice over, independently.
 *     1. `usage_events` never records an event id. `normaliseScreenPath()`
 *        rewrites `/event/<uuid>` to `/event/:id` ON THE CLIENT, and that is
 *        a ratified privacy control (analytics-vision §8), not tidiness.
 *     2. `follows` is read-your-own-only under RLS (`follows_select_own`), so
 *        a client counting saves on an event gets 1 or 0, never a total.
 *     Measured 2026-08-21 anyway: 27 event saves across 17 of 90 events, top
 *     event 4. One person's heart would reorder the whole slot.
 *
 *   PAID · there is no payments system in this repo. The factor exists so the
 *     ranking has a hook to receive a boost, capped by its weight.
 *
 * ⭐⭐ A null factor is DROPPED and the remaining weights RENORMALISE. It is
 * never scored 0. Zero would mean "measured, and it is zero" — punishing every
 * event for a table we do not have. This is the Rendering Contract's
 * absent-≠-unknown rule applied to ranking. The day the data arrives, the
 * factor starts contributing at exactly its declared weight with no change
 * here.
 *
 * ⚠ Availability is a CAPABILITY, decided once per call, never per event. If
 * saves become readable, an event with no saves scores 0 — that is a fact, not
 * an absence — and only a missing SOURCE renormalises.
 *
 * ── THE THREE WAYS THIS SLOT FAILS ───────────────────────────────────
 *
 *   1. It goes dark. The slot rendered nothing at all from 16 Aug 2026 because
 *      its one hand-set pick had passed and no code noticed. Hence the
 *      fallback horizon below: ⛔ a distant hero beats an empty one.
 *   2. One event colonises it. Hence the ledger, the cooldown and the
 *      allocation cap — the fairness half is the actual product.
 *   3. It quietly becomes an ad slot. Hence the paid factor being weighted
 *      (a ceiling by construction) rather than an unbounded additive boost,
 *      and hence `selectionType` riding out with the winner so the card can
 *      disclose a paid placement. ⛔ Never render a promoted pick as organic.
 */

// ── TUNING ───────────────────────────────────────────────────────────

/**
 * Declared weights. ⭐ These are the product decision; everything else here is
 * mechanism. They sum to 1 before renormalisation.
 */
export const FEATURED_WEIGHTS = {
  proximity:  0.25,
  quality:    0.15,
  popularity: 0.15,
  local:      0.10,
  discovery:  0.15,
  engagement: 0.10,
  paid:       0.10,
};

/** How far ahead the slot normally reaches. */
export const FEATURED_HORIZON_DAYS = 14;

/**
 * ⭐ Used ONLY when the primary horizon yields nothing eligible. A quiet
 * fortnight must not blank the hero — that is the exact defect this module
 * was written to fix.
 */
export const FEATURED_FALLBACK_HORIZON_DAYS = 90;

/** Consecutive daily allocations one event may hold before it must stand down. */
export const MAX_CONSECUTIVE_ALLOCATIONS = 3;

/** Days an event is barred from the slot after exhausting its run. */
export const COOLDOWN_DAYS = 3;

/** The window the anti-monopoly penalty looks back over. */
export const FAIRNESS_WINDOW_DAYS = 30;

/** Full penalty subtracted from an event that filled the whole fairness window. */
export const MAX_FAIRNESS_PENALTY = 0.35;

/**
 * The proximity ladder — days from today to the event's START.
 *
 * ⚠ Tonight and tomorrow are deliberately EQUAL. A hero is a plan you can
 * still act on, and by the time someone opens the app tonight's gig may
 * already have doors closed; tomorrow's never does.
 */
export const PROXIMITY_LADDER = [
  { withinDays: 1,  score: 1.00 },
  { withinDays: 3,  score: 0.80 },
  { withinDays: 7,  score: 0.55 },
  { withinDays: 14, score: 0.30 },
];

/** Beyond the last rung — reachable only via the fallback horizon. */
const DISTANT_PROXIMITY = 0.15;

/**
 * What a complete listing carries. Each present field is worth an equal share.
 *
 * ⚠⚠ THIS FACTOR FIGHTS `discovery` ON PURPOSE, AND THE BALANCE IS THE POINT.
 * Completeness correlates with how the row was authored: measured 2026-08-21,
 * 9 of 19 upcoming events had no `time`, and they are overwhelmingly importer
 * rows — the small and unknown acts `discovery` exists to lift. Quality and
 * discovery therefore carry the SAME weight, so a well-made listing wins on
 * merit but a plain one is never locked out. ⛔ Do not raise quality without
 * raising discovery with it.
 */
export const QUALITY_FIELDS = ['image', 'time', 'venue', 'genres', 'blurb', 'tickets'];

// ── PRIVATE HELPERS ──────────────────────────────────────────────────

/**
 * ISO date `days` after `iso`. Pure — no Date.now(), so it stays testable.
 * ⚠ Noon anchor, not midnight: `setDate` arithmetic across a DST boundary
 * lands on the wrong day from midnight. Same trick as spotlight.js.
 */
function addDays(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days from `fromIso` to `toIso`. Negative when `toIso` is in the past. */
function daysBetween(fromIso, toIso) {
  const a = new Date(fromIso + 'T12:00:00');
  const b = new Date(toIso + 'T12:00:00');
  return Math.round((b - a) / 86400000);
}

/**
 * The postcode a radius test must use.
 * ⚠ Same precedence as geo.js eventCoords: a linked event's own columns are
 * never read — the venue owns its location. A mismatch here silently desyncs
 * the postcode from the coordinate.
 */
function eventPostcode(ev) {
  return ev.venue_profile_id ? ev.venue?.postcode : ev.postcode;
}

/** First non-blank string among the candidates, else null. */
const firstText = (...vals) => vals.find(v => typeof v === 'string' && v.trim()) ?? null;

/** A non-empty list, whether it arrived as an array or a separator-joined string. */
function hasList(raw) {
  if (Array.isArray(raw)) return raw.some(v => typeof v === 'string' && v.trim());
  return typeof raw === 'string' && raw.trim().length > 0;
}

// ── EXPOSURE LEDGER ──────────────────────────────────────────────────

/**
 * Read helpers over the allocation ledger. An entry is `{ eventId, date }` —
 * one row per event per day it held the slot.
 *
 * ⭐ The ledger records what the PLATFORM ALLOCATED, never what any person
 * saw. Impressions-per-viewer would be browsing history under another name,
 * which the ratified privacy rule forbids; days-featured answers the fairness
 * question just as well and carries no personal data at all.
 */
export function summariseExposure(history = [], eventId, todayIso) {
  const mine = history
    .filter(h => h && h.eventId === eventId && h.date)
    .map(h => h.date)
    .sort();

  const windowFrom = addDays(todayIso, -FAIRNESS_WINDOW_DAYS);
  const recent = mine.filter(d => d >= windowFrom && d < todayIso);

  // A run is only "current" if it reaches yesterday unbroken. An event that
  // held the slot three days last month is not mid-run today.
  let consecutive = 0;
  for (let i = 1; i <= MAX_CONSECUTIVE_ALLOCATIONS + 1; i++) {
    if (mine.includes(addDays(todayIso, -i))) consecutive = i;
    else break;
  }

  return {
    total: mine.length,
    recent: recent.length,
    consecutive,
    lastDate: mine.length ? mine[mine.length - 1] : null,
  };
}

/**
 * Is this event barred from the slot today?
 *
 * ⚠ The cooldown is measured from the END of a maxed run, so an event that
 * ran its three days stands down for three, then competes again on merit.
 * ⛔ This is not a three-day reservation: every day is selected independently
 * (§8), so a run of three is something an event has to keep winning.
 */
export function inCooldown(exposure, todayIso) {
  if (exposure.consecutive >= MAX_CONSECUTIVE_ALLOCATIONS) return true;
  if (!exposure.lastDate) return false;
  // Only a maxed-out run triggers a cooldown; a single day does not.
  if (exposure.consecutive > 0) return false;
  const sinceLast = daysBetween(exposure.lastDate, todayIso);
  return sinceLast > 0 && sinceLast <= COOLDOWN_DAYS && exposure.recent >= MAX_CONSECUTIVE_ALLOCATIONS;
}

// ── EDITORIAL OVERRIDE ───────────────────────────────────────────────

/**
 * `config.featured` is the editorial channel — the SAME key the hand-set hero
 * has always used, deliberately reused rather than adding a third mechanism
 * beside it and `profiles.config.featured_event_id`.
 *
 * Two accepted shapes:
 *   `true`                                  legacy — active whenever eligible
 *   `{ from, to, reason, by }`              windowed, with an audit trail
 *
 * ⚠ An object is truthy, so `spotlight.js`'s `!!ev.config?.featured` keeps
 * working unchanged. ⛔ An override still passes every eligibility gate — it
 * cannot resurrect a finished event, and that is what took the slot dark
 * before: one `true` on an event dated 15 Aug, still set on 21 Aug.
 */
export function editorialOverride(event, todayIso) {
  const raw = event?.config?.featured;
  if (!raw) return null;
  if (raw === true) return { reason: null, by: null, legacy: true };
  if (typeof raw !== 'object') return null;
  if (raw.from && todayIso < raw.from) return null;
  if (raw.to && todayIso > raw.to) return null;
  return { reason: raw.reason ?? null, by: raw.by ?? null, legacy: false };
}

// ── ELIGIBILITY ──────────────────────────────────────────────────────

/**
 * Why an event cannot be featured today, or null if it can.
 *
 * ⭐ A gate only ever SUBTRACTS. Returning the reason rather than a boolean is
 * what makes "why is nothing featured?" answerable without a debugger.
 *
 * ⚠ There is no `cancelled` state on `events` — status is unconstrained text
 * whose only live values are draft/live/completed. `status === 'live'` is the
 * strongest statement available; a cancellation gate cannot be written until
 * the state exists.
 */
export function eligibilityFailure(event, { todayIso, horizonDays, history = [] }) {
  if (!event) return 'missing';
  if (event.status !== 'live') return 'not_live';
  if (event.is_public === false) return 'not_public';

  const start = event.config?.date;
  if (!start) return 'no_date';

  // endDate first — a festival running Fri–Sun is not over on Saturday.
  const ends = effectiveDate(event);
  if (ends && ends < todayIso) return 'finished';

  if (!eventCardImage(event)) return 'no_image';

  if (start > addDays(todayIso, horizonDays)) return 'beyond_horizon';

  const exposure = summariseExposure(history, event.id, todayIso);
  if (inCooldown(exposure, todayIso)) return 'cooldown';

  return null;
}

// ── THE FACTORS ──────────────────────────────────────────────────────
//
// Each returns 0..1, or null when its capability has no data source.

/** Imminence. The single strongest signal, and the only one always available. */
export function proximityScore(event, { todayIso }) {
  const start = event.config?.date;
  if (!start) return 0;
  const away = Math.max(0, daysBetween(todayIso, start));
  for (const rung of PROXIMITY_LADDER) {
    if (away <= rung.withinDays) return rung.score;
  }
  return DISTANT_PROXIMITY;
}

/**
 * How complete the listing is — a share per field present.
 * ⚠ Reads the legacy spellings the importer writes as well as the editor's.
 */
export function qualityScore(event) {
  const cfg = event?.config || {};
  const present = {
    image:   !!eventCardImage(event),
    time:    !!firstText(cfg.time, cfg.start_time, cfg.time_start),
    venue:   !!firstText(cfg.venue, cfg.venueName, cfg.address),
    genres:  hasList(cfg.genres),
    blurb:   !!firstText(cfg.bio, cfg.description),
    tickets: !!firstText(cfg.ticketLink, cfg.ticket_url),
  };
  const hits = QUALITY_FIELDS.filter(f => present[f]).length;
  return hits / QUALITY_FIELDS.length;
}

/**
 * ⛔ RESERVED — returns null until saves are readable in aggregate.
 * See the module header for the two independent blockers.
 */
export function popularityScore(_event, ctx) {
  if (!ctx.saveCounts) return null;
  const n = ctx.saveCounts.get(_event.id) || 0;
  // Diminishing returns by construction: the tenth save must not be worth ten
  // times the first, or one busy event monopolises the factor forever.
  return Math.min(1, Math.log10(n + 1) / Math.log10(ctx.saveCountCeiling || 50));
}

/** ⛔ RESERVED — no per-event engagement is recorded anywhere. */
export function engagementScore(_event, ctx) {
  if (!ctx.engagementCounts) return null;
  const n = ctx.engagementCounts.get(_event.id) || 0;
  return Math.min(1, n / (ctx.engagementCeiling || 100));
}

/**
 * Local relevance. ⚠ THREE OUTCOMES, NOT TWO — unknown is not far.
 * An event we cannot place scores the middle, never zero: 21 of 30 live events
 * were unplaceable when the radius filter shipped, and treating unknown as far
 * would hand the slot permanently to whoever happens to have a postcode.
 */
export function localScore(event, ctx) {
  if (!ctx.originCoords || ctx.radiusKm === null || ctx.radiusKm === undefined) return 1;
  const c = eventCoords(event, event.venue);
  if (!c) return 0.5;
  return withinRadius(ctx.originCoords, c, ctx.radiusKm, ctx.originPostcode, eventPostcode(event))
    ? 1
    : 0.2;
}

/**
 * Deserving of more exposure than it has already had.
 *
 * ⭐ This asks "has this ever had a turn?", NOT "how famous is the act?".
 * Follower counts were measured and rejected as the input: 155 of 185 profiles
 * have zero followers and the maximum is 6, so an obscurity score built on
 * them would hand 84% of the catalogue the identical boost and discriminate
 * nothing. Allocation history discriminates perfectly and is ours to keep.
 */
export function discoveryScore(event, ctx) {
  const exposure = summariseExposure(ctx.history, event.id, ctx.todayIso);
  if (exposure.total === 0) return 1;
  return Math.max(0, 1 / (1 + exposure.total));
}

/** ⛔ RESERVED — no payments system exists. Capped by its weight when it does. */
export function paidScore(event, ctx) {
  if (!ctx.paidBoosts) return null;
  const v = ctx.paidBoosts.get(event.id);
  return typeof v === 'number' ? Math.min(1, Math.max(0, v)) : 0;
}

/**
 * The anti-monopoly subtraction, applied AFTER weighting.
 *
 * ⚠ Deliberately NOT the same signal as `discoveryScore`, which counts a
 * LIFETIME of allocations and asks whether an event has ever had a turn. This
 * counts allocations inside FAIRNESS_WINDOW_DAYS and asks whether it has had
 * one lately. An event featured twice last year and never since should be
 * boosted by discovery and untouched by this.
 */
export function fairnessPenalty(event, ctx) {
  const exposure = summariseExposure(ctx.history, event.id, ctx.todayIso);
  if (!exposure.recent) return 0;
  const saturation = Math.min(1, exposure.recent / MAX_CONSECUTIVE_ALLOCATIONS);
  return saturation * MAX_FAIRNESS_PENALTY;
}

/** The factor table — one row per weight, so the two can never drift apart. */
const FACTORS = [
  { key: 'proximity',  score: proximityScore },
  { key: 'quality',    score: (ev) => qualityScore(ev) },
  { key: 'popularity', score: popularityScore },
  { key: 'local',      score: localScore },
  { key: 'discovery',  score: discoveryScore },
  { key: 'engagement', score: engagementScore },
  { key: 'paid',       score: paidScore },
];

// ── SCORING ──────────────────────────────────────────────────────────

/**
 * Score one event, showing its working.
 *
 * @returns {{score:number, factors:object, weights:object, penalty:number}}
 *          `factors` carries null for every unavailable capability, and
 *          `weights` is what each one ACTUALLY contributed after
 *          renormalisation — the two together answer "why did this win?".
 */
export function scoreEvent(event, ctx) {
  const factors = {};
  let availableWeight = 0;

  for (const f of FACTORS) {
    const v = f.score(event, ctx);
    factors[f.key] = v;
    if (v !== null && v !== undefined) availableWeight += FEATURED_WEIGHTS[f.key];
  }

  // ⚠ Guard, not tidiness: if every capability were unavailable this would
  // divide by zero and rank every event NaN — which sorts unpredictably and
  // would take the slot dark without an error anywhere.
  const weights = {};
  let score = 0;
  if (availableWeight > 0) {
    for (const f of FACTORS) {
      const v = factors[f.key];
      if (v === null || v === undefined) continue;
      const w = FEATURED_WEIGHTS[f.key] / availableWeight;
      weights[f.key] = w;
      score += v * w;
    }
  }

  const penalty = fairnessPenalty(event, ctx);
  return { score: Math.max(0, score - penalty), factors, weights, penalty };
}

// ── SELECTION ────────────────────────────────────────────────────────

/**
 * Choose the event to feature.
 *
 * @param {object}   o
 * @param {Array}    o.events      candidate rows from `events`
 * @param {string}   o.todayIso    'YYYY-MM-DD' — passed in, never computed
 *                                 here, so the module stays pure/testable
 * @param {Array}    o.history     `[{eventId, date}]` allocation ledger
 * @param {object}   [o.originCoords]  viewer origin, for local relevance
 * @param {number}   [o.radiusKm]      null/undefined = no radius filter
 * @param {Map}      [o.saveCounts]    supplying this ENABLES the popularity
 *                                     factor at its declared weight
 * @param {Map}      [o.paidBoosts]    likewise for paid promotion
 *
 * @returns {{event:object|null, selectionType:string|null, score:number,
 *            factors:object, weights:object, penalty:number,
 *            horizonDays:number, usedFallback:boolean, candidates:number,
 *            rejected:object}}
 */
export function selectFeaturedEvent({
  events = [],
  todayIso,
  history = [],
  originCoords = null,
  originPostcode = '',
  radiusKm = null,
  saveCounts = null,
  saveCountCeiling,
  engagementCounts = null,
  engagementCeiling,
  paidBoosts = null,
} = {}) {
  const ctx = {
    todayIso, history,
    originCoords, originPostcode, radiusKm,
    saveCounts, saveCountCeiling,
    engagementCounts, engagementCeiling,
    paidBoosts,
  };

  const empty = {
    event: null, selectionType: null, score: 0,
    factors: {}, weights: {}, penalty: 0,
    horizonDays: FEATURED_HORIZON_DAYS, usedFallback: false,
    candidates: 0, rejected: {},
  };
  if (!todayIso) return empty;

  // ⭐ TWO PASSES, AND THE SECOND IS THE WHOLE POINT. A fortnight with nothing
  // eligible must not blank the hero — reaching further is strictly better
  // than showing nothing, so the horizon widens rather than the gates opening.
  let horizonDays = FEATURED_HORIZON_DAYS;
  let usedFallback = false;
  let rejected = {};
  let eligible = [];

  for (const h of [FEATURED_HORIZON_DAYS, FEATURED_FALLBACK_HORIZON_DAYS]) {
    horizonDays = h;
    usedFallback = h !== FEATURED_HORIZON_DAYS;
    rejected = {};
    eligible = [];
    for (const ev of events) {
      const why = eligibilityFailure(ev, { todayIso, horizonDays: h, history });
      if (why) rejected[why] = (rejected[why] || 0) + 1;
      else eligible.push(ev);
    }
    if (eligible.length) break;
  }

  if (!eligible.length) {
    return { ...empty, horizonDays, usedFallback, rejected };
  }

  const scored = eligible.map(ev => {
    const s = scoreEvent(ev, ctx);
    const override = editorialOverride(ev, todayIso);
    return {
      event: ev,
      override,
      selectionType: override ? 'editorial' : (paidBoosts?.get(ev.id) ? 'promoted' : 'organic'),
      ...s,
    };
  });

  // ⚠ DETERMINISTIC, NEVER RANDOM. Two events with identical scores must
  // resolve the same way on every device and every render, or the hero flickers
  // between them and the ledger records a day nobody can reproduce.
  const rank = (a, b) => {
    if (!!b.override !== !!a.override) return b.override ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    const da = a.event.config?.date || '';
    const db = b.event.config?.date || '';
    if (da !== db) return da.localeCompare(db);
    return String(a.event.id).localeCompare(String(b.event.id));
  };

  const winner = [...scored].sort(rank)[0];

  return {
    event: winner.event,
    selectionType: winner.selectionType,
    score: winner.score,
    factors: winner.factors,
    weights: winner.weights,
    penalty: winner.penalty,
    reason: winner.override?.reason ?? null,
    horizonDays, usedFallback,
    candidates: eligible.length,
    rejected,
  };
}

/**
 * Replay the ledger forward from `fromIso` to `todayIso`.
 *
 * ⭐ THIS IS WHY NO CRON IS NEEDED. Selection is a pure function of (candidate
 * set, day, prior allocations), so the whole history is recomputable from a
 * fixed start — every client derives the same sequence and the persisted
 * ledger is a record of it, not the source of it. The repo has no pg_cron, no
 * worker and no Edge Function for this, and `n4b_expiry_on_delivery` sets the
 * precedent: scheduled work is done lazily and idempotently instead.
 *
 * ⚠ Replay reconstructs past candidacy from `created_at`, so an event that did
 * not exist yet is correctly absent. It cannot resurrect a DELETED event, so a
 * replayed history can differ from a persisted one after a deletion. Persist
 * the ledger if that matters; the two agree in every other case.
 */
export function replayHistory({ events = [], fromIso, toIso, ...rest } = {}) {
  if (!fromIso || !toIso) return [];
  const history = [];
  const span = daysBetween(fromIso, toIso);
  for (let i = 0; i <= span; i++) {
    const day = addDays(fromIso, i);
    const existing = events.filter(ev => !ev.created_at || ev.created_at.slice(0, 10) <= day);
    const pick = selectFeaturedEvent({ ...rest, events: existing, todayIso: day, history });
    if (pick.event) history.push({ eventId: pick.event.id, date: day });
  }
  return history;
}
