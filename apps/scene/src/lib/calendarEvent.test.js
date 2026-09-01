/**
 * ADD TO CALENDAR — the .ics generator's contract.
 *
 * ⭐⭐ THE TWO LAWS UNDER TEST:
 *   1. The UID is derived from the slot uuid and NOTHING else — the set time,
 *      venue and event name can all change and the UID must not, so a
 *      calendar app can treat a regenerated file as an update.
 *   2. DTSTART/DTEND are FLOATING local times. The data stores the venue's
 *      wall clock with no timezone, so 9:00 PM must read 9:00 PM — never a
 *      UTC conversion that bakes the exporting device's offset in, and never
 *      a shifted hour across an Australian daylight-saving transition.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  slotUid, slotCalendarEvent, calendarEventsBySlot, buildIcs,
  escapeIcsText, foldIcsLine, icsWallDateTime, icsUtcDateTime, icsFilename,
} from './calendarEvent.js';

/* ── fixtures — the shapes resolveSchedule actually hands out ──────── */
const slot = (id, time, ampm, dur = 60) => ({ id, time, ampm, dur });
const confirmedClaim = (name = 'Karioke Kev') =>
  ({ name, status: 'confirmed', performance: { status: 'accepted' } });
const entryOf = (s, claim) => ({ slot: s, claim });
const dayOf = (date, entries) => ({ date, dayIndex: 0, stages: [{ name: 'MAIN', slots: entries }] });

const EVENT = {
  id: 'ev-1',
  name: 'Solstice Gathering',
  config: { date: '2026-08-29', venue: 'The Hall', location: '1 Main St', suburb: 'Bellingen', state: 'NSW' },
};

function confirmedSet({ time = '9:00', ampm = 'PM', dur = 60, date = '2026-08-29', name, event = EVENT } = {}) {
  const e = entryOf(slot('slot-1', time, ampm, dur), confirmedClaim(name));
  return slotCalendarEvent({ event, day: dayOf(date, [e]), entry: e });
}

const NOW = new Date(Date.UTC(2026, 7, 1, 2, 3, 4)); // deterministic DTSTAMP

/* ── structure ─────────────────────────────────────────────────────── */

test('a confirmed set produces a structurally valid VCALENDAR', () => {
  const ics = buildIcs(confirmedSet(), { now: NOW });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  for (const required of ['VERSION:2.0', 'PRODID:-//YesPleez//Scene//EN', 'BEGIN:VEVENT', 'END:VEVENT', 'METHOD:PUBLISH', 'STATUS:CONFIRMED']) {
    assert.ok(ics.includes(`\r\n${required}\r\n`) || ics.includes(`${required}\r\n`), `missing ${required}`);
  }
  // BEGIN/END pairing, in order
  assert.ok(ics.indexOf('BEGIN:VEVENT') > ics.indexOf('BEGIN:VCALENDAR'));
  assert.ok(ics.indexOf('END:VEVENT') < ics.indexOf('END:VCALENDAR'));
});

test('⭐ every line ending is CRLF — no bare newline anywhere', () => {
  const ics = buildIcs(confirmedSet(), { now: NOW });
  for (const piece of ics.split('\r\n')) {
    assert.ok(!piece.includes('\n') && !piece.includes('\r'), `bare line break inside: ${JSON.stringify(piece)}`);
  }
});

/* ── event data mapping ────────────────────────────────────────────── */

test('the event data lands in the right properties', () => {
  const cal = confirmedSet();
  const ics = buildIcs(cal, { now: NOW });
  assert.equal(cal.summary, 'Karioke Kev at Solstice Gathering');
  assert.ok(ics.includes('SUMMARY:Karioke Kev at Solstice Gathering'));
  assert.ok(ics.includes('LOCATION:The Hall\\, 1 Main St\\, Bellingen\\, NSW'));
  assert.ok(ics.includes('URL:https://yespleez.com/#/event/ev-1'));
  assert.ok(ics.includes('DTSTAMP:20260801T020304Z'));
  assert.ok(cal.description.includes('https://yespleez.com/#/event/ev-1'));
});

test('DTSTART and DTEND are the slot window as floating local time', () => {
  const ics = buildIcs(confirmedSet({ time: '9:00', ampm: 'PM', dur: 90 }), { now: NOW });
  assert.ok(ics.includes('DTSTART:20260829T210000'), 'DTSTART is 9:00 PM local, unshifted');
  assert.ok(ics.includes('DTEND:20260829T223000'), 'DTEND is start + 90 minutes');
  assert.ok(!/DTSTART:[0-9T]+Z/.test(ics), 'DTSTART must be floating — no UTC Z suffix');
});

test('⚠ a slot with no readable duration keeps its start and omits DTEND — never a guessed hour', () => {
  const ics = buildIcs(confirmedSet({ dur: 0 }), { now: NOW });
  assert.ok(ics.includes('DTSTART:20260829T210000'));
  assert.ok(!ics.includes('DTEND'));
});

test('⭐ the midnight rollover is honoured — a 1:00 AM closer lands on the NEXT calendar day', () => {
  const late = entryOf(slot('slot-late', '1:00', 'AM', 60), confirmedClaim('Closer'));
  const day = { date: '2026-08-29', dayIndex: 0, stages: [{ name: 'MAIN', slots: [
    entryOf(slot('slot-early', '11:00', 'PM', 60), confirmedClaim('Opener')),
    late,
  ] }] };
  const cal = slotCalendarEvent({ event: EVENT, day, entry: late });
  const ics = buildIcs(cal, { now: NOW });
  assert.ok(ics.includes('DTSTART:20260830T010000'), 'Saturday list, Sunday clock');
});

/* ── timezone / daylight saving ────────────────────────────────────── */

test('⭐⭐ the wall clock survives the Australian DST transition (2026-10-04, AEST→AEDT)', () => {
  // Floating local time: whatever the device zone does that morning, a 9:00 PM
  // set on transition day must still be emitted as 21:00 on that date.
  const before = buildIcs(confirmedSet({ date: '2026-10-03' }), { now: NOW });
  const after = buildIcs(confirmedSet({ date: '2026-10-04' }), { now: NOW });
  assert.ok(before.includes('DTSTART:20261003T210000'));
  assert.ok(after.includes('DTSTART:20261004T210000'), 'the hour must not shift across the transition');
});

test('DTSTAMP alone is UTC', () => {
  assert.equal(icsUtcDateTime(new Date(Date.UTC(2026, 11, 31, 23, 59, 58))), '20261231T235958Z');
});

test('icsWallDateTime is calendar arithmetic — the offset rolls the date, never the clock', () => {
  assert.equal(icsWallDateTime('2026-10-04', 21 * 60 + 30), '20261004T213000');
  assert.equal(icsWallDateTime('2026-08-29', 25 * 60), '20260830T010000', 'a 25h offset is 1:00 AM next day');
  assert.equal(icsWallDateTime('2026-12-31', 24 * 60 + 30), '20270101T003000', 'the roll crosses a year');
  assert.equal(icsWallDateTime('nonsense', 60), null);
  assert.equal(icsWallDateTime('2026-08-29', null), null);
});

/* ── UID stability ─────────────────────────────────────────────────── */

test('⭐⭐ the UID is deterministic from the slot uuid and has the ratified shape', () => {
  assert.equal(slotUid('abc-123'), 'yespleez-slot-abc-123@yespleez.com');
  assert.equal(confirmedSet().uid, 'yespleez-slot-slot-1@yespleez.com');
});

test('⭐⭐ the UID does not change when the time, venue or event name change', () => {
  const original = confirmedSet();
  const movedTime = confirmedSet({ time: '11:30', ampm: 'PM', date: '2026-08-30' });
  const movedVenue = confirmedSet({ event: { ...EVENT, config: { ...EVENT.config, venue: 'The Other Hall', location: '99 New Rd' } } });
  const renamed = confirmedSet({ event: { ...EVENT, name: 'Solstice Renamed' } });
  assert.equal(movedTime.uid, original.uid);
  assert.equal(movedVenue.uid, original.uid);
  assert.equal(renamed.uid, original.uid);
  // and two generations of the same slot are byte-identical given the same clock
  assert.equal(buildIcs(original, { now: NOW }), buildIcs(confirmedSet(), { now: NOW }));
});

test('SEQUENCE defaults to 0 and is emitted when a caller knows better', () => {
  const cal = confirmedSet();
  assert.ok(buildIcs(cal, { now: NOW }).includes('SEQUENCE:0'));
  assert.ok(buildIcs(cal, { now: NOW, sequence: 3 }).includes('SEQUENCE:3'));
});

/* ── escaping and folding ──────────────────────────────────────────── */

test('escapeIcsText escapes backslash, semicolon, comma and line breaks', () => {
  assert.equal(escapeIcsText('a\\b;c,d\ne\r\nf'), 'a\\\\b\\;c\\,d\\ne\\nf');
});

test('special characters in an act name are escaped in SUMMARY and DESCRIPTION', () => {
  const ics = buildIcs(confirmedSet({ name: 'Bell; Book, Candle\\Crew' }), { now: NOW });
  assert.ok(ics.includes('SUMMARY:Bell\\; Book\\, Candle\\\\Crew at Solstice Gathering'));
  assert.ok(!/SUMMARY:[^\r]*[^\\];/.test(ics.split('DESCRIPTION')[0].split('SUMMARY')[1] || ''), 'no unescaped semicolon in SUMMARY value');
});

test('a content line never exceeds 75 octets and folds with CRLF + space', () => {
  const long = 'DESCRIPTION:' + 'x'.repeat(300);
  const folded = foldIcsLine(long);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1, 'a 300-char line must fold');
  for (const part of parts) {
    assert.ok(Buffer.byteLength(part, 'utf8') <= 75, `physical line over 75 octets: ${part.length}`);
  }
  for (const cont of parts.slice(1)) assert.ok(cont.startsWith(' '), 'continuation lines start with a space');
  assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(''), long, 'unfolding restores the content');
});

test('folding counts UTF-8 octets, not characters', () => {
  const folded = foldIcsLine('SUMMARY:' + '🎶'.repeat(40));
  for (const part of folded.split('\r\n')) {
    assert.ok(Buffer.byteLength(part, 'utf8') <= 75);
  }
});

/* ── the gate — who never gets a calendar event ────────────────────── */

test('⛔ an offered, draft or declined set produces nothing', () => {
  for (const status of ['offered', 'draft', 'declined', 'pending']) {
    const e = entryOf(slot('s1', '9:00', 'PM', 60), { name: 'Maybe', status, performance: { status } });
    assert.equal(slotCalendarEvent({ event: EVENT, day: dayOf('2026-08-29', [e]), entry: e }), null, status);
  }
});

test('⛔ an empty slot (no claim) produces nothing', () => {
  const e = entryOf(slot('s1', '9:00', 'PM', 60), null);
  assert.equal(slotCalendarEvent({ event: EVENT, day: dayOf('2026-08-29', [e]), entry: e }), null);
});

test('⛔ a set that cannot be placed on a clock produces nothing — no guessed times', () => {
  // missing meridiem: "9:00" could be either end of the day
  const noAmpm = entryOf({ id: 's1', time: '9:00', ampm: null, dur: 60 }, confirmedClaim());
  assert.equal(slotCalendarEvent({ event: EVENT, day: dayOf('2026-08-29', [noAmpm]), entry: noAmpm }), null);
  // unparseable event date
  const fine = entryOf(slot('s2', '9:00', 'PM', 60), confirmedClaim());
  assert.equal(slotCalendarEvent({ event: EVENT, day: dayOf('someday soon', [fine]), entry: fine }), null);
  // no date at all
  assert.equal(slotCalendarEvent({ event: EVENT, day: dayOf(null, [fine]), entry: fine }), null);
});

test('⛔ a slot with no uuid produces nothing — the UID would have no identity', () => {
  const e = entryOf({ id: null, time: '9:00', ampm: 'PM', dur: 60 }, confirmedClaim());
  assert.equal(slotCalendarEvent({ event: EVENT, day: dayOf('2026-08-29', [e]), entry: e }), null);
});

test('calendarEventsBySlot maps only the confirmed, placeable sets', () => {
  const ok = entryOf(slot('ok', '8:00', 'PM', 60), confirmedClaim('On'));
  const offered = entryOf(slot('off', '9:00', 'PM', 60), { name: 'Maybe', status: 'offered', performance: { status: 'offered' } });
  const empty = entryOf(slot('gap', '10:00', 'PM', 60), null);
  const resolved = { days: [{ date: '2026-08-29', dayIndex: 0, stages: [{ name: 'MAIN', slots: [ok, offered, empty] }] }] };
  const map = calendarEventsBySlot(resolved, { event: EVENT });
  assert.deepEqual(Object.keys(map), ['ok']);
  assert.equal(map.ok.uid, 'yespleez-slot-ok@yespleez.com');
});

/* ── privacy — a withheld location stays withheld ──────────────────── */

test('⛔ a secret location exports NO LOCATION and never leaks the address', () => {
  const secret = { ...EVENT, config: { ...EVENT.config, locationWithheld: true } };
  const cal = confirmedSet({ event: secret });
  const ics = buildIcs(cal, { now: NOW });
  assert.equal(cal.location, null);
  assert.ok(!ics.includes('LOCATION'));
  assert.ok(!ics.includes('Main St'), 'the address must not appear anywhere in the file');
  assert.ok(cal.description.includes('announced closer to the event'));
});

/* ── cancellation capability (V1 never sends one automatically) ────── */

test('the generator CAN produce a cancellation for the same UID', () => {
  const cal = confirmedSet();
  const ics = buildIcs(cal, { now: NOW, cancelled: true, sequence: 1 });
  assert.ok(ics.includes('METHOD:CANCEL'));
  assert.ok(ics.includes('STATUS:CANCELLED'));
  assert.ok(ics.includes(`UID:${cal.uid.replace(/,/g, '\\,')}`), 'cancellation targets the same UID');
});

test('buildIcs refuses a broken input rather than emitting a half-file', () => {
  assert.equal(buildIcs(null), null);
  assert.equal(buildIcs({ uid: 'x' }), null);                          // no start instant
  assert.equal(buildIcs({ dtstart: '20260829T210000' }), null);        // no uid
});

/* ── filename ──────────────────────────────────────────────────────── */

test('icsFilename slugifies like the other exports and always ends .ics', () => {
  assert.equal(icsFilename('Karioke Kev at Solstice Gathering'), 'yespleez-set-karioke-kev-at-solstice-gathering.ics');
  assert.equal(icsFilename(''), 'yespleez-set-set.ics');
  assert.equal(icsFilename('Ångström!'), 'yespleez-set-angstrom.ics');
});
