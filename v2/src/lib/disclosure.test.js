/**
 * N2 · DISCLOSURE — copy constraints and call-site coverage.
 *
 * Two things drift here, and both are invisible in review:
 *
 * 1. THE WORDING. The owner's constraint is that disclosure must not expose
 *    internal concepts — no "held", no queue states, no database behaviour —
 *    and must read as normal UX rather than a warning. That is a property of
 *    strings, so it is checked against the strings. The failure mode is
 *    someone "clarifying" the copy into accuracy: *"your notification will be
 *    held until the profile is claimed"* is true, and is exactly what N2
 *    forbids a user from having to understand.
 *
 * 2. THE COVERAGE. A new action against an unclaimed profile silently ships
 *    with no disclosure. Nothing errors — the user simply is not told. The
 *    interaction map (docs/phase-13-n2-disclosure-interaction-map-2026-07.md)
 *    lists every reachable site; this asserts each one is wired.
 *
 * These are source-text assertions because the components are JSX, which
 * `node --test` cannot parse without a transform, and adding one would mean a
 * dependency this suite deliberately does not have.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC      = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOTICE   = join(SRC, 'components/UnclaimedNotice.jsx');

/** Extract the user-facing strings from the COPY map. */
function copyStrings() {
  const src = readFileSync(NOTICE, 'utf8');
  const block = src.slice(src.indexOf('const COPY = {'), src.indexOf('};', src.indexOf('const COPY = {')));
  return [...block.matchAll(/^\s{2}\w+:\s*(["'])((?:\\.|(?!\1).)*)\1/gm)].map(m => m[2]);
}

/**
 * Words that describe the SYSTEM rather than the situation. Each would be
 * accurate and each is forbidden: the user has no model of notifications
 * being held in a queue, and does not need one to make the choice §2 asks of
 * them.
 */
const INTERNAL_CONCEPTS = [
  'held', 'hold', 'queue', 'queued', 'pending', 'unclaimed',
  'notification', 'database', 'record', 'row', 'deliver', 'delivery',
  'expire', 'expiry', 'profile_id', 'claim status',
];

test('disclosure copy exposes no internal concepts', () => {
  const offenders = [];
  for (const copy of copyStrings()) {
    for (const word of INTERNAL_CONCEPTS) {
      if (new RegExp(`\\b${word}\\b`, 'i').test(copy)) {
        offenders.push(`"${word}" in: ${copy}`);
      }
    }
  }

  assert.deepEqual(
    offenders, [],
    'N2 disclosure must not expose internal concepts — say what happens to the ' +
    'PERSON, not what the system does:\n  ' + offenders.join('\n  '),
  );
});

test('disclosure copy reads as reassurance, not warning', () => {
  for (const copy of copyStrings()) {
    assert.ok(!/[A-Z]{4,}/.test(copy), `shouty copy reads as an alert: ${copy}`);
    assert.ok(!/[!⚠]/.test(copy), `alarm punctuation reads as an error: ${copy}`);
    assert.ok(copy.length <= 160, `too long to read at the point of acting: ${copy}`);
    assert.ok(/^[A-Z]/.test(copy) && /[.]$/.test(copy), `should be a plain sentence: ${copy}`);
  }
});

test('the copy parser actually found the copy', () => {
  // Both assertions above pass vacuously over an empty list.
  const copy = copyStrings();
  assert.ok(copy.length >= 3, `expected the COPY map, parsed ${copy.length} entries`);
});

/**
 * Every interaction the map found reachable against an unclaimed target.
 * `done: false` entries are scoped and not yet wired — they are listed so the
 * remaining work is visible in the suite rather than only in a document.
 */
const REQUIRED_SITES = [
  { file: 'screens/ProfileScreen.jsx',      context: 'follow', done: true,  note: 'Follow — the only action reachable today that holds a notification' },
  { file: 'screens/EventScreen.jsx',        context: 'apply',  done: false, note: 'APPLY TO PLAY — needs the event owner profile row loaded first' },
  { file: 'screens/EventScreen.jsx',        context: 'follow', done: false, note: 'lineup follow — needs a canonical profiles row, not the synthetic claim object' },
  { file: 'components/FillSlotModal.jsx',   context: 'slot',   done: false, note: 'host adds an unclaimed performer to a slot' },
];

test('every wired disclosure site renders UnclaimedNotice', () => {
  for (const site of REQUIRED_SITES.filter(s => s.done)) {
    const src = readFileSync(join(SRC, site.file), 'utf8');
    assert.match(src, /import UnclaimedNotice from/, `${site.file} must import UnclaimedNotice`);
    assert.match(
      src, new RegExp(`<UnclaimedNotice[^>]*context=["']${site.context}["']`),
      `${site.file} must render UnclaimedNotice with context="${site.context}" — ${site.note}`,
    );
  }
});

test('every context used by a call site exists in COPY', () => {
  const src = readFileSync(NOTICE, 'utf8');
  const declared = new Set(
    [...src.slice(src.indexOf('const COPY = {')).matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]),
  );
  for (const site of REQUIRED_SITES) {
    assert.ok(declared.has(site.context),
      `context "${site.context}" is used by ${site.file} but has no entry in COPY`);
  }
});
