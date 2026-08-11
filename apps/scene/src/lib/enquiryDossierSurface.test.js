import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * THE VENUE'S SIDE OF AN ENQUIRY — three findings from reading the real sheet
 * against a live host enquiry, 2026-08-11.
 *
 * ⭐⭐ THE RECIPROCAL RULE: whatever an enquiry STATES, both parties see. The
 * sender saw their ask category as a chip from the day P12 shipped; the venue —
 * the one party whose DECISION it informs — saw nothing. A fact stored on a
 * record and shown to only one side of it is the asymmetry to look for whenever
 * a new field lands.
 */

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SHEET = read('../components/EnquiryDossierSheet.jsx');

// ── The canonical card ──────────────────────────────────────────────────────

/**
 * ⛔ ONE CARD DRAWS A PROFILE. This header was the FOURTH hand-built rendering
 * in the enquiry flow and the one left behind when the other three were
 * unified (`32eb713`, 2026-08-10) — a reminder that "all three surfaces" is a
 * claim to re-count, not to trust. It had already drifted: square avatar where
 * the card draws a ringed circle, raw genre segments where the card shows
 * curated pills, and NO TYPE BADGE — so a venue could not see at a glance that
 * a HOST rather than a DJ was asking.
 */
test('the dossier header is the canonical ProfileCard', () => {
  assert.match(SHEET, /import ProfileCard from '\.\/ProfileCard'/);
  assert.match(SHEET, /<ProfileCard item=/);
});

test('the dossier no longer hand-builds an identity header', () => {
  assert.doesNotMatch(SHEET, /<ProfileAvatar/,
    'a second rendering of a profile has reappeared on this sheet');
  assert.doesNotMatch(SHEET, /genre_string\.split/,
    'the sheet is formatting genres itself instead of letting the card do it');
});

/**
 * ⛔ Not the `cover` variant — that is the event page's Presented By and
 * nothing else (owner, 2026-08-03). A header wants the compact row.
 */
test('the header uses the compact card, not the cover variant', () => {
  assert.doesNotMatch(SHEET, /<ProfileCard[^>]*cover/, 'the sheet header doubled in height');
});

// ── The ask category, on the receiving side ─────────────────────────────────

test('the venue can see what is being asked FOR', () => {
  assert.match(SHEET, /askCategoryLabel\(enq\.ask_category\)/,
    'the receiving side still cannot see the ask category it is deciding on');
  assert.match(SHEET, /ASKING FOR/);
});

/**
 * ⛔ NULL RENDERS NO ROW — never "None", never the raw key. A host asking for a
 * room has no applicable category; that is a real answer, not a gap.
 */
test('a null category renders no row at all', () => {
  assert.match(SHEET, /\{askLabel && \(\s*\n?\s*<Row label="ASKING FOR">/,
    'the row renders unconditionally — a host enquiry would show an empty label');
});

test('the label is read from the registry, never written here', () => {
  assert.doesNotMatch(SHEET, /'Music'|'Performance'|'Workshops'|'Volunteers'|'Food Vendors'/,
    'a second category vocabulary has been written into this sheet');
});

// ── MESSAGE is REPLY ────────────────────────────────────────────────────────

/**
 * ⭐ They call the SAME function and open the SAME conversation, so they must
 * carry the same weight. A hollow outline beside a filled gradient read as two
 * different kinds of action — and the quieter-looking one was the primary.
 */
test('MESSAGE and REPLY are styled as one action', () => {
  const gradients = SHEET.match(/linear-gradient\(135deg,\$\{accent\},\$\{pt\?\.accent2 \|\| accent\}\)/g) || [];
  assert.equal(gradients.length, 2,
    'MESSAGE and REPLY have drifted apart — one of them is no longer the accent gradient');
});

test('both buttons still route through the one reply path', () => {
  const handlers = SHEET.match(/onClick=\{reply\}/g) || [];
  assert.equal(handlers.length, 2,
    'MESSAGE and REPLY no longer share a handler and can now mean different things');
});
