import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectFeaturedEvent, scoreEvent, qualityScore, discoveryScore,
  summariseExposure, inCooldown, editorialOverride, eligibilityFailure,
  replayHistory, fairnessPenalty, allocationForToday,
  allocationsForToday, selectFeaturedEvents,
  FEATURED_WEIGHTS, FEATURED_HORIZON_DAYS, FEATURED_FALLBACK_HORIZON_DAYS,
  MAX_CONSECUTIVE_ALLOCATIONS, QUALITY_FIELDS, FEATURED_SLOTS,
} from './featuredEvent.js';

/**
 * ── WHY THESE TESTS EARN THEIR KEEP ──────────────────────────────────
 *
 * The defect this module exists to fix was SILENT: the hero vanished from
 * What's On on 16 Aug 2026 because its one hand-set pick had passed, and
 * nothing anywhere reported it. A ranking engine can fail the same way in
 * four more directions, so each is pinned below:
 *
 *   · it goes dark            → §2 eligibility, §8 fallback horizon
 *   · one event colonises it  → §5 fairness, cooldown, allocation cap
 *   · money buys the slot     → §6 paid is capped by weight, not additive
 *   · a missing table reads
 *     as a real zero          → §7 renormalisation
 *
 * ⚠ Every load-bearing assertion carries a MUTATION GUARD — an inverse case
 * proving the assertion could fail. Without them a scorer returning a constant
 * passes most of this file.
 */

const TODAY = '2026-08-21';

/** ISO date `n` days from TODAY. Negative is the past. */
function day(n) {
  const d = new Date(TODAY + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let seq = 0;
const BASE = {
  status: 'live',
  is_public: true,
  created_at: '2026-01-01T00:00:00Z',
};

/** A complete, eligible event. Override anything; `cfg` merges into config. */
function ev({ id, cfg = {}, ...rest } = {}) {
  seq += 1;
  return {
    ...BASE,
    id: id || `e${String(seq).padStart(3, '0')}`,
    name: `Event ${seq}`,
    config: {
      date: day(2),
      poster: 'https://example.test/p.jpg',
      time: '8:00',
      venue: 'The Federal Hotel',
      genres: ['Techno'],
      bio: 'A night of it.',
      ticketLink: 'https://tickets.test/x',
      ...cfg,
    },
    ...rest,
  };
}

const pick = (events, extra = {}) =>
  selectFeaturedEvent({ events, todayIso: TODAY, history: [], ...extra });

// ── 1 · ELIGIBILITY — A GATE ONLY EVER SUBTRACTS ─────────────────────

test('a finished event is excluded, and its reason is nameable', () => {
  const past = ev({ cfg: { date: day(-3) } });
  const soon = ev({ cfg: { date: day(1) } });
  const out = pick([past, soon]);
  assert.equal(out.event.id, soon.id);
  assert.equal(eligibilityFailure(past, { todayIso: TODAY, horizonDays: 14 }), 'finished');
});

test('⭐ a multi-day festival is NOT finished on its middle day — endDate wins', () => {
  const fest = ev({ cfg: { date: day(-2), endDate: day(2) } });
  assert.equal(eligibilityFailure(fest, { todayIso: TODAY, horizonDays: 14 }), null);
  // Mutation guard: strip the endDate and the very same row must fall out.
  const noEnd = ev({ cfg: { date: day(-2) } });
  assert.equal(eligibilityFailure(noEnd, { todayIso: TODAY, horizonDays: 14 }), 'finished');
});

test('a private event is excluded', () => {
  const hidden = ev({ is_public: false, cfg: { date: day(1) } });
  const open   = ev({ cfg: { date: day(9) } });
  assert.equal(pick([hidden, open]).event.id, open.id);
  assert.equal(eligibilityFailure(hidden, { todayIso: TODAY, horizonDays: 14 }), 'not_public');
});

test('⚠ a non-live event is excluded — and `cancelled` is NOT a state this app has', () => {
  // `events.status` is unconstrained text whose only live values are
  // draft/live/completed. There is no cancellation to gate on, so the
  // strongest available statement is status === 'live'. ⛔ Do not add a
  // cancelled branch here until the state exists in the schema.
  for (const status of ['draft', 'completed', 'cancelled', null, undefined]) {
    const e = ev({ status, cfg: { date: day(1) } });
    assert.equal(
      eligibilityFailure(e, { todayIso: TODAY, horizonDays: 14 }), 'not_live',
      `status ${String(status)} must not reach the hero`,
    );
  }
});

test('an event with no date, or no image, is excluded', () => {
  const undated  = ev({ cfg: { date: undefined } });
  const pictless = ev({ cfg: { poster: undefined } });
  assert.equal(eligibilityFailure(undated,  { todayIso: TODAY, horizonDays: 14 }), 'no_date');
  assert.equal(eligibilityFailure(pictless, { todayIso: TODAY, horizonDays: 14 }), 'no_image');
  // Mutation guard: a cover alone is enough — the ladder is not poster-only.
  const covered = ev({ cfg: { poster: undefined, cover: 'https://example.test/c.jpg' } });
  assert.equal(eligibilityFailure(covered, { todayIso: TODAY, horizonDays: 14 }), null);
});

test('⛔ THE SLOT NEVER GOES DARK: nothing inside 14 days widens the horizon', () => {
  const distant = ev({ cfg: { date: day(40) } });
  const out = pick([distant]);
  assert.equal(out.event.id, distant.id, 'a distant hero beats an empty one');
  assert.equal(out.usedFallback, true);
  assert.equal(out.horizonDays, FEATURED_FALLBACK_HORIZON_DAYS);
  // Mutation guard: with something inside the primary horizon the fallback
  // must NOT fire, or every pick silently reaches 90 days.
  const near = ev({ cfg: { date: day(3) } });
  const out2 = pick([distant, near]);
  assert.equal(out2.usedFallback, false);
  assert.equal(out2.event.id, near.id);
});

test('an empty catalogue returns a null event, not a crash', () => {
  const out = pick([]);
  assert.equal(out.event, null);
  assert.equal(out.selectionType, null);
  assert.equal(out.candidates, 0);
});

test('rejections are counted by reason, so "why is nothing featured?" is answerable', () => {
  const out = pick([
    ev({ status: 'draft' }),
    ev({ is_public: false }),
    ev({ cfg: { date: day(-5) } }),
  ]);
  assert.equal(out.event, null);
  assert.deepEqual(out.rejected, { not_live: 1, not_public: 1, finished: 1 });
});

// ── 2 · PROXIMITY ────────────────────────────────────────────────────

test('a soon event beats a distant one, all else equal', () => {
  const soon    = ev({ cfg: { date: day(1) } });
  const distant = ev({ cfg: { date: day(12) } });
  assert.equal(pick([distant, soon]).event.id, soon.id);
  // Mutation guard: swap the dates and the winner must swap with them.
  const soon2    = ev({ id: 'zzz', cfg: { date: day(1) } });
  const distant2 = ev({ id: 'aaa', cfg: { date: day(12) } });
  assert.equal(pick([soon2, distant2]).event.id, 'zzz',
    'proximity must beat the id tie-break, or the ladder is doing nothing');
});

// ── 3 · QUALITY ──────────────────────────────────────────────────────

test('completeness scores a share per field, and reads legacy spellings', () => {
  const full = ev();
  assert.equal(qualityScore(full), 1);

  const bare = ev({ cfg: {
    date: day(2), poster: 'https://example.test/p.jpg',
    time: undefined, venue: undefined, genres: undefined,
    bio: undefined, ticketLink: undefined,
  } });
  assert.equal(qualityScore(bare), 1 / QUALITY_FIELDS.length, 'image alone');

  // The importer writes start_time / ticket_url; the editor writes time /
  // ticketLink. Both must count or imported rows are scored as incomplete.
  const legacy = ev({ cfg: {
    date: day(2), poster: 'https://example.test/p.jpg',
    time: undefined, start_time: '20:00',
    ticketLink: undefined, ticket_url: 'https://t.test/y',
    description: 'blurb', bio: undefined,
  } });
  assert.equal(legacy.config.time, undefined);
  assert.equal(qualityScore(legacy), 1, 'every legacy spelling must count');
});

test('a genre list counts whether it is an array or a joined string', () => {
  const asString = ev({ cfg: { genres: 'Techno · House' } });
  assert.equal(qualityScore(asString), 1);
  const empty = ev({ cfg: { genres: [] } });
  assert.equal(qualityScore(empty), 1 - 1 / QUALITY_FIELDS.length);
});

// ── 4 · DISCOVERY — HAS THIS EVER HAD A TURN? ────────────────────────

test('an event that has never been featured beats an identical one that has', () => {
  const veteran = ev({ id: 'aaa', cfg: { date: day(2) } });
  const fresh   = ev({ id: 'zzz', cfg: { date: day(2) } });
  const history = [
    { eventId: 'aaa', date: day(-20) },
    { eventId: 'aaa', date: day(-40) },
  ];
  const out = pick([veteran, fresh], { history });
  assert.equal(out.event.id, 'zzz',
    'discovery must overturn the id tie-break the veteran would otherwise win');
  assert.equal(discoveryScore(fresh, { history, todayIso: TODAY }), 1);
  assert.ok(discoveryScore(veteran, { history, todayIso: TODAY }) < 1);
});

test('⭐ discovery counts a LIFETIME; the fairness penalty counts a WINDOW', () => {
  const longAgo = [{ eventId: 'aaa', date: day(-200) }, { eventId: 'aaa', date: day(-201) }];
  const e = ev({ id: 'aaa' });
  const ctx = { history: longAgo, todayIso: TODAY };
  assert.ok(discoveryScore(e, ctx) < 1, 'a lifetime turn still counts against discovery');
  assert.equal(fairnessPenalty(e, ctx), 0,
    'but nothing inside the window means no anti-monopoly penalty — the two are different questions');
});

// ── 5 · FAIRNESS, COOLDOWN AND THE ALLOCATION CAP ────────────────────

test('a heavily exposed event is penalised even when it scores highest raw', () => {
  const hot  = ev({ id: 'aaa', cfg: { date: day(1) } });          // best proximity
  const cold = ev({ id: 'zzz', cfg: { date: day(2) } });
  const history = [
    { eventId: 'aaa', date: day(-10) },
    { eventId: 'aaa', date: day(-12) },
    { eventId: 'aaa', date: day(-14) },
  ];
  const bare = pick([hot, cold]);
  assert.equal(bare.event.id, 'aaa', 'with no history the imminent event wins');

  const out = pick([hot, cold], { history });
  assert.equal(out.event.id, 'zzz', 'the fairness penalty must be able to overturn proximity');
  assert.ok(fairnessPenalty(hot, { history, todayIso: TODAY }) > 0);
});

test('an event that has held the slot for the maximum run is excluded outright', () => {
  const id = 'aaa';
  const history = [];
  for (let i = 1; i <= MAX_CONSECUTIVE_ALLOCATIONS; i++) history.push({ eventId: id, date: day(-i) });
  const exhausted = ev({ id, cfg: { date: day(1) } });
  const other     = ev({ id: 'zzz', cfg: { date: day(10) } });

  const ex = summariseExposure(history, id, TODAY);
  assert.equal(ex.consecutive, MAX_CONSECUTIVE_ALLOCATIONS);
  assert.equal(inCooldown(ex, TODAY), true);
  assert.equal(pick([exhausted, other], { history }).event.id, 'zzz');
});

test('⚠ a run only counts as current if it reaches YESTERDAY unbroken', () => {
  // Three days last month is not a run in progress today. Getting this wrong
  // bars an event from the slot forever on the strength of one old week.
  const history = [
    { eventId: 'aaa', date: day(-30) },
    { eventId: 'aaa', date: day(-31) },
    { eventId: 'aaa', date: day(-32) },
  ];
  assert.equal(summariseExposure(history, 'aaa', TODAY).consecutive, 0);
});

test('the cooldown blocks re-selection, and lifts on time', () => {
  const during = [{ eventId: 'aaa', date: day(-2) }, { eventId: 'aaa', date: day(-3) }, { eventId: 'aaa', date: day(-4) }];
  const after  = [{ eventId: 'aaa', date: day(-6) }, { eventId: 'aaa', date: day(-7) }, { eventId: 'aaa', date: day(-8) }];

  assert.equal(inCooldown(summariseExposure(during, 'aaa', TODAY), TODAY), true,
    'a maxed run that ended two days ago is still cooling down');
  assert.equal(inCooldown(summariseExposure(after, 'aaa', TODAY), TODAY), false,
    'and the same event competes again once the cooldown has elapsed');
});

test('a single day in the slot does NOT trigger a cooldown — it may win again', () => {
  const history = [{ eventId: 'aaa', date: day(-1) }];
  assert.equal(inCooldown(summariseExposure(history, 'aaa', TODAY), TODAY), false);
});

// ── 6 · PAID PROMOTION — A WEIGHT, NEVER A PURCHASE ──────────────────

test('a paid boost improves ranking', () => {
  const paid  = ev({ id: 'zzz' });
  const plain = ev({ id: 'aaa' });
  const paidBoosts = new Map([['zzz', 1]]);
  assert.equal(pick([paid, plain]).event.id, 'aaa', 'without the boost the id tie-break decides');
  assert.equal(pick([paid, plain], { paidBoosts }).event.id, 'zzz');
});

test('⛔ money cannot buy past fairness, and cannot buy past a cooldown', () => {
  const buyer = ev({ id: 'aaa', cfg: { date: day(1) } });
  const other = ev({ id: 'zzz', cfg: { date: day(2) } });
  const paidBoosts = new Map([['aaa', 1]]);

  const saturated = [
    { eventId: 'aaa', date: day(-10) },
    { eventId: 'aaa', date: day(-12) },
    { eventId: 'aaa', date: day(-14) },
  ];
  assert.equal(pick([buyer, other], { history: saturated, paidBoosts }).event.id, 'zzz',
    'a full fairness penalty must outweigh a maximum paid boost');

  const cooling = [];
  for (let i = 1; i <= MAX_CONSECUTIVE_ALLOCATIONS; i++) cooling.push({ eventId: 'aaa', date: day(-i) });
  assert.equal(pick([buyer, other], { history: cooling, paidBoosts }).event.id, 'zzz',
    'and a cooldown is an eligibility gate, which no boost can reach');
});

test('a promoted winner is labelled, so the card can disclose it', () => {
  const out = pick([ev({ id: 'zzz' })], { paidBoosts: new Map([['zzz', 1]]) });
  assert.equal(out.selectionType, 'promoted');
  assert.equal(pick([ev({ id: 'zzz' })]).selectionType, 'organic');
});

// ── 7 · POPULARITY — RESERVED, AND NEVER A SILENT ZERO ───────────────

test('⭐⭐ an unavailable capability is NULL and RENORMALISES — it is not scored 0', () => {
  const out = scoreEvent(ev(), { todayIso: TODAY, history: [] });
  assert.equal(out.factors.popularity, null, 'no readable save counts exist');
  assert.equal(out.factors.engagement, null);
  assert.equal(out.factors.paid, null);
  assert.equal(out.weights.popularity, undefined, 'a null factor contributes no weight');

  const sum = Object.values(out.weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, 'the surviving weights must renormalise to exactly 1');

  // Mutation guard: supply the data and the factor must light up at its
  // DECLARED weight, with no other change to this module.
  const withData = scoreEvent(ev({ id: 'p' }), {
    todayIso: TODAY, history: [], saveCounts: new Map([['p', 20]]),
  });
  assert.notEqual(withData.factors.popularity, null);
  assert.ok(withData.weights.popularity > 0);
});

test('a popular event benefits — but popularity alone cannot win the slot', () => {
  const famous = ev({ id: 'aaa', cfg: { date: day(12) } });
  const local  = ev({ id: 'zzz', cfg: { date: day(1) } });
  const saveCounts = new Map([['aaa', 500]]);

  const both = pick([famous, local], { saveCounts });
  assert.equal(both.event.id, 'zzz',
    'an imminent unknown gig must beat a distant famous one — this is the constitutional rule');

  // Mutation guard: with dates equal, popularity DOES decide. Without this the
  // test above would pass for a popularity scorer that returns a constant.
  const famousSoon = ev({ id: 'aaa', cfg: { date: day(1) } });
  assert.equal(pick([famousSoon, local], { saveCounts }).event.id, 'aaa');
});

test('popularity has diminishing returns, so one big event cannot own the factor', () => {
  const ctx = (n) => ({ todayIso: TODAY, history: [], saveCounts: new Map([['x', n]]) });
  const at = (n) => scoreEvent(ev({ id: 'x' }), ctx(n)).factors.popularity;
  assert.ok(at(50) < at(5) * 4, 'ten times the saves must not be ten times the score');
  assert.ok(at(5) > at(1));
});

// ── 8 · LOCAL RELEVANCE — UNKNOWN IS NOT FAR ─────────────────────────

const BELLINGEN = { lat: -30.4525, lng: 152.8991 };
const SYDNEY    = { lat: -33.8688, lng: 151.2093 };

test('different geographic contexts produce different Featured events', () => {
  const north = ev({ id: 'aaa', lat: BELLINGEN.lat, lng: BELLINGEN.lng });
  const south = ev({ id: 'zzz', lat: SYDNEY.lat,    lng: SYDNEY.lng });
  const events = [north, south];

  assert.equal(
    pick(events, { originCoords: BELLINGEN, radiusKm: 50 }).event.id, 'aaa');
  assert.equal(
    pick(events, { originCoords: SYDNEY, radiusKm: 50 }).event.id, 'zzz',
    'the same catalogue, a different viewer, a different hero');
});

test('⚠ an unplaceable event scores the MIDDLE, never zero', () => {
  const placeless = ev({ id: 'aaa' });                                   // no coords at all
  const faraway   = ev({ id: 'zzz', lat: SYDNEY.lat, lng: SYDNEY.lng });
  const out = pick([placeless, faraway], { originCoords: BELLINGEN, radiusKm: 50 });
  assert.equal(out.event.id, 'aaa',
    'unknown must beat known-far, or the slot belongs permanently to whoever has a postcode');
});

test('with no origin set, local relevance is vacuously true for everyone', () => {
  const a = ev({ id: 'aaa' });
  const b = ev({ id: 'zzz', lat: SYDNEY.lat, lng: SYDNEY.lng });
  const out = scoreEvent(b, { todayIso: TODAY, history: [], radiusKm: null });
  assert.equal(out.factors.local, 1);
  assert.equal(pick([a, b]).event.id, 'aaa', 'falls through to the tie-break, not to geography');
});

// ── 9 · EDITORIAL OVERRIDE ───────────────────────────────────────────

test('an active editorial override wins, even against a stronger organic pick', () => {
  const strong = ev({ id: 'aaa', cfg: { date: day(1) } });
  const chosen = ev({ id: 'zzz', cfg: { date: day(13), featured: { from: day(-1), to: day(5), reason: 'Community fundraiser', by: 'studio' } } });
  const out = pick([strong, chosen]);
  assert.equal(out.event.id, 'zzz');
  assert.equal(out.selectionType, 'editorial');
  assert.equal(out.reason, 'Community fundraiser');
});

test('an expired override stops overriding, and the algorithm resumes', () => {
  const strong  = ev({ id: 'aaa', cfg: { date: day(1) } });
  const expired = ev({ id: 'zzz', cfg: { date: day(13), featured: { from: day(-10), to: day(-2) } } });
  assert.equal(editorialOverride(expired, TODAY), null);
  const out = pick([strong, expired]);
  assert.equal(out.event.id, 'aaa');
  assert.equal(out.selectionType, 'organic');
});

test('an override that has not started yet is not active', () => {
  const future = ev({ cfg: { featured: { from: day(3), to: day(9) } } });
  assert.equal(editorialOverride(future, TODAY), null);
  assert.notEqual(editorialOverride(future, day(4)), null);
});

test('⛔⛔ AN OVERRIDE STILL PASSES EVERY GATE — this is the original defect', () => {
  // 2026-08-15: one event carried `featured: true`. On 21 Aug it had passed,
  // and because the old code was `events.find(ev => ev.config?.featured)` over
  // a list already filtered to upcoming, the section rendered NOTHING — no
  // heading, no fallback, no error. An override must never resurrect a
  // finished event, and must never be the only thing standing between the
  // slot and darkness.
  const stale = ev({ id: 'aaa', cfg: { date: day(-6), featured: true } });
  const live  = ev({ id: 'zzz', cfg: { date: day(2) } });
  const out = pick([stale, live]);
  assert.equal(out.event.id, 'zzz', 'the algorithm carries on when the pick has expired');
  assert.equal(out.selectionType, 'organic');
});

test('the legacy `featured: true` shape still works', () => {
  const legacy = ev({ cfg: { featured: true } });
  const o = editorialOverride(legacy, TODAY);
  assert.equal(o.legacy, true);
  assert.equal(o.reason, null);
});

// ── 10 · DETERMINISM ─────────────────────────────────────────────────

test('tie-breaking is deterministic: score, then date, then id', () => {
  const a = ev({ id: 'bbb', cfg: { date: day(2) } });
  const b = ev({ id: 'aaa', cfg: { date: day(2) } });
  const c = ev({ id: 'ccc', cfg: { date: day(2) } });
  assert.equal(pick([a, b, c]).event.id, 'aaa');
  assert.equal(pick([c, b, a]).event.id, 'aaa', 'input order must not matter');
  // Mutation guard: an earlier date must beat the lower id.
  const earlier = ev({ id: 'zzz', cfg: { date: day(1) } });
  assert.equal(pick([a, b, c, earlier]).event.id, 'zzz');
});

test('repeated ranking is stable and does not mutate the events', () => {
  const events = [ev({ id: 'aaa' }), ev({ id: 'zzz', cfg: { date: day(1) } })];
  const before = JSON.stringify(events);

  const first  = pick(events);
  const second = pick(events);
  assert.equal(first.event.id, second.event.id);
  assert.equal(first.score, second.score);

  assert.equal(JSON.stringify(events), before, '⛔ scoring must not mutate the input rows');
  assert.equal(events[0].id, 'aaa', 'nor reorder the caller\'s array');
});

// ── 11 · THE LEDGER, AND THE REPLAY THAT MAKES IT REPRODUCIBLE ───────

test('replay records one allocation per day, and rotates rather than repeating', () => {
  const events = [
    ev({ id: 'aaa', cfg: { date: day(30) } }),
    ev({ id: 'bbb', cfg: { date: day(31) } }),
    ev({ id: 'ccc', cfg: { date: day(32) } }),
  ];
  const history = replayHistory({ events, fromIso: day(-9), toIso: day(-1) });

  assert.equal(history.length, 9, 'one allocation per day, none skipped');
  assert.deepEqual([...new Set(history.map(h => h.date))].length, 9, 'and never two on a day');

  const holders = new Set(history.map(h => h.eventId));
  assert.ok(holders.size > 1, '⛔ the whole point: the slot must rotate, not settle');

  const runs = history.filter(h => h.eventId === history[0].eventId).length;
  assert.ok(runs <= 9 - 1, 'no single event may hold every day');
});

test('replay is reproducible — same inputs, same ledger', () => {
  const mk = () => [ev({ id: 'aaa', cfg: { date: day(20) } }), ev({ id: 'bbb', cfg: { date: day(21) } })];
  const a = replayHistory({ events: mk(), fromIso: day(-6), toIso: day(-1) });
  const b = replayHistory({ events: mk(), fromIso: day(-6), toIso: day(-1) });
  assert.deepEqual(a, b);
});

test('⚠ replay honours created_at — an event cannot be featured before it existed', () => {
  const old   = ev({ id: 'aaa', cfg: { date: day(30) }, created_at: '2026-01-01T00:00:00Z' });
  const brand = ev({ id: 'zzz', cfg: { date: day(30) }, created_at: `${day(-2)}T00:00:00Z` });
  const history = replayHistory({ events: [old, brand], fromIso: day(-5), toIso: day(-1) });
  const earlyDays = history.filter(h => h.date < day(-2));
  assert.ok(earlyDays.length > 0);
  assert.ok(earlyDays.every(h => h.eventId === 'aaa'),
    'the newer event must be absent from days before it was created');
});

test('exposure summarises total, recent and current run separately', () => {
  const history = [
    { eventId: 'aaa', date: day(-1) },
    { eventId: 'aaa', date: day(-2) },
    { eventId: 'aaa', date: day(-90) },
    { eventId: 'bbb', date: day(-1) },
  ];
  const ex = summariseExposure(history, 'aaa', TODAY);
  assert.equal(ex.total, 3);
  assert.equal(ex.recent, 2, 'the 90-day-old allocation is outside the fairness window');
  assert.equal(ex.consecutive, 2);
  assert.equal(ex.lastDate, day(-1));
});

// ── 12 · A LEDGER ALLOCATION OWNS THE DAY (Studio manual override) ───

/** N consecutive day-rows for one event, as feature_event_manually writes them. */
function allocation(eventId, days, { from = 0, selectionType = 'manual', allocationId = 'alloc-1' } = {}) {
  return Array.from({ length: days }, (_, i) => ({
    eventId, date: day(from + i), selectionType, allocationId,
  }));
}

test('⭐⭐ an active manual allocation owns the slot, beating a stronger organic pick', () => {
  const strong = ev({ id: 'aaa', cfg: { date: day(1) } });          // best proximity
  const chosen = ev({ id: 'zzz', cfg: { date: day(9) } });
  assert.equal(pick([strong, chosen]).event.id, 'aaa', 'without an allocation the algorithm picks freely');

  const out = pick([strong, chosen], { history: allocation('zzz', 3) });
  assert.equal(out.event.id, 'zzz');
  assert.equal(out.selectionType, 'manual');
  assert.equal(out.allocationId, 'alloc-1');
});

test('the automatic selector resumes the day after the allocation ends', () => {
  const strong = ev({ id: 'aaa', cfg: { date: day(1) } });
  const chosen = ev({ id: 'zzz', cfg: { date: day(9) } });
  // A 3-day allocation that started 3 days ago covers days -3, -2, -1 - not today.
  const expired = allocation('zzz', 3, { from: -3 });
  assert.equal(allocationForToday(expired, TODAY), null);
  const out = pick([strong, chosen], { history: expired });
  assert.equal(out.event.id, 'aaa', 'the slot returns to the algorithm');
  assert.equal(out.selectionType, 'organic');
});

test('⛔ an allocated event that is no longer showable falls through, it does not go dark', () => {
  const gone = ev({ id: 'zzz', cfg: { date: day(-4) } });           // finished since
  const live = ev({ id: 'aaa', cfg: { date: day(2) } });
  const out = pick([gone, live], { history: allocation('zzz', 3) });
  assert.equal(out.event.id, 'aaa', 'a manual pick must never reproduce the original outage');

  // Same for one that was unpublished after being featured.
  const hidden = ev({ id: 'zzz', is_public: false, cfg: { date: day(2) } });
  assert.equal(pick([hidden, live], { history: allocation('zzz', 3) }).event.id, 'aaa');
});

test('⚠ an allocation overrides the RANKING gates but not the VALIDITY gates', () => {
  // Cooldown: normally excluded outright, but an admin has overruled fairness.
  const cooling = [];
  for (let i = 1; i <= MAX_CONSECUTIVE_ALLOCATIONS; i++) cooling.push({ eventId: 'zzz', date: day(-i) });
  const worn = ev({ id: 'zzz', cfg: { date: day(2) } });
  const other = ev({ id: 'aaa', cfg: { date: day(1) } });
  assert.equal(pick([worn, other], { history: cooling }).event.id, 'aaa', 'cooldown bites normally');
  assert.equal(
    pick([worn, other], { history: [...cooling, ...allocation('zzz', 1)] }).event.id, 'zzz',
    'but an administrator may spend the cooldown');

  // Horizon: an admin may feature something further out than the slot reaches.
  const distant = ev({ id: 'zzz', cfg: { date: day(60) } });
  const near    = ev({ id: 'aaa', cfg: { date: day(1) } });
  assert.equal(pick([distant, near]).event.id, 'aaa');
  assert.equal(pick([distant, near], { history: allocation('zzz', 1) }).event.id, 'zzz');
});

test('⭐⭐ a 7-day manual allocation costs the event SEVEN days of exposure', () => {
  // This is the whole reason manual allocations live in the same ledger.
  const hist = allocation('zzz', 7, { from: -7 });
  const ex = summariseExposure(hist, 'zzz', TODAY);
  assert.equal(ex.total, 7);
  assert.equal(ex.recent, 7, 'all seven sit inside the fairness window');
  assert.ok(fairnessPenalty(ev({ id: 'zzz' }), { history: hist, todayIso: TODAY }) > 0);

  // And one day costs one day - the duration has to actually matter.
  const oneDay = summariseExposure(allocation('yyy', 1, { from: -7 }), 'yyy', TODAY);
  assert.equal(oneDay.total, 1);
  assert.ok(ex.total > oneDay.total * 6, 'seven days must weigh far more than one');
});

test('an organic ledger entry does NOT own the day - only a human decision does', () => {
  // Otherwise the engine would be bound by its own previous answer and could
  // never re-rank, which is the opposite of what the ledger is for.
  const strong = ev({ id: 'aaa', cfg: { date: day(1) } });
  const past   = ev({ id: 'zzz', cfg: { date: day(9) } });
  const hist   = allocation('zzz', 1, { selectionType: 'organic' });
  assert.equal(allocationForToday(hist, TODAY), null);
  assert.equal(pick([strong, past], { history: hist }).event.id, 'aaa');
});

test('⚠ a replayed history carries no selectionType, and must not own the day', () => {
  const strong = ev({ id: 'aaa', cfg: { date: day(1) } });
  const other  = ev({ id: 'zzz', cfg: { date: day(9) } });
  const replayed = [{ eventId: 'zzz', date: TODAY }];      // no selectionType
  assert.equal(allocationForToday(replayed, TODAY), null);
  assert.equal(pick([strong, other], { history: replayed }).event.id, 'aaa');
});

test('an editorial allocation owns the day the same way a manual one does', () => {
  const strong = ev({ id: 'aaa', cfg: { date: day(1) } });
  const chosen = ev({ id: 'zzz', cfg: { date: day(9) } });
  const out = pick([strong, chosen], { history: allocation('zzz', 2, { selectionType: 'editorial' }) });
  assert.equal(out.event.id, 'zzz');
  assert.equal(out.selectionType, 'editorial');
});

// ── 13 · CONTRACT SHAPE ──────────────────────────────────────────────

test('the declared weights sum to 1, so renormalisation is the only rescaling', () => {
  const sum = Object.values(FEATURED_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`);
});

test('every weight has a factor and every factor has a weight', () => {
  const out = scoreEvent(ev(), { todayIso: TODAY, history: [] });
  assert.deepEqual(
    Object.keys(out.factors).sort(),
    Object.keys(FEATURED_WEIGHTS).sort(),
    'a weight with no scorer would be silently ignored; a scorer with no weight silently free',
  );
});

test('quality and discovery carry equal weight — the balance is deliberate', () => {
  assert.equal(FEATURED_WEIGHTS.quality, FEATURED_WEIGHTS.discovery,
    '⛔ raising one without the other locks plain importer listings out of the slot');
});

test('the primary horizon is shorter than the fallback', () => {
  assert.ok(FEATURED_HORIZON_DAYS < FEATURED_FALLBACK_HORIZON_DAYS);
});

test('a winner reports its working, so any pick can be explained', () => {
  const out = pick([ev({ id: 'aaa' })]);
  assert.equal(typeof out.score, 'number');
  assert.ok(out.score > 0 && out.score <= 1);
  assert.equal(typeof out.factors.proximity, 'number');
  assert.equal(typeof out.penalty, 'number');
  assert.equal(out.candidates, 1);
});

// ── 9 · THREE SLOTS, EXCLUSIONS, AND ORGANIC BACKFILL (fe3) ──────────
//
// The hero became a rotation of three. Two promises carry the whole design and
// both fail silently if broken:
//
//   · the section NEVER goes dark. It went dark for six days in Aug 2026 and
//     nothing logged it. A manual queue that owned the slot outright would be
//     that defect rebuilt, so an empty or expired queue must backfill.
//   · a regular night never takes a card. It scores well precisely because it
//     is well-made, and it is on again next week — the worst possible use of
//     the most prominent slot in the app.

test('⭐⭐ an empty queue still fills all three cards — the slot never goes dark', () => {
  const events = [ev(), ev(), ev(), ev()];
  const out = selectFeaturedEvents({ events, todayIso: TODAY, history: [] });
  assert.equal(out.length, FEATURED_SLOTS);
  assert.ok(out.every(p => p.selectionType === 'organic'));
  // MUTATION GUARD: the same call with nothing eligible returns nothing rather
  // than padding — a short rail is honest, a padded one is a lie.
  const dead = selectFeaturedEvents({
    events: [ev({ cfg: { date: day(-3) } })], todayIso: TODAY, history: [],
  });
  assert.deepEqual(dead, []);
});

test('manual picks take the first cards and organic fills the rest', () => {
  const mine = ev({ id: 'mine' });
  const events = [mine, ev(), ev(), ev()];
  const history = [{ eventId: 'mine', date: TODAY, selectionType: 'manual', slot: 1, allocationId: 'a1' }];
  const out = selectFeaturedEvents({ events, todayIso: TODAY, history });
  assert.equal(out.length, 3);
  assert.equal(out[0].event.id, 'mine');
  assert.equal(out[0].selectionType, 'manual');
  assert.ok(out.slice(1).every(p => p.selectionType === 'organic'));
});

test('⛔ a manual pick never occupies two cards at once', () => {
  const mine = ev({ id: 'mine', cfg: { date: day(0) } });   // also the best organic pick
  const events = [mine, ev(), ev()];
  const history = [{ eventId: 'mine', date: TODAY, selectionType: 'manual', slot: 1, allocationId: 'a1' }];
  const out = selectFeaturedEvents({ events, todayIso: TODAY, history });
  assert.equal(out.filter(p => p.event.id === 'mine').length, 1);
});

test('⚠⚠ a manual pick whose event died is BACKFILLED, never rendered dead', () => {
  // The exact shape of the Aug 2026 outage: a pick pointing at an event that
  // is no longer showable. It must vanish from the rotation, not blank a card.
  const gone = ev({ id: 'gone', status: 'draft' });
  const events = [gone, ev(), ev(), ev()];
  const history = [{ eventId: 'gone', date: TODAY, selectionType: 'manual', slot: 1, allocationId: 'a1' }];
  const out = selectFeaturedEvents({ events, todayIso: TODAY, history });
  assert.equal(out.length, 3);
  assert.ok(!out.some(p => p.event.id === 'gone'));
});

test('slot order is POSITION order, so one card changes at a time', () => {
  const history = [
    { eventId: 'c', date: TODAY, selectionType: 'manual', slot: 3, allocationId: 'a3' },
    { eventId: 'a', date: TODAY, selectionType: 'manual', slot: 1, allocationId: 'a1' },
    { eventId: 'b', date: TODAY, selectionType: 'manual', slot: 2, allocationId: 'a2' },
  ];
  assert.deepEqual(allocationsForToday(history, TODAY).map(h => h.eventId), ['a', 'b', 'c']);
  // A pre-fe3 row has no slot. It sorts LAST rather than being dropped: it is
  // still a day somebody was featured, and losing it understates exposure.
  const legacy = [{ eventId: 'old', date: TODAY, selectionType: 'manual', allocationId: 'a0' }, ...history];
  assert.deepEqual(allocationsForToday(legacy, TODAY).map(h => h.eventId), ['a', 'b', 'c', 'old']);
});

test('⭐⭐ an excluded event is barred from the hero, and its reason is nameable', () => {
  const residency = ev({ id: 'weekly', cfg: { featured_excluded: true, date: day(0) } });
  const oneOff = ev({ id: 'oneoff', cfg: { date: day(3) } });
  const out = selectFeaturedEvent({ events: [residency, oneOff], todayIso: TODAY, history: [] });
  assert.equal(out.event.id, 'oneoff', 'the nearer excluded gig must not win');
  assert.equal(out.rejected.excluded, 1, 'and the gate says why, without a debugger');
  // MUTATION GUARD: without the stamp the residency wins on proximity, which
  // is exactly the problem the exclusion exists to solve.
  const unstamped = ev({ id: 'weekly2', cfg: { date: day(0) } });
  assert.equal(selectFeaturedEvent({ events: [unstamped, oneOff], todayIso: TODAY, history: [] }).event.id, 'weekly2');
});

test('⛔ an exclusion cannot be overridden by an editorial pick or a manual slot', () => {
  // A gate only SUBTRACTS, and an administrator may override the RANKING, never
  // the gates. Both channels must respect it or "never feature this" is advice.
  const banned = ev({ id: 'banned', cfg: { featured_excluded: true, featured: true } });
  const other = ev({ id: 'other' });
  assert.equal(selectFeaturedEvent({ events: [banned, other], todayIso: TODAY, history: [] }).event.id, 'other');

  const history = [{ eventId: 'banned', date: TODAY, selectionType: 'manual', slot: 1, allocationId: 'a1' }];
  const out = selectFeaturedEvents({ events: [banned, other], todayIso: TODAY, history });
  assert.ok(!out.some(p => p.event.id === 'banned'), 'not even a hand-written allocation gets past it');
});

// ── 10 · THE APP CHOOSES ONLY WHERE NOBODY HAS ──────────────────────
//
// The promise the whole three-slot design rests on, stated per POSITION and
// not merely per set. Every failure here is silent: the hero still shows three
// plausible cards, they are just not in the places they were put.

test('⭐⭐ a pick in slot 3 STAYS in slot 3 — the app fills 1 and 2 around it', () => {
  const mine = ev({ id: 'mine' });
  const events = [mine, ev(), ev(), ev()];
  const history = [{ eventId: 'mine', date: TODAY, selectionType: 'manual', slot: 3, allocationId: 'a3' }];
  const out = selectFeaturedEvents({ events, todayIso: TODAY, history });

  assert.equal(out.length, 3);
  assert.equal(out[2].event.id, 'mine', 'the chosen position is the rendered position');
  assert.equal(out[2].slot, 3);
  assert.ok(out.slice(0, 2).every(p => p.selectionType === 'organic'));
  // MUTATION GUARD: the same pick in slot 1 must land FIRST, or this test
  // would pass against code that simply always puts manual picks last.
  const first = selectFeaturedEvents({
    events, todayIso: TODAY,
    history: [{ eventId: 'mine', date: TODAY, selectionType: 'manual', slot: 1, allocationId: 'a1' }],
  });
  assert.equal(first[0].event.id, 'mine');
});

test('two picks keep their own positions, and the gap between them is filled', () => {
  const a = ev({ id: 'a' });
  const c = ev({ id: 'c' });
  const events = [a, c, ev(), ev()];
  const out = selectFeaturedEvents({
    events, todayIso: TODAY,
    history: [
      { eventId: 'a', date: TODAY, selectionType: 'manual', slot: 1, allocationId: 'x' },
      { eventId: 'c', date: TODAY, selectionType: 'manual', slot: 3, allocationId: 'y' },
    ],
  });
  assert.deepEqual(out.map(p => p.event.id === 'a' ? 'a' : p.event.id === 'c' ? 'c' : 'auto'),
    ['a', 'auto', 'c'], 'the app fills the middle and nothing else');
});

test('⛔ the app never overwrites a chosen position, even with a better event', () => {
  // The manual pick is deliberately the WEAKEST candidate: far away, minimal
  // listing. If the ranking could reach into a held slot it would replace it,
  // and "I chose this" would mean "unless the algorithm disagrees".
  const weak = ev({ id: 'weak', cfg: { date: day(40), time: undefined, venue: undefined, genres: undefined, bio: undefined, ticketLink: undefined } });
  const strong = ev({ id: 'strong', cfg: { date: day(1) } });
  const out = selectFeaturedEvents({
    events: [weak, strong, ev(), ev()], todayIso: TODAY,
    history: [{ eventId: 'weak', date: TODAY, selectionType: 'manual', slot: 2, allocationId: 'w' }],
  });
  assert.equal(out[1].event.id, 'weak', 'a held position is not up for reconsideration');
  assert.ok(out.some(p => p.event.id === 'strong'), 'the better event still gets a free slot');
});

test('⚠ a dead manual pick frees its position for the app, rather than holding it empty', () => {
  const gone = ev({ id: 'gone', status: 'draft' });
  const out = selectFeaturedEvents({
    events: [gone, ev(), ev(), ev()], todayIso: TODAY,
    history: [{ eventId: 'gone', date: TODAY, selectionType: 'manual', slot: 2, allocationId: 'g' }],
  });
  assert.equal(out.length, 3, 'three cards, not two with a hole');
  assert.ok(!out.some(p => p.event.id === 'gone'));
  assert.ok(out.every(p => p.selectionType === 'organic'));
});

test('a pre-fe3 allocation has no slot and takes position 1, as it always was', () => {
  const legacy = ev({ id: 'legacy' });
  const out = selectFeaturedEvents({
    events: [legacy, ev(), ev()], todayIso: TODAY,
    history: [{ eventId: 'legacy', date: TODAY, selectionType: 'manual', allocationId: 'L' }],
  });
  assert.equal(out[0].event.id, 'legacy');
  assert.equal(out[0].slot, 1);
});

test('⚠ a slot number beyond the rotation cannot write past the end', () => {
  const mine = ev({ id: 'mine' });
  const out = selectFeaturedEvents({
    events: [mine, ev(), ev()], todayIso: TODAY,
    history: [{ eventId: 'mine', date: TODAY, selectionType: 'manual', slot: 9, allocationId: 'z' }],
  });
  assert.equal(out.length, 3);
  assert.equal(out[2].event.id, 'mine', 'clamped into the last position, never dropped');
});
