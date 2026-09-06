/**
 * THE EARLY RETURN IS WHAT MAKES THE SIDE EFFECTS UNREACHABLE.
 *
 * ⚠⚠ WHY THIS TEST IS STRUCTURAL AND THE OTHERS ARE NOT. The write and the
 * notification moved into `lib/respondToOffer` and `lib/respondToApplication`,
 * where `respondToOffer.test.js` and `respondToApplication.test.js` drive the
 * real functions and assert real behaviour. But two side effects stayed in the
 * screens, because they ARE screen concerns: the analytics event and the local
 * state update. This repo has no render harness, so the only way to pin those
 * is the ordering of the code around them — which is exactly what
 * `applicationsToggle.test.js` does for the host toggle.
 *
 * ⛔ It proves ORDER, ⛔ not that a component renders. Kept to that one claim
 * deliberately: a source-text test that tried to assert behaviour would be
 * asserting a string, and a green suite over a file that will not even compile
 * is a lesson this repo has already had.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const APPS  = stripComments(read('../screens/ApplicationsScreen.jsx'));
const DASH  = stripComments(read('../screens/ArtistDashboard.jsx'));

/** The body of `function <name>(…) { … }` up to its closing brace column. */
function body(code, name) {
  const i = code.indexOf(`async function ${name}`);
  assert.ok(i > 0, `${name} not found`);
  const end = code.indexOf('\n  }', i);
  assert.ok(end > i, `${name} has no closing brace at function depth`);
  return code.slice(i, end);
}

test('⛔⛔ ApplicationsScreen: analytics and the row move sit AFTER the guard', () => {
  const fn = body(APPS, 'respond');
  const guard = fn.indexOf('if (!res.ok)');
  const track = fn.indexOf('track(EVENTS.APPLICATION_ACCEPTED');
  const move  = fn.indexOf('setApps(prev');
  assert.ok(guard > 0, 'the refusal guard must exist');
  assert.ok(track > guard, 'a refused decision must not be trackable as an accept');
  assert.ok(move  > guard, 'a refused decision must not move the row on screen');
  assert.match(fn.slice(guard, track), /return;/,
    'the guard must RETURN, not merely branch around the message');
});

test('⛔ ApplicationsScreen: the screen no longer writes or notifies itself', () => {
  const fn = body(APPS, 'respond');
  assert.match(fn, /respondToApplication\(/, 'the verified write is the module\'s');
  assert.ok(!/supabase\s*$|\.update\(/.test(fn), 'no raw update may come back here');
  assert.ok(!/writeNotification\(/.test(fn), 'and no notification may be sent beside it');
});

test('⛔⛔ ArtistDashboard: the card only moves after the write is confirmed', () => {
  const fn = body(DASH, 'handleOfferRespond');
  const guard = fn.indexOf('if (!res.ok)');
  const move  = fn.indexOf('updateOffer(id');
  assert.ok(guard > 0);
  assert.ok(move > guard, 'a refused invite response must not flip the card');
  assert.match(fn.slice(guard, move), /return;/);
});

test('⛔ ArtistDashboard: no application insert survives in the screen', () => {
  /* ⚠⚠ THE ORPHAN. This screen used to insert the `applications` row itself,
     BEFORE the verified update, so a refusal left it behind. The ordering that
     fixes it lives in lib/respondToOffer — so the insert must not exist here at
     all, or there would be two orders to keep in step. */
  assert.ok(!/from\('applications'\)\s*\.insert/.test(DASH),
    'the insert belongs to respondToOffer, which runs it only after the update lands');
});

test('⭐ both screens surface the refusal, rather than failing silently', () => {
  assert.match(body(APPS, 'respond'), /setRespondError\(/);
  assert.match(body(DASH, 'handleOfferRespond'), /setOfferError\(/);
  // and the banners really are rendered, not just set
  assert.match(APPS, /respondError &&/);
  assert.match(DASH, /offerError &&/);
});
