import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { postAuthDestination } from './postAuthDestination.js';
import { START_ANSWERS } from './startAnswers.js';

/**
 * O3 · WHERE SOMEONE LANDS AFTER AUTHENTICATING — and, above all, the ORDER.
 *
 * ⭐⭐ An intent always beats the question. "If someone signs up because they
 * came from an event, don't interrupt them with a questionnaire; return them
 * to the event and complete what they came to do" (owner, 2026-08-12). These
 * tests are that sentence, executable.
 */

const src = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const code = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/[^\n]*/g, '$1');

const START = code(src('../screens/StartScreen.jsx'));
const AUTH  = code(src('../screens/AuthScreen.jsx'));

// ── the ordering ────────────────────────────────────────────────────────────

test('⭐⭐ an intent ALWAYS wins — a signup mid-journey is never interrupted', () => {
  assert.equal(
    postAuthDestination({ intentRoute: '/event/abc', wasSignup: true }),
    '/event/abc',
    'the event-origin signup must go back to its event, not to the question');
});

test('a fresh signup with no intent gets the one question', () => {
  assert.equal(postAuthDestination({ wasSignup: true }), '/start');
});

test('⛔ a SIGN-IN never gets the question — with or without an intent', () => {
  assert.equal(postAuthDestination({ wasSignup: false }), null,
    'null means "fall back to history-back", which is O1 behaviour');
  assert.equal(postAuthDestination({ intentRoute: '/profile/p1', wasSignup: false }), '/profile/p1');
});

test('called with nothing at all, it decides nothing', () => {
  assert.equal(postAuthDestination(), null);
  assert.equal(postAuthDestination({}), null);
});

// ── the wiring ──────────────────────────────────────────────────────────────

test('AuthScreen consults the intent BEFORE choosing a destination', () => {
  const resumeIdx = AUTH.indexOf('resumeIntent(session)');
  const destIdx   = AUTH.indexOf('postAuthDestination(');
  assert.ok(resumeIdx > 0 && destIdx > resumeIdx,
    'the intent must be resumed first and fed into the decision');
  assert.match(AUTH, /intentRoute:\s*resumed\?\.intent\?\.route/);
});

test('the signup flag is set only after signUp succeeded', () => {
  // If it were set before the await, a rejected signup (taken email, weak
  // password) would still send the next successful SIGN-IN to /start.
  const signUpIdx = AUTH.indexOf('auth.signUp(');
  const flagIdx   = AUTH.indexOf('signedUpRef.current = true');
  assert.ok(signUpIdx > 0 && flagIdx > signUpIdx);
  const between = AUTH.slice(signUpIdx, flagIdx);
  assert.match(between, /if\s*\(error\)\s*throw error;/,
    'the error throw must sit between the call and the flag');
});

// ── the screen's own promises ───────────────────────────────────────────────

test('⛔ it is one question, not a wizard — skip is always present', () => {
  assert.match(START, /Skip for now/);
  // A step counter or a "next" control would make it a flow.
  assert.doesNotMatch(START, /\bstep\b|\bnext\b|carousel|progress/i);
});

test('every answer routes to a surface that already exists', () => {
  // ⚠ O4 moved the answer table to lib/startAnswers so Help and the
  // post-signup screen share one copy. The guarantee is unchanged — every
  // destination is a real route — so it is read from the source of truth
  // rather than scraped out of the screen. startAnswers.test.js covers which
  // destination is chosen when.
  // ⚠ FOUR answers, not five. The "just looking around" entry was removed
  // (2026-08-12) because it navigated to '/' with replace — exactly what
  // "Skip for now" beneath the list already did.
  const tos = START_ANSWERS.flatMap(a => [a.to, a.haveTo].filter(Boolean));
  assert.deepEqual(tos, [
    '/',
    '/industry/artist/setup', '/industry/artist',
    '/industry/host/setup',   '/industry/host',
    '/industry/venue/setup',  '/industry/venue',
  ]);
});

test('⭐ nothing is stored — the profile is the record, not the claim', () => {
  // ⚠ O4 gave the screen a READ (which roles this account already holds, so a
  // role you have opens its dashboard). That is the opposite of storing the
  // answer, so the ban is on WRITES, not on touching Supabase at all — the
  // original regex banned the word and would now fail for the wrong reason.
  assert.doesNotMatch(START, /\.(insert|update|upsert)\(/,
    'the answer is a routing decision; storing it would create a second, weaker '
    + 'answer to "is this person an artist?" that drifts from the profiles table');
  assert.doesNotMatch(START, /user_prompt_preferences|localStorage\.setItem/);
  assert.match(START, /\.select\('type'\)/, 'the role read is what makes revisiting honest');
  // Role activation is the ONE thing it writes, and through the picker's own
  // exported helper rather than a second copy of the storage shape.
  assert.match(START, /activateRole\(answer\.role\)/);
  assert.match(START, /from '\.\/RoleSelectorScreen'/);
});

test('a guest who types /start is sent to browse, not shown an account screen', () => {
  assert.match(START, /if\s*\(!session\)\s*navigate\('\/',\s*\{\s*replace:\s*true\s*\}\)/);
});

test('answers replace the history entry, so BACK cannot re-ask the question', () => {
  // ⚠ Anchored on the navigate CALL up to its options object, not on a
  // balanced-paren match: the destination is now a function call of its own
  // (`navigate(startAnswerDestination(...), { replace: true })`) and a lazy
  // `[^)]*` stops at the inner bracket, reporting a violation that is not
  // there.
  const navs = [...START.matchAll(/navigate\([\s\S]*?\)(?=;|\s*\})/g)].map(m => m[0]);
  assert.ok(navs.length >= 3, `expected at least 3 navigate() calls, found ${navs.length}`);
  for (const n of navs) {
    assert.match(n, /replace:\s*true/, `"${n}" must replace — a question asked twice is a wizard`);
  }
});
