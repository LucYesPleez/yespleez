/**
 * SPOTLIGHT — the attention rail.
 *
 * ── WHY THESE TESTS EARN THEIR KEEP ──────────────────────────────────
 *
 * Every failure mode here is silent. A rail that quietly loses its time axis
 * still renders five plausible cards — they are just the wrong five, and it
 * looks like the algorithm made a choice rather than that a rule is missing.
 * A rail that quietly pads to five looks generous instead of dishonest. A
 * reserved rule that quietly starts matching looks like a feature shipped.
 *
 * So the targets are the promises the philosophy makes, each of which a
 * refactor could break without an error appearing anywhere:
 *
 *   1. IMMINENCE gates eligibility, and it is PER-RULE. Relationship order
 *      alone would answer "what is my strongest tie?" — not this page's
 *      question.
 *   2. UP TO five, NEVER padded. Rail length is the honest readout of how
 *      well the scene has been taught.
 *   3. A spread of REASONS — no single rule may fill the rail, or Spotlight
 *      is a duplicate of the section below it.
 *   4. RESERVED rules never match, however tempting the data looks.
 *   5. One event, one reason: the highest rule wins and nothing repeats.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  buildSpotlight, SPOTLIGHT_RULES, SPOTLIGHT_LIMIT, DEFAULT_HORIZON_DAYS,
} = await import('./spotlight.js');
const { favouriteReason } = await import('./sceneFloor.js');
const { postcodeCoords } = await import('./geo.js');

const TODAY = '2026-01-01';
const BELL = postcodeCoords('2454');

let seq = 0;
function ev({ date = '2026-01-05', created = '2025-12-30T00:00:00Z', genres = '', featured = false, kmNorth = 5 } = {}) {
  const id = `ev-${++seq}`;
  return {
    id, name: id, created_at: created,
    config: { date, genres, ...(featured ? { featured: true } : {}) },
    venue_profile_id: null, owner_profile_id: null, host_id: null, venue: null,
    postcode: null, state: null,
    lat: BELL.lat + kmNorth / 111, lng: BELL.lng,
  };
}

const BASE = {
  todayIso: TODAY,
  weekendFrom: '2026-01-02', weekendTo: '2026-01-04',
  newSinceIso: '2025-12-25T00:00:00Z',
};

// ── 1 · IMMINENCE IS A REAL AXIS ─────────────────────────────────────

test('a nearer weaker-tie event beats a distant stronger-tie one — relationship picks the KIND, imminence picks the instance', () => {
  const myGigMonthsAway = ev({ date: '2026-06-01' });          // strongest rule, outside horizon
  const savedTuesday    = ev({ date: '2026-01-06' });          // weaker rule, inside horizon
  const { items } = buildSpotlight({
    ...BASE, events: [myGigMonthsAway, savedTuesday],
    myEventIds: new Set([myGigMonthsAway.id]),
    savedEventIds: new Set([savedTuesday.id]),
  });
  assert.deepEqual(items.map(i => i.badge), ['SAVED'],
    'the horizon must gate the top rule out entirely, not merely rank it lower');
});

test('within a rule the soonest event wins', () => {
  const later   = ev({ date: '2026-01-10' });
  const sooner  = ev({ date: '2026-01-03' });
  const { items } = buildSpotlight({
    ...BASE, events: [later, sooner],
    savedEventIds: new Set([later.id, sooner.id]),
  });
  assert.deepEqual(items.map(i => i.event.id), [sooner.id, later.id]);
});

test('the horizon is PER-RULE: the fallback reaches further so a quiet fortnight still has a heartbeat', () => {
  const curatedFarOut = ev({ date: '2026-03-01', featured: true, created: '2020-01-01T00:00:00Z' });
  const { items } = buildSpotlight({ ...BASE, events: [curatedFarOut] });
  assert.deepEqual(items.map(i => i.badge), ['SPOTLIGHT'],
    'a curated pick two months out is still "do not miss this"');
  // …and a default-horizon rule would NOT have reached the same date.
  const { items: asSaved } = buildSpotlight({
    ...BASE, events: [{ ...curatedFarOut, config: { date: '2026-03-01' } }],
    savedEventIds: new Set([curatedFarOut.id]),
  });
  assert.deepEqual(asSaved, [], 'SAVED looks only 14 days ahead');
});

// ── 2 · UP TO FIVE, NEVER PADDED ─────────────────────────────────────

test('a barely-taught scene gets a SHORT rail, not a padded one', () => {
  const one = ev({ date: '2026-01-03', featured: true });
  const { items } = buildSpotlight({ ...BASE, events: [one] });
  assert.equal(items.length, 1, 'length is the honest readout of how taught the scene is');
});

test('an event with no relationship and no news value earns nothing — the rail stays empty rather than inventing attention', () => {
  // Mid-week, long since announced, not curated, no tie to the user at all.
  const stranger = ev({ date: '2026-01-09', created: '2020-01-01T00:00:00Z' });
  const { items } = buildSpotlight({ ...BASE, events: [stranger] });
  assert.deepEqual(items, []);
});

test('the rail never exceeds the limit however much qualifies', () => {
  const events = Array.from({ length: 20 }, (_, i) => ev({ date: `2026-01-0${(i % 9) + 1}` }));
  const { items } = buildSpotlight({
    ...BASE, events,
    myEventIds: new Set(events.slice(0, 6).map(e => e.id)),
    savedEventIds: new Set(events.slice(6, 14).map(e => e.id)),
    favProfileIds: new Set(),
  });
  assert.equal(items.length, SPOTLIGHT_LIMIT);
});

// ── 3 · A SPREAD OF REASONS ──────────────────────────────────────────

test('no single rule may fill the rail — otherwise Spotlight is the section below it with a new heading', () => {
  // Five events all owned by the user and all recently announced: without a
  // cap this is five MY EVENT cards, i.e. YOUR UPCOMING with a new heading.
  const mine = Array.from({ length: 5 }, (_, i) => ev({ date: `2026-01-0${i + 2}` }));
  const { items } = buildSpotlight({
    ...BASE, events: mine, myEventIds: new Set(mine.map(e => e.id)),
  });
  assert.equal(items.filter(i => i.ruleKey === 'my_event').length, 2, "capped at the rule's own cap");
  assert.ok(new Set(items.map(i => i.badge)).size > 1,
    'the leftovers must arrive under a DIFFERENT reason or the rail has no spread');
});

test('caps compose into a genuine spread across rules', () => {
  const mine   = [ev({ date: '2026-01-02' }), ev({ date: '2026-01-03' }), ev({ date: '2026-01-04' })];
  const saved  = [ev({ date: '2026-01-05' }), ev({ date: '2026-01-06' })];
  const atVenue = { ...ev({ date: '2026-01-07' }), venue_profile_id: 'vp-1' };
  const { items } = buildSpotlight({
    ...BASE, events: [...mine, ...saved, atVenue],
    myEventIds: new Set(mine.map(e => e.id)),
    savedEventIds: new Set(saved.map(e => e.id)),
    favProfileIds: new Set(['vp-1']),
  });
  assert.deepEqual(items.map(i => i.badge), ['MY EVENT', 'MY EVENT', 'SAVED', 'SAVED', 'FAVOURITE VENUE']);
});

// ── 4 · RESERVED RULES STAY DARK ─────────────────────────────────────

test('reserved rules are declared but never match', () => {
  const reserved = SPOTLIGHT_RULES.filter(r => r.reserved).map(r => r.key);
  assert.deepEqual(reserved, ['hosting', 'working', 'going'],
    'these describe capabilities the data cannot express yet');
  for (const r of SPOTLIGHT_RULES.filter(x => x.reserved)) {
    assert.equal(typeof r.match, 'undefined', `${r.key} must have no predicate at all — a stub would be placeholder behaviour`);
  }
  // Nothing a reserved rule "describes" can leak into the rail.
  const anything = ev({ date: '2026-01-03' });
  const { items } = buildSpotlight({ ...BASE, events: [anything] });
  assert.equal(items.filter(i => reserved.includes(i.ruleKey)).length, 0);
});

test('every rule carries the four things that make the table readable', () => {
  for (const r of SPOTLIGHT_RULES) {
    assert.ok(r.key && r.badge, 'a rule without a badge has no explanation');
    assert.ok(r.cap >= 1, `${r.key} needs a cap`);
    assert.ok(r.horizonDays >= 1, `${r.key} needs a horizon`);
    assert.ok(r.reserved || typeof r.match === 'function', `${r.key} must match or be reserved`);
  }
  assert.ok(!SPOTLIGHT_RULES.some(r => /editor/i.test(r.badge)),
    'never imply a staffed editorial desk — there is not one');
});

// ── 5 · ONE EVENT, ONE REASON ────────────────────────────────────────

test('an event qualifying under several rules appears once, under the highest', () => {
  const e = { ...ev({ date: '2026-01-03', featured: true, created: '2025-12-31T00:00:00Z' }), venue_profile_id: 'vp-1' };
  const { items } = buildSpotlight({
    ...BASE, events: [e],
    myEventIds: new Set([e.id]),
    savedEventIds: new Set([e.id]),
    favProfileIds: new Set(['vp-1']),
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].badge, 'MY EVENT');
});

// ── 6 · THE FAVOURITE REASON IS SHARED WITH THE FLOOR ────────────────

test('favouriteReason distinguishes venue from host, and venue is the more specific claim', () => {
  const atVenue = { venue_profile_id: 'vp-1', owner_profile_id: 'op-1', host_id: null };
  assert.equal(favouriteReason(atVenue, new Set(['vp-1', 'op-1']), new Set()), 'venue');
  assert.equal(favouriteReason(atVenue, new Set(['op-1']), new Set()), 'host');
  assert.equal(favouriteReason({ host_id: 'u-1' }, new Set(), new Set(['u-1'])), 'host');
  assert.equal(favouriteReason({ host_id: 'u-2' }, new Set(), new Set(['u-1'])), null);
});

// ── 7 · GENRE RULE IS ALSO A PROXIMITY CLAIM ─────────────────────────

test('FAVOURITE GENRE will not claim a gig 900km away, and an unplaceable one is not called nearby', () => {
  // Announced long ago, so JUST ANNOUNCED cannot pick these up instead and
  // mask which rule actually fired.
  const old = '2020-01-01T00:00:00Z';
  const near  = ev({ date: '2026-01-08', genres: 'Techno', kmNorth: 10,  created: old });
  const far   = ev({ date: '2026-01-07', genres: 'Techno', kmNorth: 900, created: old });
  const ghost = { ...ev({ date: '2026-01-06', genres: 'Techno', created: old }), lat: null, lng: null };
  const { items } = buildSpotlight({
    ...BASE, events: [far, ghost, near], genres: ['Techno'],
    originCoords: BELL, originPostcode: '2454', radiusKm: 50,
  });
  const claimed = items.filter(i => i.ruleKey === 'fav_genre').map(i => i.event.id);
  assert.deepEqual(claimed, [near.id], 'only the genuinely nearby gig may claim the genre reason');
});

test('with no radius set, genre alone qualifies', () => {
  const far = ev({ date: '2026-01-07', genres: 'Techno', kmNorth: 900, created: '2020-01-01T00:00:00Z' });
  const { items } = buildSpotlight({ ...BASE, events: [far], genres: ['Techno'] });
  assert.deepEqual(items.map(i => i.badge), ['FAVOURITE GENRE']);
});

// ── 8 · JUST ANNOUNCED ORDERS BY THE ANNOUNCEMENT ────────────────────

test('JUST ANNOUNCED ranks by announcement recency, because that IS its reason', () => {
  const oldNewsSoon = ev({ date: '2026-01-03', created: '2025-12-26T00:00:00Z' });
  const freshLater  = ev({ date: '2026-01-20', created: '2025-12-31T00:00:00Z' });
  const { items } = buildSpotlight({ ...BASE, events: [oldNewsSoon, freshLater] });
  assert.equal(items[0].badge, 'JUST ANNOUNCED');
  assert.equal(items[0].event.id, freshLater.id, 'newest announcement leads, not the soonest date');
});

test('the default horizon is the tunable constant, not a literal scattered through the table', () => {
  const defaults = SPOTLIGHT_RULES.filter(r => r.horizonDays === DEFAULT_HORIZON_DAYS);
  assert.ok(defaults.length >= 6, 'most rules should share the tunable default');
});
