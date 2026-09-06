/**
 * A SUBURB NAME IS NOT UNIQUE IN AUSTRALIA.
 *
 * ⛔⛔ THE BUG. `SUBURB_MAP` had 22 duplicate keys. In JavaScript a later key
 * silently overwrites an earlier one, so twenty suburb names resolved to the
 * WRONG STATE and the first one was unreachable:
 *
 *   newtown     2042 Sydney   →  6021 Western Australia
 *   glebe       2037 Sydney   →  7000 Hobart
 *   paddington  2021 Sydney   →  4064 Brisbane
 *   st peters   2044 Sydney   →  5069 Adelaide
 *
 * The table was written Sydney-first and every later state overwrote it, so
 * the failure landed hardest on the inner-Sydney suburbs the app's own users
 * are in. Nothing errored; the filter just quietly searched the wrong state.
 *
 * ⭐ The fix is not picking a winner. The values are merged, the ambiguity is
 * surfaced in the suggestion list one entry per state, and the user answers it
 * (owner, 2026-09-06: "if theres more than one town it could be, just ask for
 * clarification so that doesnt happen").
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SUBURB_MAP, locationOptions, isAmbiguousLocation,
  resolveLocationToPostcodes, suggestLocations,
} from './auLocations.js';
/* ⛔ FROM `geo`, NOT from auLocations. A duplicate postcode→state table was
   briefly added here and removed; importing the real one is what keeps the
   two from drifting back apart. */
import { postcodeState as stateForPostcode } from './geo.js';

const SRC = readFileSync(fileURLToPath(new URL('./auLocations.js', import.meta.url)), 'utf8');

/* ── the data itself ─────────────────────────────────────────────────────── */

test('⛔⛔ no key is declared twice — a duplicate silently wins', () => {
  const declared = [...SRC.matchAll(/"([^"]+)"\s*:\s*\[/g)].map(m => m[1]);
  const seen = new Set(), dupes = [];
  for (const k of declared) { if (seen.has(k)) dupes.push(k); seen.add(k); }
  assert.deepEqual(dupes, [], 'duplicate keys are back');
  assert.equal(declared.length, Object.keys(SUBURB_MAP).length,
    'every declared key survives into the object');
});

test('⛔⛔ the postcodes that were being lost are all present', () => {
  // Each of these had its Sydney value overwritten by a later state.
  assert.ok(SUBURB_MAP['newtown'].includes('2042'), 'Newtown NSW');
  assert.ok(SUBURB_MAP['glebe'].includes('2037'), 'Glebe NSW');
  assert.ok(SUBURB_MAP['paddington'].includes('2021'), 'Paddington NSW');
  assert.ok(SUBURB_MAP['st peters'].includes('2044'), 'St Peters NSW');
  assert.ok(SUBURB_MAP['richmond'].includes('2753'), 'Richmond NSW');
  // and the ones that overwrote them are still there too — nothing traded
  assert.ok(SUBURB_MAP['newtown'].includes('6021'), 'Newtown WA');
  assert.ok(SUBURB_MAP['glebe'].includes('7000'), 'Glebe TAS');
});

test('⛔ no stray control characters — the file was corrupted once', () => {
  /* A shell-escaped edit put a literal backspace byte inside `/\b\w/g`, which
     turned the word-boundary into a control character. It still parsed, and
     silently stopped title-casing. Nothing but a byte check catches that. */
  const bad = [...SRC].filter(c => c.charCodeAt(0) < 32 && !'\n\r\t'.includes(c));
  assert.equal(bad.length, 0, 'control characters in the source');
});

/* ── state from postcode, with no second table to drift ──────────────────── */

test('⭐ the state comes from the postcode number itself', () => {
  assert.equal(stateForPostcode('2042'), 'NSW');
  assert.equal(stateForPostcode('3220'), 'VIC');
  assert.equal(stateForPostcode('6021'), 'WA');
  assert.equal(stateForPostcode('7000'), 'TAS');
  assert.equal(stateForPostcode('5069'), 'SA');
  assert.equal(stateForPostcode('4064'), 'QLD');
  assert.equal(stateForPostcode('0850'), 'NT');
});

test('⚠ the awkward ranges are handled, because they are the ones that bite', () => {
  // ACT sits INSIDE the NSW block.
  assert.equal(stateForPostcode('2600'), 'ACT');
  assert.equal(stateForPostcode('2599'), 'NSW');
  assert.equal(stateForPostcode('2619'), 'NSW');
  // VIC and QLD each own a second high block.
  assert.equal(stateForPostcode('8000'), 'VIC');
  assert.equal(stateForPostcode('9000'), 'QLD');
  // and nonsense is empty, never a guess
  assert.equal(stateForPostcode(''), '');
  assert.equal(stateForPostcode('abcd'), '');
});

/* ── the disambiguation ──────────────────────────────────────────────────── */

test('⭐⭐ an ambiguous name offers one choice per state', () => {
  const opts = locationOptions('newtown');
  assert.deepEqual(opts.map(o => o.label), ['Newtown, NSW', 'Newtown, VIC', 'Newtown, WA']);
  assert.deepEqual(opts.find(o => o.state === 'NSW').postcodes, ['2042']);
  assert.ok(isAmbiguousLocation('newtown'));
});

test('⛔ an unambiguous name is never qualified', () => {
  // Appending a state to everything would make the common case noisier to fix
  // the rare one.
  assert.equal(isAmbiguousLocation('bellingen'), false);
  assert.deepEqual(suggestLocations('bellin'), ['Bellingen']);
});

test('⭐⭐ picking a qualified name resolves to THAT state alone', () => {
  assert.deepEqual(resolveLocationToPostcodes('Newtown, NSW'), ['2042']);
  assert.deepEqual(resolveLocationToPostcodes('Newtown, WA'), ['6021']);
  assert.deepEqual(resolveLocationToPostcodes('St Peters, SA'), ['5069']);
});

test('⚠ a bare ambiguous name returns EVERY option, never one at random', () => {
  /* Before, this returned whichever the last duplicate happened to be. Broad
     is honest; arbitrary is not. */
  assert.deepEqual(resolveLocationToPostcodes('newtown').sort(), ['2042', '3220', '6021']);
});

test('⭐ the suggestion list is what does the asking', () => {
  const out = suggestLocations('newt');
  assert.ok(out.includes('Newtown, NSW'));
  assert.ok(out.includes('Newtown, VIC'));
  assert.ok(out.includes('Newtown, WA'));
  assert.ok(out.length <= 8, 'still capped');
});

test('⛔ a plain postcode is untouched by any of this', () => {
  assert.deepEqual(resolveLocationToPostcodes('2042'), ['2042']);
  assert.deepEqual(resolveLocationToPostcodes(''), []);
});

/* ── what gets STORED ────────────────────────────────────────────────────── */

test('⚠⚠ the qualifier is stripped before it is stored', async () => {
  const { plainLocationName } = await import('./auLocations.js');
  // "Newtown, NSW" in `suburb` beside `state: 'NSW'` renders "Newtown, NSW, NSW"
  // through formatLocation. The suffix answers a question; it is not the name.
  assert.equal(plainLocationName('Newtown, NSW'), 'Newtown');
  assert.equal(plainLocationName('St Peters, SA'), 'St Peters');
  // ⛔ and an unqualified name is returned untouched
  assert.equal(plainLocationName('Bellingen'), 'Bellingen');
  assert.equal(plainLocationName('Coffs Harbour'), 'Coffs Harbour');
  // ⛔ only a REAL state code is stripped
  assert.equal(plainLocationName('Sandy Bay, ZZZ'), 'Sandy Bay, ZZZ');
});

test('⛔ the identity screen stores the plain name, not what was typed', () => {
  const src = readFileSync(fileURLToPath(new URL('../screens/MessengerIdentityScreen.jsx', import.meta.url)), 'utf8');
  assert.match(src, /suburb = plainLocationName\(typed\)/);
  assert.match(src, /if \(isAmbiguousLocation\(typed\)\) \{/, 'and it asks before guessing');
});

/* ── all three serve each other ──────────────────────────────────────────── */

test('⭐⭐ postcode → town, the direction that did not exist', async () => {
  const { townsForPostcode } = await import('./auLocations.js');
  // ⚠ A postcode is ambiguous in the OTHER direction: one code, several towns.
  assert.deepEqual(townsForPostcode('2042'), ['Enmore', 'Newtown']);
  assert.deepEqual(townsForPostcode('2037'), ['Forest Lodge', 'Glebe']);
  assert.deepEqual(townsForPostcode('2454'), ['Bellingen']);
  assert.deepEqual(townsForPostcode('0000'), []);
});

test('⭐⭐ resolvePlace completes the triple from any corner', async () => {
  const { resolvePlace } = await import('./auLocations.js');
  const trip = r => [r.suburb, r.postcode, r.state];
  // from a postcode
  assert.deepEqual(trip(resolvePlace('2454')), ['Bellingen', '2454', 'NSW']);
  // from a name
  assert.deepEqual(trip(resolvePlace('Bellingen')), ['Bellingen', '2454', 'NSW']);
  // from a qualified name
  assert.deepEqual(trip(resolvePlace('Newtown, NSW')), ['Newtown', '2042', 'NSW']);
});

test('⛔⛔ when it cannot tell, it returns NOTHING rather than a guess', async () => {
  const { resolvePlace } = await import('./auLocations.js');
  /* The original bug was a confident wrong answer. A blank is recoverable;
     a silent mistake is not. So suburb and postcode stay empty and the
     choices go in `options`. */
  const byName = resolvePlace('Newtown');
  assert.equal(byName.ambiguous, true);
  assert.equal(byName.suburb, '');
  assert.equal(byName.postcode, '');
  assert.deepEqual(byName.options.map(o => o.label), ['Newtown, NSW', 'Newtown, VIC', 'Newtown, WA']);

  // A postcode is ambiguous in town but never in state, so the state survives.
  const byCode = resolvePlace('2042');
  assert.equal(byCode.ambiguous, true);
  assert.equal(byCode.suburb, '');
  assert.equal(byCode.postcode, '2042', 'the postcode is known even when the town is not');
  assert.equal(byCode.state, 'NSW', 'and so is the state');
});

test('⛔ there is only ONE postcode-to-state answer in the codebase', () => {
  /* A second table was written here and deleted the same day: it agreed on
     every real suburb and differed on four PO-box ranges, which is exactly how
     two screens end up disagreeing about where somebody lives months later. */
  assert.ok(!/POSTCODE_RANGES/.test(SRC), 'a local range table is back');
  assert.match(SRC, /import \{ postcodeState \} from '\.\/geo'/);
});
