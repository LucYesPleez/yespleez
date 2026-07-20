/**
 * N1 · HELD NOTIFICATIONS MUST STAY INVISIBLE — reader contract.
 *
 * Held rows have to_user_id = NULL. Every reader filters
 * `.eq('to_user_id', <uuid>)`, and SQL equality never matches NULL, so held
 * rows cannot surface in any feed or badge. That is a real guarantee, but it
 * is an EMERGENT one: it holds only for as long as every reader keeps that
 * filter. A single future `.from('notifications').select('*')` without it
 * would expose held rows — an unclaimed venue's private enquiries — to
 * whoever ran the query, and nothing would fail loudly.
 *
 * `N5` makes that a boundary, not a nicety: held content must not be readable
 * even by Operations, only counted. So the invariant is asserted here against
 * the source itself rather than assumed.
 *
 * This is a static check by design. Testing it against a stubbed client would
 * only prove the stub filters; testing it against the live database would
 * prove today's data happens not to contain a held row. Neither catches the
 * reader added next month, which is the actual risk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

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
 * Each `.from('notifications')` call, with the chained calls that follow it.
 *
 * The chain runs to the statement's semicolon rather than a fixed number of
 * characters. A 500-char window was tried first and was wrong: adding two
 * comment lines to App.jsx's badge query pushed `.is('suppressed_at', null)`
 * past the boundary, and the test failed on correct code. The window length
 * was silently coupled to how much prose sat between the operators.
 *
 * Bounded at 2000 to fail loudly rather than swallow the file if a semicolon
 * is ever missing.
 */
function notificationQueries(source) {
  const hits = [];
  const marker = /\.from\(\s*['"]notifications['"]\s*\)/g;
  let m;
  while ((m = marker.exec(source)) !== null) {
    const end = source.indexOf(';', m.index);
    const stop = end === -1 ? m.index + 2000 : Math.min(end, m.index + 2000);
    hits.push({ index: m.index, chain: source.slice(m.index, stop) });
  }
  return hits;
}

test('every notifications READ filters on to_user_id, so held rows stay invisible', () => {
  const offenders = [];

  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const { chain } of notificationQueries(source)) {
      const isRead = /\.select\(/.test(chain);
      const isWrite = /\.(insert|upsert|update|delete)\(/.test(chain);
      if (!isRead || isWrite) continue;          // writes and updates are not feeds

      if (!/\.eq\(\s*['"]to_user_id['"]/.test(chain)) {
        offenders.push(relative(SRC, file));
      }
    }
  }

  assert.deepEqual(
    offenders, [],
    'These read notifications without scoping to a delivery identity, which would ' +
    'expose held rows belonging to unclaimed profiles (N1/N5):\n  ' + offenders.join('\n  '),
  );
});

test('every notifications READ excludes suppressed rows (NP1)', () => {
  // Preferences govern delivery, never existence: a muted notification is
  // written and retained, and withheld only from the feed. That withholding is
  // entirely a reader-side filter — the row is indistinguishable from a
  // delivered one except for suppressed_at. A reader that forgets it shows the
  // user precisely what they asked not to see, and the mute switch appears
  // broken rather than the query.
  const offenders = [];

  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const { chain } of notificationQueries(source)) {
      const isRead = /\.select\(/.test(chain);
      const isWrite = /\.(insert|upsert|update|delete)\(/.test(chain);
      if (!isRead || isWrite) continue;

      if (!/\.is\(\s*['"]suppressed_at['"]\s*,\s*null\s*\)/.test(chain)) {
        offenders.push(relative(SRC, file));
      }
    }
  }

  assert.deepEqual(
    offenders, [],
    'These read notifications without excluding suppressed rows, so muted ' +
    'categories would still appear in the feed (NP1):\n  ' + offenders.join('\n  '),
  );
});

test('the reader contract test can actually see the readers', () => {
  // Guards the check above against silently passing because the walk found
  // nothing — a green test that asserts over an empty set proves nothing.
  const reads = sourceFiles(SRC)
    .flatMap(f => notificationQueries(readFileSync(f, 'utf8')))
    .filter(({ chain }) => /\.select\(/.test(chain) && !/\.(insert|upsert|update|delete)\(/.test(chain));

  assert.ok(reads.length >= 3, `expected to find the known notification readers, found ${reads.length}`);
});
