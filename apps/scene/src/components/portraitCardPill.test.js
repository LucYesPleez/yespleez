/**
 * THE PORTRAIT CARD'S TYPE PILL FITS IN 150px.
 *
 * ⛔⛔ THE BUG THIS CLOSES. The act type was ADDITIVE, so a band showed
 * `BAND / MUSO` plus every act type it had ticked. The pill row is
 * `position:absolute; right:10` with `display:flex`, no wrap, inside a card
 * with `overflow:hidden` — so the excess did not wrap, shrink, or error. It
 * CLIPPED OFF THE LEFT EDGE SILENTLY, and shipped to production that way.
 *
 * ⭐ The rule now: an act type REPLACES the type label, and only the first one
 * shows. Owner, 2026-09-05: "ive clicked band in the act type, so BAND / MUSO
 * can go, thats just the default".
 *
 * ⚠ The widths below are measured from the card's real font in a browser
 * (700 9px DM Sans, letter-spacing .8, 8px horizontal padding, 6px gap) and
 * recorded here because `node --test` has no text metrics. ⛔ They are a
 * RECORD of a measurement, not a re-measurement — if the pill styling changes,
 * re-measure rather than adjusting these to pass.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { selectedBandRoleLabels, VISIBLE_BAND_ROLES, GENRE_SEP } from '../lib/profileTaxonomy.js';

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const CARD = read('./PortraitCard.jsx');

/** Measured px for one pill, from the browser. */
const PILL = { 'BAND / MUSO': 84, SOLO: 43, DUO: 38, TRIO: 40, BAND: 44, ENSEMBLE: 69,
               'DJ / PROD.': 70, MC: 32, COMEDY: 58, POETRY: 56 };
const GAP = 6;
/** The card is 150px and the row is pinned 10px from the right edge. */
const AVAILABLE = 140;
const rowWidth = labels => labels.reduce((w, l, i) => w + PILL[l] + (i ? GAP : 0), 0);

/* ── the rule ───────────────────────────────────────────────────────────── */

test('⭐⭐ an act type REPLACES the default label, it does not join it', () => {
  assert.match(CARD, /actLabels\.length \? \[actLabels\[0\]\]/, 'first act type only');
  assert.match(CARD, /: \[label\]\)\.filter\(Boolean\)/, 'label is the fallback');
  // ⛔ the additive form must not come back
  assert.ok(!/\[label, \.\.\.actLabels\]/.test(CARD), 'additive form is gone');
});

test('⭐ a band with no act type still shows BAND / MUSO', () => {
  assert.deepEqual(selectedBandRoleLabels('Rock · Blues'), [], 'nothing selected');
  assert.ok(rowWidth(['BAND / MUSO']) <= AVAILABLE);
});

/* ── it fits, in every case the editor can now produce ──────────────────── */

test('⛔⛔ every single act type fits, which is the whole fix', () => {
  for (const { label } of VISIBLE_BAND_ROLES) {
    const w = rowWidth([label]);
    assert.ok(w <= AVAILABLE, `${label} is ${w}px of ${AVAILABLE}px`);
  }
});

test('⚠ and the additive form genuinely did NOT fit — the control', () => {
  // Without this, the test above would pass just as well if the pills were
  // one pixel wide, and would prove nothing about the bug.
  assert.ok(rowWidth(['BAND / MUSO', 'SOLO', 'DUO']) > AVAILABLE, 'two acts overflowed');
  assert.equal(rowWidth(['BAND / MUSO', 'SOLO', 'DUO']), 177);
  assert.ok(rowWidth(['BAND / MUSO', 'ENSEMBLE']) > AVAILABLE, 'ENSEMBLE overflowed');
});

test('⭐ only ONE pill can ever be produced for a band, however many are ticked', () => {
  const stored = ['solo', 'duo', 'trio', 'Rock'].join(GENRE_SEP);
  const all = selectedBandRoleLabels(stored);
  assert.equal(all.length, 3, 'the profile still knows all three');
  // the card takes the first, so its row is one pill wide
  assert.ok(rowWidth([all[0]]) <= AVAILABLE);
});

/* ── the other types are untouched ──────────────────────────────────────── */

test('⛔ artist and standup keep their multi-role pills, which already fit', () => {
  // ⚠ NOT capped: only the BAND case was named, and these were measured as
  // fitting. Capping them would be a change nobody asked for.
  assert.ok(rowWidth(['DJ / PROD.', 'MC']) <= AVAILABLE, 'DJ pair fits');
  assert.ok(rowWidth(['COMEDY', 'POETRY']) <= AVAILABLE, 'comedy pair fits');
  assert.match(CARD, /roleLabels\.length \? roleLabels/, 'their roles still render in full');
});

/* ── the profile page is deliberately different ─────────────────────────── */

test('⛔ the PROFILE HEADER stays additive — it has the room', () => {
  const PROFILE = read('../screens/ProfileScreen.jsx');
  assert.match(PROFILE, /\[label, \.\.\.actLabels\]/,
    'the header still shows BAND / MUSICIAN beside every act type');
});
