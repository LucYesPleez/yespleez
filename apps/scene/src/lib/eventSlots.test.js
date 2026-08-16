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
