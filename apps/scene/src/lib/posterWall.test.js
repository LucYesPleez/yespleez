import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWallItems, buildStickers, applyWallState, seedFor, nextSize,
  wallYears, inPeriod, wallStats, layoutWall, POSTER_SIZES,
} from './posterWall.js';

const ev = (id, date, extra = {}) => ({ id, name: id, config: { date, ...extra } });
const PAST = '2026-01-10', FUTURE = '2026-12-01', TODAY = '2026-08-31';

describe('buildWallItems — the accumulation rule', () => {
  it('participation always joins the wall, past or future', () => {
    const items = buildWallItems({
      events: [ev('a', PAST), ev('b', FUTURE)],
      playedIds: new Set(['a']), hostedIds: new Set(['b']),
      followedIds: new Set(), todayStr: TODAY,
    });
    assert.deepEqual(items.map(i => i.id).sort(), ['a', 'b']);
  });

  it('a followed event joins ONLY once past — a future follow never reaches the wall', () => {
    const items = buildWallItems({
      events: [ev('past', PAST), ev('future', FUTURE)],
      playedIds: new Set(), hostedIds: new Set(),
      followedIds: new Set(['past', 'future']), todayStr: TODAY,
    });
    assert.deepEqual(items.map(i => i.id), ['past']);
  });

  it('an undated event is never past, so a follow of it stays off the wall', () => {
    const items = buildWallItems({
      events: [ev('undated', undefined)],
      followedIds: new Set(['undated']), todayStr: TODAY,
    });
    assert.deepEqual(items, []);
  });

  it('badge precedence: PLAYED over HOSTED over WENT', () => {
    const both = buildWallItems({
      events: [ev('a', PAST)],
      playedIds: new Set(['a']), hostedIds: new Set(['a']),
      followedIds: new Set(['a']), todayStr: TODAY,
    });
    assert.equal(both[0].badge, 'PLAYED');
    const went = buildWallItems({
      events: [ev('a', PAST)], followedIds: new Set(['a']), todayStr: TODAY,
    });
    assert.equal(went[0].badge, 'WENT');
  });

  it('no poster art means a post-it note, never a hole', () => {
    const items = buildWallItems({
      events: [ev('bare', PAST), ev('art', PAST, { poster: 'x.jpg' })],
      followedIds: new Set(['bare', 'art']), todayStr: TODAY,
    });
    const byId = Object.fromEntries(items.map(i => [i.id, i]));
    assert.equal(byId.bare.kind, 'note');
    assert.equal(byId.art.kind, 'poster');
    assert.equal(byId.art.img, 'x.jpg');
  });

  it('poster_full wins over the cropped poster', () => {
    const [it_] = buildWallItems({
      events: [ev('a', PAST, { poster: 'crop.jpg', poster_full: 'full.jpg' })],
      followedIds: new Set(['a']), todayStr: TODAY,
    });
    assert.equal(it_.img, 'full.jpg');
  });

  it('sorts oldest first and dedupes event rows', () => {
    const items = buildWallItems({
      events: [ev('b', '2026-03-01'), ev('a', '2026-01-01'), ev('b', '2026-03-01')],
      followedIds: new Set(['a', 'b']), todayStr: TODAY,
    });
    assert.deepEqual(items.map(i => i.id), ['a', 'b']);
  });
});

describe('seeds — deterministic, stepped sizes', () => {
  it('the same id always seeds the same look', () => {
    assert.deepEqual(seedFor('abc'), seedFor('abc'));
  });
  it('rotation stays within the physical band and size is a real paper size', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const s = seedFor(id);
      assert.ok(Math.abs(s.rot) <= 6);
      assert.ok(POSTER_SIZES.includes(s.size));
    }
  });
  it('nextSize cycles A5 to A4 to A3 and around', () => {
    assert.equal(nextSize('a5'), 'a4');
    assert.equal(nextSize('a4'), 'a3');
    assert.equal(nextSize('a3'), 'a5');
  });
});

describe('curation — hide plus overrides, membership untouched', () => {
  const items = buildWallItems({
    events: [ev('a', PAST), ev('b', PAST)],
    followedIds: new Set(['a', 'b']), todayStr: TODAY,
  });
  it('hidden items leave the wall; the rest carry overrides', () => {
    const out = applyWallState(items, { hidden: ['a'], pos: { b: { x: 5, y: 7 } }, size: { b: 'a3' } });
    assert.deepEqual(out.map(i => i.id), ['b']);
    assert.deepEqual(out[0].posOverride, { x: 5, y: 7 });
    assert.equal(out[0].sizeOverride, 'a3');
  });
  it('empty state passes everything through', () => {
    assert.equal(applyWallState(items).length, 2);
  });
});

describe('time breakdowns — one wall, filtered', () => {
  const items = buildWallItems({
    events: [ev('a', '2025-11-02'), ev('b', '2026-02-14')],
    followedIds: new Set(['a', 'b']), todayStr: TODAY,
  });
  it('years come newest first', () => {
    assert.deepEqual(wallYears(items), ['2026', '2025']);
  });
  it('filters by year and by month with string compare, never a Date slice', () => {
    assert.deepEqual(items.filter(i => inPeriod(i, { year: '2025' })).map(i => i.id), ['a']);
    assert.deepEqual(items.filter(i => inPeriod(i, { year: '2026', month: '02' })).map(i => i.id), ['b']);
    assert.equal(items.filter(i => inPeriod(i, null)).length, 2);
  });
  it('stickers ride along on year views but not month views', () => {
    const st = { kind: 'sticker', id: 's' };
    assert.equal(inPeriod(st, { year: '2026' }), true);
    assert.equal(inPeriod(st, { year: '2026', month: '02' }), false);
  });
});

describe('stats stay secondary and honest', () => {
  it('counts posters, distinct venues, festivals as multi-day', () => {
    const items = buildWallItems({
      events: [
        ev('a', PAST, { venue_name: 'The Fed' }),
        ev('b', PAST, { venue_name: 'the fed ' }),
        ev('c', PAST, { venue_name: 'Warehouse', endDate: '2026-01-12' }),
      ],
      followedIds: new Set(['a', 'b', 'c']), todayStr: TODAY,
    });
    const s = wallStats(items);
    assert.equal(s.posters, 3);
    assert.equal(s.venues, 2);
    assert.equal(s.festivals, 1);
  });
});

describe('layout — stable, bounded, override-respecting', () => {
  const items = applyWallState(buildWallItems({
    events: [ev('a', PAST, { poster: 'x' }), ev('b', PAST), ev('c', PAST, { poster: 'y' })],
    followedIds: new Set(['a', 'b', 'c']), todayStr: TODAY,
  }));
  it('is deterministic for the same inputs', () => {
    assert.deepEqual(layoutWall(items, 390), layoutWall(items, 390));
  });
  it('keeps every item inside the wall width', () => {
    const { items: placed } = layoutWall(items, 390);
    for (const p of placed) {
      assert.ok(p.x >= 0);
      assert.ok(p.x + p.w <= 390 + 24 + 24);
    }
  });
  it('a position override wins over the seeded spot', () => {
    const moved = items.map(i => i.id === 'a' ? { ...i, posOverride: { x: 3, y: 9 } } : i);
    const { items: placed } = layoutWall(moved, 390);
    const a = placed.find(p => p.id === 'a');
    assert.deepEqual([a.x, a.y], [3, 9]);
  });
  it('stickers land inside the wall bounds', () => {
    const withSticker = [...items, { id: 'sticker:1', kind: 'sticker', seed: seedFor('sticker:1') }];
    const { items: placed, height } = layoutWall(withSticker, 390);
    const st = placed.find(p => p.kind === 'sticker');
    assert.ok(st.x >= 0);
    assert.ok(st.y + st.h <= height);
  });
});

describe('buildStickers', () => {
  it('one sticker per logo, none for profiles without logos', () => {
    const out = buildStickers({
      followedProfiles: [{ id: 'p1', name: 'Act' }, { id: 'p2', name: 'NoLogo' }],
      logosByProfile: { p1: [{ id: 'l1', url: 'u1' }, { id: 'l2', url: 'u2' }], p2: [] },
    });
    assert.equal(out.length, 2);
    assert.equal(out[0].profileId, 'p1');
    assert.ok(out.every(s => s.kind === 'sticker'));
  });
});
