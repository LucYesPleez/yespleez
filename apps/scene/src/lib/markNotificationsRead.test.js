/**
 * DEF-4 · A NOTIFICATION IS MARKED READ IN EXACTLY ONE PLACE — writer contract.
 *
 * The defect this guards was not "the wrong rows were marked read". It was that
 * the rule for marking read was COPIED into two components, and both copies
 * marked whatever the loader had fetched — 60 rows, of which 8 were rendered.
 * Up to 52 notifications per open were marked read having never been on screen,
 * and because the bell counts only `read = false`, none of them could ask for
 * attention again. There is no undo.
 *
 * The copies are why it survived. Each new class of row that must not be
 * touched (SEC-6a dismissed, CJ2 `in_app`, DEF-3 conversation types) had to be
 * excluded from BOTH queries by hand, and two of those exclusions carry ⚠ notes
 * in the history saying so. The fourth such row type would have had to remember
 * all over again.
 *
 * So the invariant is structural rather than behavioural: there is one writer,
 * and this test fails if a second appears. A behavioural test would need a DOM,
 * an IntersectionObserver and a clock — and would still pass happily while a
 * newly-added screen marked rows read on fetch somewhere else entirely, which
 * is the actual thing that went wrong.
 *
 * Same technique and the same reasoning as notificationReaders.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The one module allowed to write it, relative to src/. */
const CANONICAL_WRITER = join('lib', 'markNotificationsRead.js');

/**
 * Named exceptions — the form contactJoins.js's own header demands: "Do not
 * weaken the test to make it pass; give the exception a name."
 *
 * A predicate write ("every contact_joined row for this user") cannot be
 * expressed as an id list without a SELECT purely to fetch ids the query
 * already describes. It is exempt on that ground and no other: it still marks
 * read only at a moment the user demonstrably looked, and it still announces
 * via NOTIFICATIONS_READ_EVENT so the badge re-counts.
 *
 * ⚠ ADDING A NAME HERE IS A DECISION, NOT A FIX. If the new writer marks read
 * anything a loader merely fetched, it is DEF-4 again and the answer is to
 * mark on sight instead.
 */
const NAMED_EXCEPTIONS = new Map([
  [join('lib', 'contactJoins.js'),
   'markContactJoinsRead — predicate write, on FIND FRIENDS open'],
]);

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { out.push(...sourceFiles(full)); continue; }
    if (/\.(jsx?|mjs)$/.test(entry) && !/\.test\.jsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * `.update({ … read: true … })` in any form the codebase actually writes.
 *
 * Deliberately matches the OBJECT LITERAL rather than the table name: the
 * table is often several lines away up a chained builder, and `read: true` is
 * unambiguous on its own — nothing else in this app has a boolean `read`.
 */
const READ_WRITE = /\.update\(\s*\{[^{}]*\bread\s*:\s*true[^{}]*\}/g;

test('DEF-4 · only markNotificationsRead.js may write read: true', () => {
  const offenders = [];

  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    if (rel === CANONICAL_WRITER || NAMED_EXCEPTIONS.has(rel)) continue;
    const source = readFileSync(file, 'utf8');
    const hits = source.match(READ_WRITE);
    if (hits) offenders.push(`${rel} → ${hits.join(' , ')}`);
  }

  assert.deepEqual(offenders, [],
    'A second place now marks notifications read. That is the DEF-4 defect ' +
    'returning: the rule drifts between copies, and the copy that marks rows ' +
    'the user never saw silences them permanently. Import ' +
    'markNotificationsRead() instead, and mark rows because they were SEEN.');
});

test('DEF-4 · the canonical writer really does contain the write', () => {
  // Without this, the test above passes trivially the day someone renames or
  // empties the writer — zero offenders, zero writers, and a suite that reports
  // the invariant is holding while nothing marks anything read at all.
  const source = readFileSync(join(SRC, CANONICAL_WRITER), 'utf8');
  assert.match(source, READ_WRITE,
    `${CANONICAL_WRITER} no longer writes read: true — either it moved (update ` +
    'CANONICAL_WRITER) or marking read is broken.');
});

test('DEF-4 · every named exception still exists and still writes', () => {
  // An exemption for a file that no longer writes read: true is a hole left
  // open — the next writer added there inherits the exemption silently.
  for (const [rel, why] of NAMED_EXCEPTIONS) {
    const source = readFileSync(join(SRC, rel), 'utf8');
    assert.match(source, READ_WRITE,
      `${rel} is exempted from DEF-4 (${why}) but no longer writes read: true. ` +
      'Remove it from NAMED_EXCEPTIONS rather than leaving the exemption open.');
    assert.match(source, /announceNotificationsRead/,
      `${rel} marks rows read without announcing it, so the bell keeps counting ` +
      'them until the 60s poll. Call announceNotificationsRead() on success.');
  }
});

test('DEF-4 · dwell is abandoned when the tab is not in front', () => {
  // The owner's rule is that a notification is read once "visibly displayed to
  // the user". An IntersectionObserver alone cannot tell that: it keeps
  // reporting a row as intersecting after the tab goes behind another window or
  // the phone locks, so a list left open would mark itself read in a pocket.
  //
  // Asserted against the source because the alternative is a fake DOM, a fake
  // observer and a fake clock — three stubs proving each other. The property
  // that matters is that the check EXISTS; someone removing it during a
  // refactor is the realistic failure.
  const hook = readFileSync(join(SRC, 'hooks', 'useSeenNotifications.js'), 'utf8');
  assert.match(hook, /visibilityState/,
    'useSeenNotifications no longer consults document.visibilityState, so time ' +
    'on a backgrounded tab now counts as time spent reading.');
  assert.match(hook, /visibilitychange/,
    'useSeenNotifications no longer listens for visibilitychange, so dwell ' +
    'timers survive the tab being hidden.');
});
