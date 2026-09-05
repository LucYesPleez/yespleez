/**
 * THE HOST CAN ANNOUNCE A RUNNING ORDER BEFORE EVERY ACT HAS REPLIED.
 *
 * ⛔⛔ AND IT MUST NEVER DO THAT BY WRITING `performances.status`. That column
 * is the ARTIST's agreement, and `isBooked` reads it for a managed contract, so
 * announcing on somebody's behalf would put a booking on the bill that nobody
 * consented to. The override lives on the EVENT and changes display only.
 *
 * The report: a host ready to post their running order saw PENDING down the
 * public schedule while the LINEUP directly beneath named every one of those
 * same acts (owner, 2026-09-05).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { slotOccupant } from './slotUtils.js';
import { setTimesAnnounced, withSetTimesAnnounced, setTimesEnabled } from '../../lib/eventSetTimes.js';

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Comments out, so an assertion is about code and not about prose. */
const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const AWAITING = { status: 'offered', name: 'COSMATIK', user_id: 'u1' };

/* ── the flag ───────────────────────────────────────────────────────────── */

test('⭐ absent means exactly today’s behaviour, and there is no backfill', () => {
  assert.equal(setTimesAnnounced(undefined), false);
  assert.equal(setTimesAnnounced({}), false);
  assert.equal(setTimesAnnounced({ config: {} }), false);
  assert.equal(setTimesAnnounced({ config: { set_times_announced: false } }), false);
  assert.equal(setTimesAnnounced({ config: { set_times_announced: true } }), true);
  // ⛔ only a real `true` counts — a truthy string must not announce a bill
  assert.equal(setTimesAnnounced({ config: { set_times_announced: 'yes' } }), false);
});

test('⛔ the patch MERGES, it never replaces the rest of config', () => {
  const cfg = { days: [1, 2], poster: 'p.jpg', set_times_enabled: true, set_times_locked: true };
  const next = withSetTimesAnnounced(cfg, true);
  assert.equal(next.set_times_announced, true);
  assert.deepEqual(next.days, [1, 2]);
  assert.equal(next.poster, 'p.jpg');
  assert.equal(next.set_times_locked, true);
  // and the sibling flag still answers for itself
  assert.equal(setTimesEnabled({ config: next }, 0), true);
});

/* ── what it changes on the public schedule ─────────────────────────────── */

test('⛔⛔ THE REPORTED CASE: an act awaiting reply reads PENDING until announced', () => {
  assert.equal(slotOccupant(AWAITING, false).name, 'PENDING');
  assert.equal(slotOccupant(AWAITING, false, true).name, 'COSMATIK');
});

test('⭐ the host always saw the name, announced or not', () => {
  assert.equal(slotOccupant(AWAITING, true).name, 'COSMATIK');
  assert.equal(slotOccupant(AWAITING, true, true).name, 'COSMATIK');
});

test('⭐ a confirmed act was already named, and announcing changes nothing for it', () => {
  const done = { status: 'confirmed', name: 'LUCIOUS' };
  assert.equal(slotOccupant(done, false).name, 'LUCIOUS');
  assert.equal(slotOccupant(done, false, true).name, 'LUCIOUS');
});

test('⛔⛔ a DRAFT slot stays hidden from the public even when announced', () => {
  // A time never sent is not part of the running order being announced.
  const draft = { status: 'draft', name: 'SECRET HEADLINER' };
  assert.equal(slotOccupant(draft, false).isEmpty, true);
  assert.equal(slotOccupant(draft, false, true).isEmpty, true);
  assert.equal(slotOccupant(draft, false, true).name, '');
  // the host still sees it
  assert.equal(slotOccupant(draft, true).name, 'SECRET HEADLINER');
});

test('⛔ an empty slot does not grow a name from the override', () => {
  assert.equal(slotOccupant(null, false, true).isEmpty, true);
  assert.equal(slotOccupant(undefined, false, true).name, '');
});

test('⭐ the status is returned untouched, so the host chip still tells the truth', () => {
  // AWAITING REPLY must survive announcing — the two facts are separate.
  assert.equal(slotOccupant(AWAITING, false, true).status, 'offered');
  assert.equal(slotOccupant(AWAITING, true, true).status, 'offered');
});

/* ── it must not become a booking ───────────────────────────────────────── */

test('⛔⛔ the toggle writes CONFIG ONLY, never performances', () => {
  const HOST = read('./EventHostView.jsx');
  /* ⚠ START AT THE COMMENT'S OPENING `{/**`, not at the heading text inside
     it. Slicing from the heading cut the block's opening delimiter off, so the
     comment stripper below had nothing to match and left the whole thing in. */
  const heading = HOST.indexOf('ANNOUNCE THE NAMES');
  const i = HOST.lastIndexOf('{/**', heading);
  const j = HOST.indexOf('PUBLISH SET TIMES', heading);
  assert.ok(i > 0 && heading > i && j > heading, 'the announce block exists and ends before the publish block');
  /* ⚠ BOUNDED BY THE NEXT BLOCK, ⛔ not by a character count. A fixed window
     ran past the end of this block into the publish one below, which talks
     about acceptance for its own good reasons, and the test failed on the
     neighbour's text rather than on anything this block does. */
  /* ⚠⚠ AND WITH THE COMMENTS STRIPPED. The block's own documentation quotes
     `status: 'accepted'` in the course of explaining why it must never write
     it, so a raw scan reads the warning as the violation. */
  const block = stripComments(HOST.slice(i, j));
  assert.match(block, /withSetTimesAnnounced\(event\.config, next\)/, 'writes via the patch helper');
  // the control: stripping did not simply empty the block
  assert.match(block, /from\('events'\)/, 'the update itself is still here');
  assert.ok(!/from\('performances'\)/.test(block), 'must never touch performances');
  assert.ok(!/status:\s*'accepted'/.test(block), 'must never forge an acceptance');
  assert.ok(!/accepted_at/.test(block), 'must never stamp an acceptance time');
});

test('⭐ publishing set times is still the separate, narrower action', () => {
  // `applyPublishSetTimes` writes `accepted` and is deliberately limited to
  // acts with no account — nobody exists to ask. Announcing must not have
  // widened it.
  const ACTIONS = read('../../lib/lineupActions.js');
  assert.match(ACTIONS, /if \(p\.status !== 'draft'\) return false;/);
  assert.match(ACTIONS, /return !!member && !isReachable\(member\);/,
    'still only the unreachable are auto-accepted');
});

/* ── every surface reads one answer ─────────────────────────────────────── */

test('⛔ the schedule map and the cards share the flag, not just the function', () => {
  const MAP  = read('./ScheduleMap.jsx');
  const PORT = read('./SchedulePortrait.jsx');
  const CARD = read('./SlotCard.jsx');
  assert.match(MAP,  /slotOccupant\(claim, false, namesAnnounced\)/,
    'the map used to call slotOccupant with no arguments at all');
  assert.match(CARD, /slotOccupant\(claim, isHost, namesAnnounced\)/);
  // and it is carried, never re-derived, on the way down
  for (const [name, src] of [['portrait', PORT], ['map', MAP]]) {
    assert.ok(!/setTimesAnnounced\(/.test(src), `${name} must not read the event itself`);
  }
});
