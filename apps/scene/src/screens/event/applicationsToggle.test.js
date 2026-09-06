/**
 * THE APPLICATIONS TOGGLE TELLS THE TRUTH, AND PROVES ITS WRITE.
 *
 * ⛔⛔ THE BUG. `appsOpen` was `useState(null)`, seeded from nothing and
 * written only by the toggle itself, so it was `null` on every mount. One line,
 * three wrong answers:
 *
 *   1. The menu renders `appsOpen ? 'Close' : 'Open'`, so an event with
 *      applications ALREADY OPEN offered "Open Applications" and an unlock
 *      icon — the control described the opposite of the truth.
 *   2. `!null === true`, so the first tap always wrote `true`. A host with a
 *      full lineup pressed what read as "close" and it OPENED them. There was
 *      no way to close applications from this screen at all.
 *   3. The write had no `.select()`, so an RLS-filtered UPDATE returned
 *      `error: null`, changed nothing, and the optimistic set held the false
 *      claim permanently.
 *
 * `applications_open` is the master switch on whether acts may still apply, so
 * the consequence was acts applying to a night the host believed was shut.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('./EventHostView.jsx', import.meta.url)), 'utf8');
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const CODE = stripComments(SRC);

test('⛔⛔ appsOpen is DERIVED from the event, never local state', () => {
  assert.match(CODE, /const appsOpen = event\?\.applications_open === true;/,
    'it must be read off the row');
  assert.ok(!/\[appsOpen,\s*setAppsOpen\]/.test(CODE),
    'the local copy must not come back');
  assert.ok(!/setAppsOpen\(/.test(CODE), 'nothing may set it optimistically');
});

test('⛔⛔ the write is VERIFIED — RLS filters an update, it does not error it', () => {
  const i = CODE.indexOf('async function toggleAppsOpen');
  assert.ok(i > 0);
  const fn = CODE.slice(i, CODE.indexOf('\n  }', i));
  assert.match(fn, /\.update\(\{ applications_open: next \}\)/);
  assert.match(fn, /\.select\('id'\)/, 'the select is what proves the row moved');
  assert.match(fn, /if \(error \|\| !\(data \|\| \[\]\)\.length\)/,
    'zero rows back is a failure, not a success');
  assert.match(fn, /invalidateQueries\(\{ queryKey: \['event', id\] \}\)/,
    'the refetch is the state update');
});

test('⭐ a refused toggle SAYS SO, in the banner the other host actions use', () => {
  const i = CODE.indexOf('async function toggleAppsOpen');
  const fn = CODE.slice(i, CODE.indexOf('\n  }', i));
  assert.match(fn, /setLineupError\(/, 'failure is surfaced');
  // ⚠ and the banner no longer claims every failure is a lineup change
  assert.match(SRC, /That change did not go through\. Nothing was changed\./);
  assert.ok(!/That change to the lineup did not go through/.test(SRC));
});

test('⚠ a second tap while the first is in flight is refused', () => {
  const i = CODE.indexOf('async function toggleAppsOpen');
  const fn = CODE.slice(i, CODE.indexOf('\n  }', i));
  // Without this, two taps race and the later refetch decides the outcome.
  assert.match(fn, /if \(appsBusy\) return;/);
  assert.match(fn, /setAppsBusy\(true\)/);
  assert.match(fn, /setAppsBusy\(false\)/);
});

test('⭐ the menu label follows the derived value, so it cannot lie', () => {
  assert.match(SRC, /label=\{appsOpen \? 'Close Applications' : 'Open Applications'\}/);
  assert.match(SRC, /icon=\{appsOpen \? <LockIcon \/> : <UnlockIcon \/>\}/);
});

test('⛔ the event row really does carry the column being derived', () => {
  /* The derivation is only honest if the fetch selects it. useEventData uses
     select('*'), so it does — but a narrowed select later would make appsOpen
     silently false for every event. */
  const data = readFileSync(fileURLToPath(new URL('./useEventData.js', import.meta.url)), 'utf8');
  assert.match(data, /from\('events'\)\.select\('\*'\)/,
    'a narrowed select must include applications_open');
});
