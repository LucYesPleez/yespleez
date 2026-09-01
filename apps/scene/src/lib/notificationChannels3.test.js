/**
 * THE CHANNEL CHIPS — what they say, and what they must never do.
 *
 * ⚠⚠ TWO KINDS OF TEST IN HERE, AND THE DIFFERENCE MATTERS. The first block
 * calls the real `channelChips()` and asserts its output. The second reads the
 * SOURCE of the screen and the chip component, because wiring — a ref existing,
 * a handler being passed — cannot be reached any other way in this harness.
 *
 * ⛔ A SOURCE-TEXT TEST NEVER COMPILES OR RENDERS WHAT IT CLAIMS TO CHECK. It
 * catches a deletion, not a bug. `npm run lint` and the production build are
 * what prove this compiles; a green run here does not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { channelChips, CHANNELS, SECTION_SCROLL_MARGIN } from './notificationChannels3.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const SCREEN = read('../screens/NotificationsScreen.jsx');
const CHIPS  = read('../components/NotificationChannelChips.jsx');

/* ── 1 · three chips, in the channel order ──────────────────────── */

test('1 · exactly three channels render, in order', () => {
  const chips = channelChips({ push: true, email: true });
  assert.equal(chips.length, 3);
  assert.deepEqual(chips.map(c => c.key), ['in_app', 'push', 'email']);
  assert.deepEqual(chips.map(c => c.label), ['In-app', 'Push', 'Email']);
});

/* ── 2 · each chip reflects its channel's real state ────────────── */

test('2 · push and email report the state they are given', () => {
  const on  = channelChips({ push: true,  email: true  });
  const off = channelChips({ push: false, email: false });

  assert.equal(on.find(c => c.key === 'push').status,  'ON');
  assert.equal(on.find(c => c.key === 'email').status, 'ON');
  assert.equal(off.find(c => c.key === 'push').status,  'OFF');
  assert.equal(off.find(c => c.key === 'email').status, 'OFF');
});

test('2 · the two channels are independent', () => {
  const mixed = channelChips({ push: false, email: true });
  assert.equal(mixed.find(c => c.key === 'push').status,  'OFF');
  assert.equal(mixed.find(c => c.key === 'email').status, 'ON',
    'email must not inherit push’s state');
});

test('⚠ UNKNOWN IS NOT OFF — a loading panel must not claim the channel is off', () => {
  for (const v of [null, undefined]) {
    const chips = channelChips({ push: v, email: v });
    for (const key of ['push', 'email']) {
      const c = chips.find(x => x.key === key);
      assert.equal(c.on, null, `${key}: unknown stays unknown`);
      assert.notEqual(c.status, 'OFF',
        `⛔ ${key}: a chip must never read OFF while the panel is still loading — `
        + 'OFF is the state a reader acts on');
    }
  }
});

test('⭐ in-app is always ON, because it has no off switch', () => {
  // NP1 mutes per CATEGORY; nothing disables the feed wholesale. A chip
  // offering OFF would advertise a state the system cannot reach.
  for (const state of [{}, { push: false, email: false }, { push: true, email: true }]) {
    const inApp = channelChips(state).find(c => c.key === 'in_app');
    assert.equal(inApp.status, 'ON');
    assert.equal(inApp.on, true);
  }
  assert.equal(CHANNELS.find(c => c.key === 'in_app').alwaysOn, true,
    'and it is declared, not implied');
});

/* ── 3, 4, 5 · navigation ───────────────────────────────────────── */

test('3+4+5 · every channel has a ref, and the handler maps all three', () => {
  for (const ref of ['inAppRef', 'pushRef', 'emailRef']) {
    assert.match(SCREEN, new RegExp(`const ${ref}\\s*=\\s*useRef`), `${ref} exists`);
    assert.match(SCREEN, new RegExp(`ref=\\{${ref}\\}`), `${ref} is attached to a wrapper`);
  }
  assert.match(SCREEN, /in_app:\s*inAppRef/);
  assert.match(SCREEN, /push:\s*pushRef/);
  assert.match(SCREEN, /email:\s*emailRef/);
  assert.match(SCREEN, /scrollIntoView\(\{\s*behavior:\s*'smooth',\s*block:\s*'start'\s*\}\)/,
    'scrolls by ref, ⛔ not by a pixel offset');
});

test('⭐ pressing a chip OPENS the panel before scrolling', () => {
  // The sections do not exist while preferences are collapsed, so a scroll
  // without the open is a silent no-op — the exact experience being fixed.
  const fn = SCREEN.slice(SCREEN.indexOf('function goToChannel'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(body.includes('setPrefsOpen(true)'), 'it opens the panel');
  assert.ok(body.indexOf('setPrefsOpen(true)') < body.indexOf('scrollIntoView'),
    '⛔ open must come BEFORE the scroll');
  assert.ok(body.includes('requestAnimationFrame'),
    '⚠ and the scroll waits a frame, or the ref is still null');
});

test('⚠ the fixed header is accounted for', () => {
  assert.ok(SECTION_SCROLL_MARGIN > 0);
  assert.match(SCREEN, /scrollMarginTop:\s*SECTION_SCROLL_MARGIN/,
    'the anchor style uses the shared constant, ⛔ not a second copy of the number');
});

/* ── 9 · no second source of truth ──────────────────────────────── */

test('9 · ⛔ the chips introduce NO preference state of their own', () => {
  assert.doesNotMatch(CHIPS, /supabase/i,
    '⛔ the chip component must never read the database');
  assert.doesNotMatch(CHIPS, /upsert|\.from\(/,
    '⛔ and must never write a preference');
  assert.doesNotMatch(CHIPS, /useState/,
    '⛔ it holds no state; the owning panels report theirs');
});

test('9 · the screen reads channel state FROM the panels, not from a second query', () => {
  assert.match(SCREEN, /onState=\{setPushOn\}/,  'push reports upward');
  assert.match(SCREEN, /onState=\{setEmailOn\}/, 'email reports upward');
  assert.match(SCREEN, /useState\(null\)/,
    '⚠ state starts unknown rather than false');
});

/* ── 8 · the existing controls are untouched ────────────────────── */

test('8 · the three panels still render, unchanged, with their own sessions', () => {
  for (const panel of [
    'PushNotificationToggle', 'NotificationPreferences', 'EmailNotificationPreferences',
  ]) {
    assert.match(SCREEN, new RegExp(`<${panel} session=\\{session\\}`),
      `${panel} is still mounted and still owns its own settings`);
  }
});

test('8 · ⛔ the chip row is not a control', () => {
  // role="group" of jump buttons, ⛔ not switches. A `role="switch"` here would
  // promise a toggle that does not exist.
  assert.doesNotMatch(CHIPS, /role="switch"/,
    '⛔ chips must not present as switches');
  assert.match(CHIPS, /role="group"/);
  assert.match(CHIPS, /onGo\(c\.key\)/, 'a press navigates and nothing else');
});

test('no em dashes in the chip copy', () => {
  for (const c of CHANNELS) {
    assert.doesNotMatch(c.label, /—/, `${c.key}: ⛔ NO EM DASHES in user-facing copy`);
  }
});
