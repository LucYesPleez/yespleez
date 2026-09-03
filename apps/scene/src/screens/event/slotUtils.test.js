/**
 * SLOT LABELS — the pure helpers behind a card's heading and chip.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isWelcomeToCountry } from './slotUtils.js';

/* ── ⭐ THE ONE MARKER THAT IS NOT DIMMED ──────────────────────────────
   `.slotEmpty` drops a slot with no ACT to 55%, which is right for an open slot
   and right for the scaffolding around a programme — stage open, stage close,
   doors. It is wrong for a welcome to country, which is the programme (owner,
   2026-08-28: "stage close can be muted, that's not as important; welcome to
   country is"). */

test('the spellings organisers actually use all match', () => {
  for (const l of [
    'Welcome to Country',
    'Welcome to Country / Choir',       // Neverland's own
    'WELCOME TO COUNTRY',
    'Welcome & Smoking Ceremony — Welcome to Country',
    'Acknowledgement of Country',
    'Acknowledgment of Country',        // both spellings are in use
  ]) {
    assert.equal(isWelcomeToCountry(l), true, `should match: ${l}`);
  }
});

test('⛔ every other marker stays muted', () => {
  // These are scaffolding around the programme, and the owner said so
  // explicitly. ⛔ Do not widen the match to tidy the rule up.
  for (const l of ['Stage close', 'Stage open', 'Doors', 'Changeover', 'Sunset Set']) {
    assert.equal(isWelcomeToCountry(l), false, `should NOT match: ${l}`);
  }
});

test('⛔ a near miss does not count as a welcome', () => {
  // "Country Set" is a genre on a running order, not an acknowledgement.
  assert.equal(isWelcomeToCountry('Country Set'), false);
  assert.equal(isWelcomeToCountry('Welcome Party'), false);
});

test('an absent label is not an error', () => {
  for (const l of ['', null, undefined]) assert.equal(isWelcomeToCountry(l), false);
});

/* ── ⭐⭐ WHAT A READER MAY SEE ON ONE SLOT ────────────────────────────────
   These rules used to live inline in `SlotCard`. They moved into `slotOccupant`
   when the zoomed-out map needed a name to draw, and the whole reason for the
   move is that TWO surfaces now answer the question — so the rules are pinned
   here rather than trusted to stay in step by inspection.

   ⛔⛔ A FAILURE IN THIS BLOCK IS A LEAK, ⛔ not a cosmetic regression: it means
   the public schedule is printing an act the organiser has not announced. */
import { slotOccupant } from './slotUtils.js';

test('a DRAFT booking does not exist for the public', () => {
  const claim = { status: 'draft', name: 'SECRET HEADLINER' };
  const pub = slotOccupant(claim, false);
  assert.equal(pub.isEmpty, true, 'a draft reads as an open slot');
  assert.equal(pub.name, '', 'and it must carry no name at all');
});

test('a DRAFT booking is visible to the host, who is editing it', () => {
  const host = slotOccupant({ status: 'draft', name: 'SECRET HEADLINER' }, true);
  assert.equal(host.isEmpty, false);
  assert.equal(host.name, 'SECRET HEADLINER');
});

test('an unconfirmed booking is PENDING, never the act', () => {
  for (const status of ['pending', 'name_added', 'declined', 'invited']) {
    const pub = slotOccupant({ status, name: 'NOT ANNOUNCED YET' }, false);
    assert.equal(pub.isEmpty, false, `${status}: the time is spoken for`);
    assert.equal(pub.name, 'PENDING', `${status}: ⛔ must not print the name`);
  }
});

test('only a CONFIRMED act is named to the public', () => {
  const pub = slotOccupant({ status: 'confirmed', name: 'LUCIOUS' }, false);
  assert.equal(pub.isEmpty, false);
  assert.equal(pub.name, 'LUCIOUS');
});

test('no claim at all is an open slot', () => {
  for (const claim of [null, undefined]) {
    assert.equal(slotOccupant(claim, false).isEmpty, true);
    /* ⚠ Open to the HOST too — an empty slot is empty for everybody. The host
       flag lifts the ANNOUNCEMENT rules, ⛔ it does not invent an occupant. */
    assert.equal(slotOccupant(claim, true).isEmpty, true);
  }
});

test('a claim with no status but a user is treated as pending, not as named', () => {
  /* ⚠ The status fallback `SlotCard` has always used. A row written without an
     explicit status must not fall through to "confirmed". */
  const pub = slotOccupant({ user_id: 'u1', name: 'INVITED ACT' }, false);
  assert.equal(pub.status, 'pending');
  assert.equal(pub.name, 'PENDING');
});
