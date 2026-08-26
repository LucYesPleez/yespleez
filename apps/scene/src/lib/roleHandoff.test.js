/**
 * EXTERNAL ROLE CARDS — hand-off contract.
 *
 * The failure that matters is not "the hand-off is wrong". It is "one of the
 * two surfaces forgot to make it": the external check lived only in
 * RoleSelectorScreen's handlePick, so IndustryPanel handed the FESTIVAL card's
 * absolute URL to React Router's navigate(), which under HashRouter treats it
 * as a relative path segment. No route matched, the content area rendered
 * null, and the row was a click that did nothing. The last test asserts that
 * both consumers route picks through openExternalRole and that neither calls
 * window.open itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openExternalRole } from './roleHandoff.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

test('an internal role is not handled — and needs no window to say so', () => {
  // node has no `window`: an implementation that reached for it before the
  // external check would throw right here, not in a browser.
  assert.equal(openExternalRole({ id: 'venue', path: '/industry/venue' }), false);
  assert.equal(openExternalRole({ id: 'venue', path: '/industry/venue', external: false }), false);
  assert.equal(openExternalRole(null), false);
  assert.equal(openExternalRole(undefined), false);
});

test('an external role opens in a new tab, noopener, and reports handled', () => {
  const calls = [];
  globalThis.window = { open: (...args) => calls.push(args) };
  try {
    const handled = openExternalRole({ id: 'festival', external: true, path: 'https://portal.example' });
    assert.equal(handled, true);
    // `noopener,noreferrer` is part of the contract, not garnish: the Portal
    // is another app, and a plain _blank hands it `window.opener` back into
    // this one.
    assert.deepEqual(calls, [['https://portal.example', '_blank', 'noopener,noreferrer']]);
  } finally {
    delete globalThis.window;
  }
});

test('both surfaces hand off through this module — neither opens a tab itself', () => {
  const consumers = [
    join('screens', 'RoleSelectorScreen.jsx'),
    join('components', 'IndustryPanel.jsx'),
  ];
  for (const rel of consumers) {
    const source = readFileSync(join(SRC, rel), 'utf8');
    assert.match(source, /if \(openExternalRole\(role\)\)/,
      `${rel} picks roles without guarding through openExternalRole(), so an ` +
      'external card feeds its absolute URL to the router on that surface — ' +
      'which renders nothing and reads as a dead row.');
    assert.doesNotMatch(source, /window\.open\(/,
      `${rel} opens a tab itself. The hand-off lives in lib/roleHandoff so the ` +
      'two surfaces cannot drift on how an external role leaves the app — a ' +
      'second window.open is the drift starting again.');
  }
});
