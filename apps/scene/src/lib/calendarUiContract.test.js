import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * ADD TO CALENDAR — the wiring contract, in the repo's source-text idiom
 * (there is no DOM runner here; behaviour lives in lib/calendarEvent and is
 * tested there — these pin the WIRING so the control cannot silently detach
 * or leak onto an ineligible surface).
 *
 * ⭐⭐ THE SHAPE UNDER GUARD:
 *   lib/calendarEvent decides WHO is eligible (confirmed + clock-placeable) →
 *   SchedulePortrait passes `onAddToCalendar` ONLY from that map →
 *   SlotCard renders the control ONLY where the handler exists.
 * A draft, offered, declined, cancelled or timeless slot never reaches the
 * map, so it can never grow the button — that is the "unconfirmed does not
 * show it" guarantee, and it lives in exactly one place.
 */

const src = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('SlotCard renders ADD TO CALENDAR gated on its handler, like every other control', () => {
  const card = src('../screens/event/SlotCard.jsx');
  assert.ok(card.includes('onAddToCalendar'), 'SlotCard no longer takes the handler');
  assert.match(card, /\{onAddToCalendar && \(/, 'the control must be handler-gated — no isHost or status test of its own');
  assert.ok(card.includes('ADD TO CALENDAR'), 'the label is gone');
  assert.match(card, /onClick=\{e => \{ e\.stopPropagation\(\); onAddToCalendar\(\); \}\}/,
    'clicking must invoke the handler (and not also expand the card)');
});

test('⛔ SlotCard holds NO copy of the eligibility rules — no confirmed test around the button', () => {
  const card = src('../screens/event/SlotCard.jsx');
  const block = card.slice(card.indexOf('{onAddToCalendar && ('), card.indexOf('ADD TO CALENDAR'));
  assert.ok(!block.includes('isConfirmed') && !block.includes('claim'),
    'eligibility lives in lib/calendarEvent only — a second copy here is the drift this repo keeps being bitten by');
});

test('SchedulePortrait derives the handler from calendarEventsBySlot and downloads through the lib', () => {
  const portrait = src('../screens/event/SchedulePortrait.jsx');
  assert.ok(portrait.includes("from '../../lib/calendarEvent'"), 'must import the lib');
  assert.ok(portrait.includes('calendarEventsBySlot(resolved, calendar)'), 'the map is built from the resolved schedule');
  assert.match(portrait, /onAddToCalendar=\{calBySlot\?\.\[entry\.slot\.id\]\s*\?\s*\(\) => downloadCalendarEvent\(calBySlot\[entry\.slot\.id\]\)\s*:\s*undefined\}/,
    'the handler exists only for slots the lib mapped, and it calls the one download path');
});

test('the event page and the set-times route both pass the calendar context', () => {
  for (const screen of ['../screens/EventScreen.jsx', '../screens/SetTimesScreen.jsx']) {
    const text = src(screen);
    assert.ok(/calendar=\{\{ event, venueProfile: d\.venueProfile \}\}/.test(text),
      `${screen} no longer passes the calendar context`);
  }
});

/* ── the account-level calendar sync (Stage 1) ─────────────────────── */

test('the profile menu offers plain "Calendar" routing to /calendar', () => {
  const menu = src('../components/ProfileMenu.jsx');
  assert.match(menu, /label: 'Calendar', onClick: \(\) => go\('\/calendar'\)/,
    'the menu item is "Calendar", not a settings-flavoured name');
});

test('the /calendar route is registered in both App.jsx and routeAccess as ACCOUNT', () => {
  assert.match(src('../App.jsx'), /<Route path="\/calendar"\s+element=\{<CalendarScreen \/>\}/);
  assert.match(src('./routeAccess.js'), /'\/calendar':\s+\{ access: ACCESS\.ACCOUNT \}/);
});

test('⛔ the feed endpoint holds NO second generator and NO service key', () => {
  const fn = src('../../functions/calendar/feed.js');
  assert.ok(fn.includes("from '../../src/lib/calendarFeed.js'"), 'the endpoint imports the one core');
  assert.ok(!fn.includes('BEGIN:V'), 'no inline iCalendar text — generation lives in the lib only');
  assert.ok(!/service[_-]?role/i.test(fn), 'the token + SECURITY DEFINER RPC replace any service key');
});

test('⛔ master OFF preserves category choices — disable touches enabled only', () => {
  const prefs = src('./calendarPrefs.js');
  const disable = prefs.slice(prefs.indexOf('export async function disableCalendarSync'), prefs.indexOf('export async function setCalendarCategory'));
  assert.ok(disable.includes('enabled: false'));
  assert.ok(!disable.includes('categories'), 'disabling must not write categories');
  assert.ok(!disable.includes('token'), 'disabling must not touch the token');
  assert.ok(!disable.includes('.delete('), 'disabling must never delete the row');
});

/* ── Phase 2A · the role-aware screen ──────────────────────────────── */

test('the Calendar screen renders ROLE CHIPS from held profiles, not from activity', () => {
  const screen = src('../screens/CalendarScreen.jsx');
  assert.ok(screen.includes('rolesForAccount(profileTypes)'), 'chips come from profile types');
  assert.ok(screen.includes('fetchProfileTypes'), 'and those are fetched from `profiles`');
  assert.match(screen, /aria-pressed=\{on\}/, 'chips are pressable state, not links');
  assert.ok(screen.includes('roles.length > 1'), 'a single-role account gets no chip row');
});

test('⭐ ALL is a selected state at the END, not the primary chip', () => {
  const screen = src('../screens/CalendarScreen.jsx');
  assert.match(screen, /\[\.\.\.roles, \{ key: ALL_ROLE, label: 'ALL' \}\]/,
    'ALL is appended after the real roles');
});

test('the four questions are rendered as the grammar, from the shared registry', () => {
  const screen = src('../screens/CalendarScreen.jsx');
  assert.ok(screen.includes('QUESTIONS[c.question]'), 'the question labels the row');
  assert.ok(screen.includes('categoriesForRole(r.key)'), 'categories come from the registry, not a copy');
  const feed = src('./calendarFeed.js');
  for (const q of ['on', 'when', 'committed', 'waiting']) {
    assert.ok(feed.includes(`${q}:`), `question ${q} declared`);
  }
});

test('⛔ an unsupported question is ABSENT with a stated reason, never a dead toggle', () => {
  const feed = src('./calendarFeed.js');
  assert.ok(feed.includes('ABSENT_CATEGORIES'), 'absences are declared');
  const screen = src('../screens/CalendarScreen.jsx');
  assert.ok(screen.includes('absent.map'), 'and explained on screen');
  /* the two that genuinely have no data */
  assert.ok(/role: 'host',\s+question: 'waiting'/.test(feed));
  assert.ok(/role: 'venue',\s+question: 'waiting'/.test(feed));
});

test('⛔ Phase 2A ships NO festival, volunteer or vendor role', () => {
  const feed = src('./calendarFeed.js');
  const roles = feed.slice(feed.indexOf('export const CALENDAR_ROLES'), feed.indexOf('export const CALENDAR_CATEGORIES'));
  for (const out of ['festival', 'volunteer', 'vendor', 'workshop', 'decor']) {
    assert.ok(!roles.includes(`'${out}'`), `${out} is out of scope for 2A`);
  }
});

test('⛔ the feed endpoint is still the ONE subscription path', () => {
  const fn = src('../../functions/calendar/feed.js');
  assert.ok(fn.includes("from '../../src/lib/calendarFeed.js'"));
  assert.ok(!fn.includes('BEGIN:V'), 'no second generator');
});

test('⛔ the host editor path (DaySlots) does not grow the control', () => {
  const daySlots = src('../screens/event/DaySlots.jsx');
  assert.ok(!daySlots.includes('onAddToCalendar'),
    'DaySlots is the host workspace; the calendar export belongs to the reader surfaces');
});
