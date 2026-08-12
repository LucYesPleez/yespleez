import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { START_ANSWERS, startAnswerDestination, startAnswerDesc } from './startAnswers.js';

/**
 * O4 · THE ROLE QUESTION, REVISITED FROM HELP.
 *
 * ⭐⭐ "used to add/activate additional roles without replacing existing
 * roles" (owner, 2026-08-12). These tests are that sentence: a role you hold
 * opens what you built, a role you do not hold offers to build it, and
 * choosing either one never takes anything away.
 */

const src = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const code = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/[^\n]*/g, '$1');

const START  = code(src('../screens/StartScreen.jsx'));
const HEADER = code(src('../components/GlobalHeader.jsx'));
const MENU   = code(src('../components/ProfileMenu.jsx'));
const ROLES  = code(src('../screens/RoleSelectorScreen.jsx'));

const answer = key => START_ANSWERS.find(a => a.key === key);

// ── a role you do not have: set it up ───────────────────────────────────────

test('with nothing set up, every role answer offers its setup form', () => {
  for (const key of ['artist', 'host', 'venue']) {
    assert.equal(startAnswerDestination(answer(key), []), `/industry/${key}/setup`);
    // ⚠ Asserts that the first-time line DIFFERS from the already-have line,
    // not that it opens with any particular verb. It used to pin /^Set up/,
    // which broke the moment the copy was rewritten ("Build your profile and
    // find opportunities") even though the behaviour was untouched. The
    // guarantee is that the two states do not say the same thing.
    const first = startAnswerDesc(answer(key), []);
    assert.equal(first, answer(key).desc);
    assert.notEqual(first, answer(key).haveDesc);
  }
});

// ── a role you already have: open it, never re-offer it ─────────────────────

test('⭐⭐ a role already set up opens its DASHBOARD, not its setup form', () => {
  assert.equal(startAnswerDestination(answer('artist'), ['artist']), '/industry/artist');
  assert.equal(startAnswerDestination(answer('host'),   ['host']),   '/industry/host');
  assert.equal(startAnswerDestination(answer('venue'),  ['venue']),  '/industry/venue');
});

test('its description changes with it, and names what is already there', () => {
  assert.match(startAnswerDesc(answer('artist'), ['artist']), /Open your artist dashboard/);
  assert.notEqual(startAnswerDesc(answer('artist'), ['artist']), answer('artist').desc);
});

test('holding one role does not change the others', () => {
  const have = ['artist'];
  assert.equal(startAnswerDestination(answer('host'),  have), '/industry/host/setup');
  assert.equal(startAnswerDestination(answer('venue'), have), '/industry/venue/setup');
  assert.equal(startAnswerDesc(answer('host'), have), answer('host').desc,
    'a role you do not hold still reads as its first-time invitation');
});

test('a Set is accepted as readily as an array — the screen holds a Set', () => {
  assert.equal(startAnswerDestination(answer('artist'), new Set(['artist'])), '/industry/artist');
});

test('the role-less answer is unaffected by what you hold', () => {
  // ⚠ `browse` alone. There is no second role-less answer: "just looking
  // around" was removed once it turned out to do exactly what Skip does.
  assert.equal(startAnswerDestination(answer('browse'), []), '/');
  assert.equal(startAnswerDestination(answer('browse'), ['artist', 'host', 'venue']), '/');
});

test('⛔ no answer duplicates what "Skip for now" already does', () => {
  // Skip navigates to '/' with replace. An ANSWER whose only effect is the
  // same navigation is a second control for one behaviour, which is what
  // removing the fifth card fixed. `browse` is exempt: it replies first.
  const plainNavigators = START_ANSWERS.filter(a => a.to === '/' && !a.role);
  assert.deepEqual(plainNavigators.map(a => a.key), ['browse'],
    'a role-less answer that only navigates to / must justify itself against Skip');
});

test('a malformed answer degrades to browsing rather than throwing', () => {
  assert.equal(startAnswerDestination(undefined, []), '/');
  assert.equal(startAnswerDestination({}, ['artist']), '/');
  assert.equal(startAnswerDesc(undefined, []), '');
});

// ── nothing is ever removed ─────────────────────────────────────────────────

test('⛔ choosing a role ACTIVATES it and never deactivates another', () => {
  assert.match(START, /activateRole\(answer\.role\)/);
  // activateRole is append-only at its source — the one writer of the list.
  assert.match(ROLES, /function activateRole[\s\S]*?\[\.\.\.current, id\]/,
    'activateRole must append; a role picker that swaps would drop the other roles');
  assert.doesNotMatch(START, /removeRole|deactivate|setActiveRoles|localStorage\.setItem/);
});

test('the screen routes through the shared decision, not its own copy', () => {
  assert.match(START, /startAnswerDestination\(answer, haveTypes\)/);
  assert.doesNotMatch(START, /const ANSWERS = \[/,
    'the answer table moved to lib/startAnswers — two copies would drift');
});

// ── the Help entry point ────────────────────────────────────────────────────

test('the identity menu offers the question, under HOW IT ALL WORKS', () => {
  // ⚠ MOVED (owner, 2026-08-12). This lived in the ⓘ info sheet until the
  // three "explain this app" actions were gathered under one heading at the
  // top of the identity menu. The sheet now explains only the current SCREEN.
  // ⚠ Anchored INSIDE the learnItems array, not on file order: the array is
  // declared above the JSX that renders the heading, so an index comparison
  // reports the reverse of the on-screen grouping.
  const from = MENU.indexOf('const learnItems = [');
  const group = MENU.slice(from, MENU.indexOf('];', from));
  assert.ok(from > 0, 'the HOW IT ALL WORKS group must exist');
  assert.match(group, /go\('\/start'\)/, 'the role question belongs in that group');
  assert.match(group, /startTour\(\)/, 'so does the tour');
  assert.match(MENU, /<div className=\{s\.sectionLabel\}>HOW IT ALL WORKS<\/div>/,
    'and the group must actually render its heading');
  // `go` closes the menu before navigating — a portalled menu left open would
  // sit over the screen it just sent you to.
  assert.match(MENU, /const go = \(path, state\) => \{ setOpen\(false\);/);
  assert.doesNotMatch(HEADER, /navigate\('\/start'\)/,
    'one control, one home — it must not also remain in the info sheet');
});

test('⛔ a guest gets SIGN IN instead of the menu, so /start is never offered to one', () => {
  // /start bounces a guest to What's On, so the entry point must be
  // unreachable rather than merely harmless. The signed-out branch returns
  // the header's SIGN IN control and never reaches the menu below it.
  const guard = MENU.indexOf('if (!session) {');
  const menuRender = MENU.indexOf('learnItems.map');
  assert.ok(guard > 0 && guard < menuRender,
    'the signed-out return must come before anything that renders the group');
  assert.match(MENU.slice(guard, guard + 600), /navigate\('\/auth'\)/);
});
