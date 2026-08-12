import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { autoTourSuppressed } from './tourState.js';

/**
 * ⭐⭐ A QR SCAN LANDS ON THE EVENT, NOT ON A TOUR (owner, 2026-08-12).
 *
 *     QR → Event → Explore → Intent → ParticipationGate      ⭐ ratified
 *     QR → Event → Tour → Event → Intent                     ⛔ regression
 *
 * ⚠ AND THE TOUR IS SUPPRESSED, NOT SPENT. Someone who arrived on one event
 * has not been onboarded; marking the tour done would silently retire it for
 * a person who saw a single page. These tests hold both halves.
 */

const src = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const code = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/[^\n]*/g, '$1');

const HEADER = code(src('../components/GlobalHeader.jsx'));
const STATE  = code(src('./tourState.js'));

// ── the predicate ───────────────────────────────────────────────────────────

test('arriving on an event or a profile suppresses the automatic tour', () => {
  assert.equal(autoTourSuppressed('/event/12fa6307-e066-43f5-81c4-40681455d6b0'), true);
  assert.equal(autoTourSuppressed('/profile/8a1c'), true);
  // Deeper paths under a resource are still that resource.
  assert.equal(autoTourSuppressed('/event/abc/applications'), true);
});

test('⛔ the browsing surfaces still offer it — that is where onboarding belongs', () => {
  for (const path of ['/', '/discover', '/my-scene', '/messages', '/auth']) {
    assert.equal(autoTourSuppressed(path), false,
      `${path} is a surface, not a deep link — the tour's steps point at exactly these`);
  }
  // A bare collection path is not an individual resource.
  assert.equal(autoTourSuppressed('/event'), false);
});

test('a missing or malformed landing path never suppresses', () => {
  assert.equal(autoTourSuppressed(undefined), false);
  assert.equal(autoTourSuppressed(null), false);
  assert.equal(autoTourSuppressed(''), false);
});

// ── the wiring ──────────────────────────────────────────────────────────────

test('the welcome timer is guarded by the landing path, captured as a ref', () => {
  assert.match(HEADER, /const landingPathRef = useRef\(location\.pathname\)/,
    'the landing path must be the FIRST route of the session, not the current one');
  assert.match(HEADER, /if\s*\(autoTourSuppressed\(landingPathRef\.current\)\)\s*return undefined;[\s\S]{0,120}setWelcome\(true\)/,
    'the suppression must guard the automatic welcome timer');
});

test('⛔ suppression must NEVER spend the done flag', () => {
  // finishTour is the flag write. It may appear only on the tour's own exits
  // (accept/decline), never anywhere near the deep-link guard.
  const guardIdx = HEADER.search(/autoTourSuppressed/);
  const window120 = HEADER.slice(guardIdx, guardIdx + 400);
  assert.doesNotMatch(window120, /finishTour|setDone\(true\)/,
    'a deep-link arrival must not mark onboarding complete — the tour is owed to them later');
});

test('the explicit entry point is untouched — TAKE THE TOUR still works', () => {
  assert.match(HEADER, /onTourStart\(/, 'the ⓘ sheet\'s replay subscription must survive');
  assert.match(STATE, /export function startTour/);
  // The replay path opens the tour directly and never consults the landing
  // path — asking for the tour is not an arrival.
  // ⚠ Scoped to startTour's OWN body: slicing to end-of-file swept up
  // autoTourSuppressed's own declaration further down and failed on it.
  const from = STATE.indexOf('export function startTour');
  const body = STATE.slice(from, STATE.indexOf('export', from + 10));
  assert.ok(from >= 0 && body.length > 0);
  assert.doesNotMatch(body, /autoTourSuppressed/);
});
