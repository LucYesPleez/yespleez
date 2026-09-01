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

test('⛔ the host editor path (DaySlots) does not grow the control', () => {
  const daySlots = src('../screens/event/DaySlots.jsx');
  assert.ok(!daySlots.includes('onAddToCalendar'),
    'DaySlots is the host workspace; the calendar export belongs to the reader surfaces');
});
