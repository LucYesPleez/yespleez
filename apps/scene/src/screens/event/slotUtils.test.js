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
