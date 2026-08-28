import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  groupSlotsIntoDays, toRenderSlot, durationLabel,
  indexPerformances, toClaim, rankPerformance,
} from './eventSlots.js';

/**
 * WRITTEN AGAINST THE REAL ROWS, like slotTally's.
 *
 * Every fixture here is production data as measured on 2026-08-15 with the
 * service role, because the two defects these guard against were both invisible
 * to a synthetic fixture: `dur` was a STRING on one event, and one slot holds
 * FOUR acts on another. A tidy made-up slot has neither problem.
 */

// Solstice Soirée, day 1 (SUNDAY), first three slots — uuids abbreviated.
const solsticeRows = () => ([
  { id: 'u-sun1', event_id: 'ev-sol', day_index: 1, day_name: 'SUNDAY', position: 1, legacy_key: 'sun_1', time: '11:30', ampm: 'AM', dur_mins: 90, label: '', label_color: null, pinned: false },
  { id: 'u-sun0', event_id: 'ev-sol', day_index: 1, day_name: 'SUNDAY', position: 0, legacy_key: 'sun_0', time: '10:00', ampm: 'AM', dur_mins: 90, label: '', label_color: null, pinned: false },
  { id: 'u-sat0', event_id: 'ev-sol', day_index: 0, day_name: 'SATURDAY', position: 0, legacy_key: 'sat_0', time: '4:00', ampm: 'PM', dur_mins: 90, label: 'SUNSET SET 🔒', label_color: null, pinned: false },
]);

test('days and slots come back in the organiser’s order, from the columns', () => {
  const days = groupSlotsIntoDays(solsticeRows());

  assert.equal(days.length, 2);
  assert.equal(days[0].name, 'SATURDAY');
  assert.equal(days[1].name, 'SUNDAY');
  // sun_0 was second in the input array and first by `position`.
  assert.deepEqual(days[1].slots.map(s => s.legacyKey), ['sun_0', 'sun_1']);
});

test('⛔ day indexes are identity, not display — gaps are preserved', () => {
  const days = groupSlotsIntoDays([
    { id: 'a', day_index: 0, position: 0 },
    { id: 'b', day_index: 2, position: 0 },
  ]);
  assert.deepEqual(days.map(d => d.dayIndex), [0, 2], 'renumbering to 0,1 would silently rename Day 3');
});

test('a row becomes a slot the renderers already understand', () => {
  const s = toRenderSlot(solsticeRows()[2]);
  assert.equal(s.id, 'u-sat0');
  assert.equal(s.dur, 90, 'dur_mins → dur');
  assert.equal(s.label, 'SUNSET SET 🔒');
  assert.equal(s.pinned, false);
  // ⚠ The UUID identifies the slot to the UI now, never the text key.
  assert.notEqual(s.id, s.legacyKey);
});

/**
 * ⚠⚠ THE `1.5 hrsm` DEFECT.
 *
 * `EventHostView` computed `slot.dur >= 60` against the string `"1.5 hrs"`,
 * which is false, and fell to the minutes branch — printing `1.5 hrsm` in the
 * ASSIGN SLOT sheet. L2 normalised the column; this asserts the formatter that
 * replaced the inline ternary.
 */
test('durations read as durations, including the five that were "1.5 hrs"', () => {
  assert.equal(durationLabel(90), '1.5hr', 'the value the "1.5 hrs" slots migrated to');
  assert.equal(durationLabel(60), '1hr');
  assert.equal(durationLabel(120), '2hr');
  assert.equal(durationLabel(45), '45m');
  assert.equal(durationLabel(null), '');
  assert.equal(durationLabel(0), '');
  // The old inline expression produced this from the raw string.
  assert.notEqual(durationLabel(90), '1.5 hrsm');
});

/**
 * ⚠⚠ FOUR ACTS ON ONE SLOT — `sat_1`, in production, today.
 *
 * The shipped map was `map[p.slot_id] = {…}`, so whichever row the planner
 * returned last became the slot's occupant. Nothing was wrong with the data;
 * the READER could not represent it.
 */
const sat1Members = () => ({
  'm-anti-name': { id: 'm-anti-name', artist_name: 'Anti-Faffist',   artist_id: null,   artist_profile_id: null },
  'm-hella':     { id: 'm-hella',     artist_name: 'Hella Steezy',   artist_id: null,   artist_profile_id: null },
  'm-anti-prof': { id: 'm-anti-prof', artist_name: 'Anti-Faffist',   artist_id: 'u-17', artist_profile_id: 'p-cef' },
  'm-social':    { id: 'm-social',    artist_name: 'Social capital', artist_id: null,   artist_profile_id: null },
});

const sat1Perfs = () => ([
  { id: 'p-3', slot_uuid: 'u-sat1', lineup_member_id: 'm-anti-prof', status: 'offered' },
  { id: 'p-1', slot_uuid: 'u-sat1', lineup_member_id: 'm-anti-name', status: 'offered' },
  { id: 'p-4', slot_uuid: 'u-sat1', lineup_member_id: 'm-social',    status: 'offered' },
  { id: 'p-2', slot_uuid: 'u-sat1', lineup_member_id: 'm-hella',     status: 'offered' },
]);

test('every act on a contested slot survives the read', () => {
  const { bySlot } = indexPerformances(sat1Perfs(), sat1Members());
  assert.equal(bySlot['u-sat1'].length, 4, 'all four, not the last one the planner returned');
});

test('the single-name view is DETERMINISTIC, whatever order the rows arrive in', () => {
  const forward = indexPerformances(sat1Perfs(), sat1Members()).primary['u-sat1'];
  const reverse = indexPerformances(sat1Perfs().reverse(), sat1Members()).primary['u-sat1'];
  assert.equal(forward.id, reverse.id, 'row order must not decide who is shown');
});

test('an acceptance outranks an offer for the slot’s primary act', () => {
  // ⚠ BOTH MEMBERS MUST BE ACCOUNT-BACKED for this to test what it says. The
  // first draft used `m-hella`, whose `artist_id` is NULL — so `toClaim`
  // promoted it to `confirmed` under the hand-entered rule and the comparison
  // was confirmed-vs-confirmed, not offered-vs-accepted. It failed, correctly.
  const members = {
    'm-cinii':     { id: 'm-cinii',     artist_name: 'Cinii',        artist_id: 'u-84', artist_profile_id: 'p-84' },
    'm-anti-prof': { id: 'm-anti-prof', artist_name: 'Anti-Faffist', artist_id: 'u-17', artist_profile_id: 'p-cef' },
  };
  const perfs = [
    { id: 'p-a', slot_uuid: 'u-x', lineup_member_id: 'm-cinii',     status: 'offered'  },
    { id: 'p-b', slot_uuid: 'u-x', lineup_member_id: 'm-anti-prof', status: 'accepted' },
  ];
  const { primary } = indexPerformances(perfs, members);
  // 'p-b' wins on RANK despite losing the id tiebreak, which is the point.
  assert.equal(primary['u-x'].name, 'Anti-Faffist');
  assert.equal(primary['u-x'].status, 'confirmed');
});

/**
 * ⚠ THE TIE THIS SURFACED, KEPT AS A GUARANTEE.
 *
 * `STATUS_RANK` is applied AFTER `toClaim` has translated, so a hand-entered
 * act and a real acceptance are both `confirmed` and genuinely tie — which is
 * right, they are both bookings nobody is waiting on. What must never come back
 * is the tie resolving differently between two reads.
 *
 * ⛔ This is also why `STATUS_RANK` carries BOTH 'accepted' and 'confirmed'.
 * Dropping 'accepted' as "dead after translation" would make `rankPerformance`
 * return 9 for a raw performance row, silently ranking a real acceptance last.
 */
test('a hand-entered act ties with an acceptance, and the tie is stable', () => {
  const members = {
    'm-typed':     { id: 'm-typed',     artist_name: 'DJ Flames',    artist_id: null,   artist_profile_id: null },
    'm-anti-prof': { id: 'm-anti-prof', artist_name: 'Anti-Faffist', artist_id: 'u-17', artist_profile_id: 'p-cef' },
  };
  const perfs = [
    { id: 'p-a', slot_uuid: 'u-x', lineup_member_id: 'm-typed',     status: 'offered'  },
    { id: 'p-b', slot_uuid: 'u-x', lineup_member_id: 'm-anti-prof', status: 'accepted' },
  ];
  const a = indexPerformances(perfs, members).primary['u-x'];
  const b = indexPerformances([...perfs].reverse(), members).primary['u-x'];
  assert.equal(rankPerformance(a), 0);
  assert.equal(a.id, b.id, 'the tiebreak must not depend on row order');
});

test('a member on the bill with no slot produces no claim', () => {
  const { bySlot } = indexPerformances(
    [{ id: 'p-x', slot_uuid: null, lineup_member_id: 'm-hella', status: 'draft' }],
    sat1Members(),
  );
  assert.deepEqual(bySlot, {}, '123 of 152 members are in exactly this state');
});

/**
 * ⚠ A HAND-ENTERED ACT IS CONFIRMED BY BEING WRITTEN DOWN. There is no account
 * to offer to and nobody to accept, so treating `offered` literally would show
 * them as awaiting a reply from nobody, forever.
 */
test('a typed-in act reads as confirmed, not as awaiting an answer', () => {
  const typed = { id: 'm-t', artist_name: 'DJ Flames', artist_id: null, artist_profile_id: null };
  assert.equal(toClaim({ id: 'p', slot_uuid: 's', status: 'offered' }, typed).status, 'confirmed');

  const real = { id: 'm-r', artist_name: 'Cinii', artist_id: 'u-1', artist_profile_id: 'p-1' };
  assert.equal(toClaim({ id: 'p', slot_uuid: 's', status: 'offered' }, real).status, 'offered');
});

test('an unknown status ranks last rather than beating a real one', () => {
  assert.ok(rankPerformance({ status: 'weird' }) > rankPerformance({ status: 'declined' }));
});

/**
 * ⭐⭐ THE DISPLAY SHAPE IS FROZEN. Step 1 of the canonical-claim refactor ADDED
 * `performance` and `member` so a decision can read the database's own answer.
 * ⛔ It must not have CHANGED anything a component already reads — that is the
 * whole basis for calling it non-breaking.
 *
 * This test is the mechanism, not the promise: an accidental rename or drop in
 * the display half fails here rather than at a blank card in production.
 */
const DISPLAY_KEYS = [
  'id', 'member_id', 'slot_id', 'user_id', 'profile_id',
  'name', 'genre', 'sound', 'card_pills', 'status',
];

test('the display half of a claim is unchanged by carrying the raw rows', () => {
  const member = {
    id: 'm-1', artist_name: 'Cinii', artist_id: 'u-1', artist_profile_id: 'p-1',
    genre: 'house', sound: 'deep', card_pills: ['a'],
  };
  const p = { id: 'p-1', slot_uuid: 's-1', lineup_member_id: 'm-1', status: 'offered' };
  const claim = toClaim(p, member);

  assert.deepEqual(
    Object.fromEntries(DISPLAY_KEYS.map(k => [k, claim[k]])),
    {
      id: 'p-1', member_id: 'm-1', slot_id: 's-1', user_id: 'u-1', profile_id: 'p-1',
      name: 'Cinii', genre: 'house', sound: 'deep', card_pills: ['a'], status: 'offered',
    },
  );
  // ⛔ Nothing beyond the display keys and the two raw rows. A third addition
  // here is a new interpretation of lineup state and belongs in a lib, not here.
  assert.deepEqual(
    Object.keys(claim).sort(),
    [...DISPLAY_KEYS, 'member', 'performance'].sort(),
  );
});

/**
 * ⛔⛔ THE FICTION MUST NOT REACH A DECISION.
 *
 * A hand-entered act displays as `confirmed` although its row says `offered`,
 * and a real acceptance displays as `confirmed` although its row says
 * `accepted`. Both are right for pixels and wrong for notifications: acting on
 * the translated value tells somebody an offer was withdrawn when no offer was
 * ever made. `claim.performance.status` is what a planner reads.
 */
test('the raw status survives the translation that displays it', () => {
  const typed = { id: 'm-t', artist_name: 'DJ Flames', artist_id: null, artist_profile_id: null };
  const typedClaim = toClaim({ id: 'p', slot_uuid: 's', status: 'offered' }, typed);
  assert.equal(typedClaim.status, 'confirmed', 'display: nobody is awaiting a reply');
  assert.equal(typedClaim.performance.status, 'offered', 'truth: the row still says offered');

  const real = { id: 'm-r', artist_name: 'Cinii', artist_id: 'u-1', artist_profile_id: 'p-1' };
  const realClaim = toClaim({ id: 'p2', slot_uuid: 's', status: 'accepted' }, real);
  assert.equal(realClaim.status, 'confirmed');
  assert.equal(realClaim.performance.status, 'accepted', 'accepted ≠ confirmed downstream');
});

/**
 * ⚠ BOTH SURFACES INHERIT IT, because both loaders call `indexPerformances`
 * rather than building claims themselves. That is the reason this refactor is
 * one edit instead of two — and the reason a second interpreter would undo it.
 */
test('every claim from indexPerformances carries its raw rows, on both paths', () => {
  const { bySlot, primary } = indexPerformances(sat1Perfs(), sat1Members());
  const all = [...Object.values(bySlot).flat(), ...Object.values(primary)];
  assert.ok(all.length > 0);
  for (const c of all) {
    assert.ok(c.performance?.id, 'a claim with no performance row cannot be acted on safely');
    assert.equal(c.performance.slot_uuid, c.slot_id);
    assert.equal(c.member.id, c.member_id);
  }
});

/* ⭐⭐ A DAY CARRIES ITS DATE (Phase 3, 2026-08-27). The host path grouped slots
   into days that were bare ORDINALS, so a lineup spanning a festival could not
   say which calendar day any of it was on. */
test('groupSlotsIntoDays attaches each day its own date', () => {
  const rows = [
    { day_index: 0, position: 0, time: '3:00', ampm: 'PM' },
    { day_index: 1, position: 0, time: '3:00', ampm: 'PM' },
    { day_index: 2, position: 0, time: '3:00', ampm: 'PM' },
  ];
  const days = groupSlotsIntoDays(rows, ['2026-08-28', '2026-08-29', '2026-08-30']);
  assert.equal(days.length, 3);
  assert.equal(days[0].date, '2026-08-28');
  assert.equal(days[1].date, '2026-08-29');
  assert.equal(days[2].date, '2026-08-30');
});

test('⚠ dates are OPTIONAL — a caller without the event row gets the old shape', () => {
  const days = groupSlotsIntoDays([{ day_index: 0, position: 0, time: '8:00', ampm: 'PM' }]);
  assert.equal(days.length, 1);
  assert.equal(days[0].date, '', 'empty, never undefined — the label falls back to the ordinal');
  assert.equal(days[0].dayIndex, 0);
});

test('⚠ a day beyond the dates supplied still renders, it just claims no date', () => {
  // The Neverland shape: a range that covers fewer days than the slots do.
  const rows = [{ day_index: 0, position: 0 }, { day_index: 1, position: 0 }];
  const days = groupSlotsIntoDays(rows, ['2026-08-28']);
  assert.equal(days.length, 2, 'the extra day is NOT dropped');
  assert.equal(days[1].date, '');
});

/* ⭐⭐ STAGES ARE PAGES INSIDE A DAY — S2e, 2026-08-27, and the ratified
   multi-stage design: each stage is a vertical timeline, stages sit side by
   side as snap pages, rows align by TIME so the peek is the comparison.

   ⚠⚠ The bug this replaced: `position` is per (day, stage), so a two-stage day
   holds two slots at position 0. Sorting a day's slots by position alone
   INTERLEAVED the rooms, and the host's set times read 4:30, 5:00 (DJ), 6:00
   (DJ), then back to 5:00 (Live). */
const STAGES = [{ id: 'A', name: 'LIVE STAGE', position: 0 }, { id: 'B', name: 'DJ STAGE', position: 1 }];

test('a two-stage day becomes one day with TWO stage pages', () => {
  const rows = [
    { day_index: 0, position: 0, time: '4:30', ampm: 'PM', stage_id: 'A' },
    { day_index: 0, position: 0, time: '5:00', ampm: 'PM', stage_id: 'B' },
    { day_index: 0, position: 1, time: '5:00', ampm: 'PM', stage_id: 'A' },
  ];
  const out = groupSlotsIntoDays(rows, ['2026-08-28'], STAGES);
  assert.equal(out.length, 1, 'ONE day, not one section per stage');
  assert.deepEqual(out[0].stages.map(s => s.name), ['LIVE STAGE', 'DJ STAGE']);
  assert.deepEqual(out[0].stages[0].slots.map(s => s.time), ['4:30', '5:00']);
  assert.deepEqual(out[0].stages[1].slots.map(s => s.time), ['5:00']);
});

test('⛔ pages follow STAGE POSITION, not the order rows arrive in', () => {
  const rows = [
    { day_index: 0, position: 0, time: '9:00', ampm: 'PM', stage_id: 'B' },
    { day_index: 0, position: 0, time: '8:00', ampm: 'PM', stage_id: 'A' },
  ];
  const out = groupSlotsIntoDays(rows, [], [STAGES[1], STAGES[0]]);
  assert.deepEqual(out[0].stages.map(s => s.name), ['LIVE STAGE', 'DJ STAGE']);
});

test('⭐⭐ EVERY DAY CARRIES EVERY STAGE, so the pages line up under each other', () => {
  // The Neverland shape: workshops run on Sunday only. Both days must still
  // offer both pages in the same order, or one swipe desynchronises the days —
  // which is exactly what omitting the empty ones did.
  const rows = [
    { day_index: 0, position: 0, time: '8:00', ampm: 'PM', stage_id: 'A' },
    { day_index: 1, position: 0, time: '10:00', ampm: 'AM', stage_id: 'B' },
  ];
  const out = groupSlotsIntoDays(rows, [], STAGES);
  assert.deepEqual(out.map(d => d.stages.map(s => s.name)),
    [['LIVE STAGE', 'DJ STAGE'], ['LIVE STAGE', 'DJ STAGE']]);
  assert.deepEqual(out[0].stages[1].slots, [], 'the day it does not run is EMPTY, not absent');
  assert.deepEqual(out[1].stages[0].slots, []);
});

test('⚠ an empty stage adds nothing to the day\'s own slot list', () => {
  const rows = [{ day_index: 0, position: 0, time: '8:00', ampm: 'PM', stage_id: 'A' }];
  const out = groupSlotsIntoDays(rows, [], STAGES);
  assert.equal(out[0].slots.length, 1, 'a page with no slots must not inflate the day');
});

test('⚠⚠ `slots` STILL HOLDS THE WHOLE DAY — hostLineup and friends read it', () => {
  const rows = [
    { day_index: 0, position: 0, time: '4:30', ampm: 'PM', stage_id: 'A' },
    { day_index: 0, position: 0, time: '5:00', ampm: 'PM', stage_id: 'B' },
  ];
  const out = groupSlotsIntoDays(rows, [], STAGES);
  assert.equal(out[0].slots.length, 2, 'a nested-only shape would break them SILENTLY');
  assert.deepEqual(out[0].slots.map(s => s.time), ['4:30', '5:00'], 'in stage order');
});

test('⚠⚠ ONE stage is NOT paged — a single-stage event keeps the old shape exactly', () => {
  const rows = [{ day_index: 0, position: 0, time: '8:00', ampm: 'PM', stage_id: 'A' }];
  const out = groupSlotsIntoDays(rows, [], [STAGES[0]]);
  assert.equal('stages' in out[0], false, 'no stage chrome at all on a single-stage event');
  assert.deepEqual(out[0].slots.map(s => s.time), ['8:00']);
});

test('an event with NO stages is untouched, and still sorts by position', () => {
  const rows = [
    { day_index: 0, position: 1, time: '9:00', ampm: 'PM' },
    { day_index: 0, position: 0, time: '8:00', ampm: 'PM' },
  ];
  const out = groupSlotsIntoDays(rows, []);
  assert.equal('stages' in out[0], false);
  assert.deepEqual(out[0].slots.map(s => s.time), ['8:00', '9:00']);
});

test('⚠ a slot with NO stage on a staged event still renders, as a trailing page', () => {
  const rows = [
    { day_index: 0, position: 0, time: '8:00', ampm: 'PM', stage_id: 'A' },
    { day_index: 0, position: 0, time: '11:00', ampm: 'PM' },
  ];
  const out = groupSlotsIntoDays(rows, [], STAGES);
  const last = out[0].stages[out[0].stages.length - 1];
  assert.equal(last.id, null);
  assert.deepEqual(last.slots.map(s => s.time), ['11:00']);
});

/* ── ⭐ ADD A MARKER ───────────────────────────────────────────────────
   A welcome to country, doors, a smoking ceremony: a slot that marks a moment
   and books nobody. It goes at the TOP of a stage's day, because `position` is
   a dense integer per (day, stage) and a mid-list insert would have to renumber
   every row after it — a multi-row write with no transaction, which on failure
   leaves two slots sharing a position and silently scrambles the order. */
test('the marker sorts before every existing slot without renumbering any', async () => {
  const { addSlotBefore } = await import('./eventSlots.js');
  let inserted = null;
  const db = { from: () => ({ insert(row) { inserted = row; return { select: () => ({ maybeSingle: async () => ({ data: { id: 'new', ...row } }) }) }; } }) };

  const res = await addSlotBefore(db, {
    eventId: 'e1', dayIndex: 0, dayName: 'Friday', stageId: 'st1',
    stageSlots: [
      { position: 0, time: '5:00', ampm: 'PM' },
      { position: 1, time: '6:00', ampm: 'PM' },
    ],
    label: 'Welcome to Country',
  });

  assert.equal(res.ok, true);
  assert.equal(inserted.position, -1, 'min(position) - 1, so no existing row moves');
  assert.equal(inserted.time, '5:00', 'the time is copied from the slot it precedes, not invented');
  assert.equal(inserted.ampm, 'PM');
  assert.equal(inserted.label, 'Welcome to Country');
  assert.equal(inserted.dur_mins, 15, 'a moment, not a headline-length set');
});

test('⛔ a marker is refused when there is nothing to precede', async () => {
  const { addSlotBefore } = await import('./eventSlots.js');
  const res = await addSlotBefore({ from: () => { throw new Error('must not write'); } },
    { eventId: 'e1', stageSlots: [] });
  assert.equal(res.ok, false, 'no slots means no position to compute — it must not guess one');
});

test('the label is trimmed, and a blank one is stored as empty', async () => {
  const { addSlotBefore } = await import('./eventSlots.js');
  let inserted = null;
  const db = { from: () => ({ insert(row) { inserted = row; return { select: () => ({ maybeSingle: async () => ({ data: row }) }) }; } }) };
  await addSlotBefore(db, { eventId: 'e1', stageSlots: [{ position: 3 }], label: '  Doors  ' });
  assert.equal(inserted.label, 'Doors');
  assert.equal(inserted.position, 2, 'relative to THIS stage\'s lowest position, not zero');
});
