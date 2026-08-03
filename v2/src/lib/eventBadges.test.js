/**
 * EVENT CATEGORY BADGES — tests
 *
 * ── WHY THESE EARN THEIR KEEP ────────────────────────────────────────
 *
 * This rule was copy-pasted into three render surfaces and one copy drifted:
 * WhatsOnScreen called getEventBadges() alone, so a host who tagged an event
 * "dubstep, dnb, breaks" and explicitly picked DJs saw NO chip in What's On,
 * while the same event rendered correctly on its card and on the profile. The
 * failure is silent — a missing chip looks like an event nobody categorised,
 * which is exactly what auto-detection is FOR, so it reads as working.
 *
 *   1. THE HOST'S CHOICE BEATS AUTO-DETECTION. The whole bug, pinned.
 *   2. THE REAL CASE. "dubstep, dnb, breaks" matches none of the keywords —
 *      if someone ever "simplifies" this back to auto-only, this fails.
 *   3. AUTO STILL WORKS when nobody chose, because that is the fallback's job.
 *   4. OPEN MIC SITS ALONGSIDE, never replacing the category.
 *   5. AN UNKNOWN STORED LABEL still renders as itself rather than vanishing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventCategoryBadges, CATEGORY_BADGES, OPEN_MIC_BADGE, resolveCategoryBadge, sameCategory,
} from './eventBadges.js';

test('the host\'s explicit chip beats auto-detection', () => {
  // Genres would auto-detect LIVE MUSIC; the host said DJs. The host wins.
  const badges = eventCategoryBadges({ categoryBadge: 'DJs', genres: 'rock, acoustic' }, 'Some Night');
  assert.deepEqual(badges.map(b => b.label), ['DJs']);
});

test('THE REAL CASE: "dubstep, dnb, breaks" + DJs chip still shows DJs', () => {
  const cfg = { categoryBadge: 'DJs', genres: 'dubstep, dnb, breaks' };
  assert.deepEqual(eventCategoryBadges(cfg, 'Bass Heavy').map(b => b.label), ['DJs']);
  // The point of the fixture: auto-detection finds nothing here, so an
  // auto-only implementation renders an empty shelf and looks fine doing it.
  assert.deepEqual(eventCategoryBadges({ genres: 'dubstep, dnb, breaks' }, 'Bass Heavy'), []);
});

test('auto-detection still runs when nobody chose a category', () => {
  assert.deepEqual(eventCategoryBadges({ genres: 'techno, house' }, '').map(b => b.label), ['DJs']);
  assert.deepEqual(eventCategoryBadges({ genres: 'folk, roots' }, '').map(b => b.label), ['LIVE MUSIC']);
  assert.deepEqual(eventCategoryBadges({ genres: 'festival, folk' }, '').map(b => b.label), ['FESTIVAL'],
    'festival wins over the music type');
});

test('Open Mic sits alongside the category, never replacing it', () => {
  const withChoice = eventCategoryBadges({ categoryBadge: 'DJs', openMicBadge: true, genres: '' }, '');
  assert.deepEqual(withChoice.map(b => b.label), ['DJs', OPEN_MIC_BADGE.label]);

  // ...and is not added twice when auto-detection already found it.
  const auto = eventCategoryBadges({ openMicBadge: true, genres: 'open mic, folk' }, '');
  assert.equal(auto.filter(b => b.label === OPEN_MIC_BADGE.label).length, 1);
});

test('an unrecognised stored label keeps its own text rather than vanishing', () => {
  const badges = eventCategoryBadges({ categoryBadge: 'Cabaret' }, '');
  assert.deepEqual(badges.map(b => b.label), ['Cabaret']);
});

test('legacy casing still resolves to the canonical chip', () => {
  // Rows saved before the labels were canonicalised stored "Live Music".
  assert.equal(resolveCategoryBadge('Live Music').label, CATEGORY_BADGES.LIVE_MUSIC.label);
  assert.ok(sameCategory('live  music', 'LIVE MUSIC'));
});

test('an event with no config at all yields no chips rather than throwing', () => {
  assert.deepEqual(eventCategoryBadges(), []);
  assert.deepEqual(eventCategoryBadges({}, ''), []);
});

/* ─── An event can be more than one thing ──────────────────────────── */

test('THE REAL CASE: "Live Band, DJ" shows BOTH Live Music and DJs', () => {
  // Neverland '26. The old chain tested DJs before Live Music and stopped at
  // the first hit, so a bill with both showed only DJs.
  assert.deepEqual(
    eventCategoryBadges({ genres: 'Live Band, DJ' }, "Neverland '26").map(b => b.label),
    ['LIVE MUSIC', 'DJs'],
  );
});

test('order follows the editor chip order, not match order', () => {
  assert.deepEqual(
    eventCategoryBadges({ genres: 'techno, rock' }, '').map(b => b.label),
    ['LIVE MUSIC', 'DJs'],
  );
});

test('a single-genre event still shows exactly one chip', () => {
  assert.deepEqual(eventCategoryBadges({ genres: 'techno' }, '').map(b => b.label), ['DJs']);
  assert.deepEqual(eventCategoryBadges({ genres: 'folk' }, '').map(b => b.label), ['LIVE MUSIC']);
});

test('FESTIVAL stays exclusive — it says more alone than stacked', () => {
  assert.deepEqual(
    eventCategoryBadges({ genres: 'festival, folk, dj' }, '').map(b => b.label),
    ['FESTIVAL'],
  );
  // ...but Open Mic still rides along, because it is not a category.
  assert.deepEqual(
    eventCategoryBadges({ genres: 'festival, open mic' }, '').map(b => b.label),
    ['FESTIVAL', OPEN_MIC_BADGE.label],
  );
});

test('comedy and spoken word can co-exist on one bill', () => {
  assert.deepEqual(
    eventCategoryBadges({ genres: 'comedy, poetry' }, '').map(b => b.label),
    ['COMEDY', 'SPOKEN WORD'],
  );
});
