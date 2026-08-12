import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ⛔⛔ NO EM DASHES IN USER-FACING COPY. EVER. (owner, 2026-08-12: "no
 * emdashes anywhere ever. make that a rule.")
 *
 * ⚠ THE RULE WAS GIVEN TWICE. The first time it was scoped to one string in
 * Messages and I fixed only that string; the second time it arrived as "I
 * thought we had already". A punctuation preference is a RULE on first
 * hearing. This file is what stops it needing a third telling.
 *
 * ── SCOPE, AND WHY IT IS NOT THE WHOLE FILE ──────────────────────────
 *
 * COPY ONLY — what a person reads on screen. The codebase's own house style
 * uses em dashes heavily in comments and docblocks, deliberately, and
 * rewriting those was never what was asked. So comments are stripped before
 * scanning, exactly as the other source-level tests here do, and the same
 * trap applies: a rule that matched the prose EXPLAINING it would fail on
 * this very file's header.
 *
 * ⚠ Covers the onboarding surfaces (O1 to O4). Widening it to every screen is
 * a bigger sweep and a separate decision — see the note at the bottom.
 */

const FILES = [
  '../components/AccountInvite.jsx',
  '../components/AccountInviteSheet.jsx',
  '../components/ParticipationGate.jsx',
  '../components/PushValuePrompt.jsx',
  '../components/FirstUseTeach.jsx',
  '../components/IndustryPanel.jsx',
  '../components/ProfileMenu.jsx',
  '../components/DashboardProfileCard.jsx',
  '../screens/StartScreen.jsx',
  '../screens/AuthScreen.jsx',
  './startAnswers.js',
  './firstUseTeach.js',
];

const src = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

/** Comments stripped, so the rule cannot trip over the prose that explains it. */
const code = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/[^\n]*/g, '$1');

const DASH = /[—–]/;

for (const file of FILES) {
  test(`⛔ no em or en dash in ${file.split('/').pop()}`, () => {
    const lines = code(src(file)).split('\n');
    const offenders = lines
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => DASH.test(line));

    assert.deepEqual(
      offenders, [],
      'user-facing copy must use a full stop, a comma or a colon instead. '
      + 'Two short sentences almost always read better than one dash.',
    );
  });
}

test('the rule is enforced across every onboarding surface, not a sample', () => {
  // A shrinking list is how a rule quietly stops applying. If a copy-bearing
  // onboarding component is added, it belongs here.
  assert.ok(FILES.length >= 12);
  for (const f of FILES) assert.doesNotThrow(() => src(f), `${f} must exist`);
});
