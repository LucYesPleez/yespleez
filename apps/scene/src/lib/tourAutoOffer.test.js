import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ⭐⭐ THE TOUR IS NEVER OFFERED AUTOMATICALLY (owner, 2026-08-12: "remove the
 * tour from the start up routine").
 *
 * ⚠ THIS REPLACES tourDeepLink.test.js, WHICH TESTED TWO GUARDS THAT NO
 * LONGER EXIST. Those guards stopped the automatic welcome card landing on a
 * QR arrival's event page, and later on the sign-in form and the role
 * question. Both were correct defences against a wrong default. Removing the
 * default removes the need for either — and this file is the stronger
 * statement: not "the card must not land there", but "the card does not
 * arrive at all".
 *
 * ⛔ If an automatic offer is ever reintroduced, those two guards must come
 * back with it. The QR case was a real, measured regression, not a
 * hypothetical.
 */

const src = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const code = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/[^\n]*/g, '$1');

const HEADER  = code(src('../components/GlobalHeader.jsx'));
const MENU    = code(src('../components/ProfileMenu.jsx'));
const INSTALL = code(src('../components/InstallButton.jsx'));
const STATE   = code(src('./tourState.js'));

// ── it does not arrive on its own ───────────────────────────────────────────

test('⛔ nothing schedules the welcome card — no timer, no auto-open', () => {
  assert.doesNotMatch(HEADER, /setWelcome/,
    'the welcome state is gone; a timer setting it is the regression this file exists for');
  assert.doesNotMatch(HEADER, /<TourWelcome/,
    'the welcome card must not render from the header at all');
});

test('⛔ the header no longer imports the welcome card or the spent-flag helpers', () => {
  assert.doesNotMatch(HEADER, /import TourWelcome/);
  assert.doesNotMatch(HEADER, /\bfinishTour\b/,
    'nothing spends the flag on the way past an offer that no longer happens');
});

test('the ONLY way in is an explicit request', () => {
  // onTourStart is the subscription; startTour is the caller, and it now
  // lives in the identity menu rather than two taps inside the info sheet.
  assert.match(HEADER, /onTourStart\(/);
  assert.match(MENU, /startTour\(\)/);
  // ⚠ Sentence case, and it is a menu ITEM rather than a heading — the three
  // actions expand from it instead of standing permanently above the list.
  assert.match(MENU, /label: 'How it all works'/);
  assert.match(MENU, /TAKE THE TOUR/);
});

test('⛔ the dead guards are gone rather than left to read as live rules', () => {
  for (const name of ['autoTourSuppressed', 'tourWelcomeBlocked']) {
    assert.doesNotMatch(STATE, new RegExp(`export function ${name}`),
      `${name} guarded an automatic offer that no longer exists`);
    assert.doesNotMatch(HEADER, new RegExp(`${name}\\(`));
  }
});

// ── the handover the removal could have broken ──────────────────────────────

test('⚠⚠ the install spotlight no longer waits for a tour that never runs', () => {
  // It was gated on the tour finishing so two overlays could not stack. With
  // no automatic tour, a false start would mean install coaching silently
  // never appearing for anyone new — the exact failure this asserts against.
  assert.match(INSTALL, /useState\(true\)/,
    'tourDone must start true: there is nothing to wait for');
  assert.doesNotMatch(INSTALL, /useState\(tourFinished\)/);
  // The subscription stays, so a deliberately-started tour still defers it.
  assert.match(INSTALL, /onTourFinished\(/);
});
