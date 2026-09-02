/**
 * Where the night is up to — S3.
 *
 * ⚠⚠ THESE TEST THE RULES, ⛔ not the treatment. That a playing set swells and
 * a played one is muted is verified by driving the real interface; what is
 * checked here is WHICH set is playing, which is the part with a midnight in
 * it. A source-text test never compiles or renders what it claims to verify.
 *
 * ⚠ Instants are built with the LOCAL-TIME constructor throughout, for the same
 * reason the module is: `new Date('2026-08-21')` is UTC and would move every
 * expectation in this file by a day east of Greenwich.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSchedule } from './scheduleModel.js';
import {
  clockMinutes, axisOffsets, dayMidnight, slotStates, nightIsRunning, readSlot, phaseLabel,
  focusDayIndex,
  PLAYED, PLAYING, UPCOMING, READY, STARTING, MIDSET, ENDING, FINISHED,
} from './scheduleNow.js';

const slot = (o = {}) => ({
  id: o.id || `s${o.position ?? 0}-${o.stage_id ?? 'x'}`,
  day_index: o.day_index ?? 0,
  day_name: 'SATURDAY',
  position: o.position ?? 0,
  time: o.time ?? '7:00',
  ampm: 'ampm' in o ? o.ampm : 'PM',
  dur_mins: o.dur_mins ?? 60,
  label: '',
  label_color: null,
  pinned: false,
  stage_id: 'stage_id' in o ? o.stage_id : null,
});

const EVENT_DATE = '2026-08-22';                       // a Saturday
/** Local wall clock on the event's own day, ⛔ never a UTC string. */
const at = (h, m = 0, plusDays = 0) =>
  new Date(2026, 7, 22 + plusDays, h, m).getTime();

// ── Reading the clock ────────────────────────────────────────────────────

test('⚠ 12 wraps in both directions: 12:30 AM is half past midnight, 12:30 PM is midday', () => {
  assert.equal(clockMinutes('12:30', 'AM'), 30);
  assert.equal(clockMinutes('12:30', 'PM'), 12 * 60 + 30);
  assert.equal(clockMinutes('1:00', 'AM'), 60);
  assert.equal(clockMinutes('11:30', 'PM'), 23 * 60 + 30);
});

test('⛔ a missing meridiem is UNKNOWN, ⛔ never a guess', () => {
  // "1:00" alone is either end of the day. Guessing moves a set 12 hours.
  assert.equal(clockMinutes('1:00', ''), null);
  assert.equal(clockMinutes('7:00', null), null);
  assert.equal(clockMinutes('nonsense', 'PM'), null);
});

// ── The rollover ─────────────────────────────────────────────────────────

test('⭐⭐ the night rolls over at the point the clock goes BACKWARDS', () => {
  const { days } = resolveSchedule({
    slots: [
      slot({ position: 0, time: '10:00', ampm: 'PM' }),
      slot({ position: 1, time: '11:30', ampm: 'PM' }),
      slot({ position: 2, time: '1:00', ampm: 'AM' }),
    ],
    performances: [], members: [], eventDate: EVENT_DATE,
  });
  const off = axisOffsets(days[0]);
  assert.equal(off.get('10:00 PM'), 22 * 60);
  assert.equal(off.get('11:30 PM'), 23 * 60 + 30);
  // 1:00 AM is 25h into the night, ⛔ not 1h — it is tomorrow.
  assert.equal(off.get('1:00 AM'), 25 * 60);
});

test('⭐ the rollover is shared across stages, so one printed time is one instant', () => {
  const { days } = resolveSchedule({
    slots: [
      slot({ position: 0, time: '10:00', ampm: 'PM', stage_id: 'a' }),
      slot({ position: 1, time: '1:00', ampm: 'AM', stage_id: 'a' }),
      // CHILL runs ONLY at 1 AM. On its own walk it would never roll over.
      slot({ position: 2, time: '1:00', ampm: 'AM', stage_id: 'b' }),
    ],
    performances: [], members: [],
    stages: [{ id: 'a', name: 'MAIN', position: 0 }, { id: 'b', name: 'CHILL', position: 1 }],
    eventDate: EVENT_DATE,
  });
  assert.equal(axisOffsets(days[0]).get('1:00 AM'), 25 * 60);
});

test('⛔⛔ a later stage introducing an EARLIER time does not roll the night over', () => {
  /**
   * ⚠⚠ NEVERLAND, LIVE (owner, 2026-08-28: "2 stages so 2 slots should be lit
   * up"). `timeAxis` lists stage A's times then stage B's, so the walk saw
   * 11:30 PM followed by B's 7:30 PM, called that a midnight rollover, and put
   * the DJ stage's 7:30 set on TOMORROW. At 7:46 PM only the live stage lit.
   *
   * ⛔ A stage's position among other stages must never move it in time.
   */
  const { days } = resolveSchedule({
    slots: [
      slot({ position: 0, time: '7:00',  ampm: 'PM', stage_id: 'a' }),
      slot({ position: 1, time: '11:30', ampm: 'PM', stage_id: 'a' }),
      // Listed second, and its first time is EARLIER than A's last.
      slot({ position: 2, time: '7:30',  ampm: 'PM', stage_id: 'b', dur_mins: 90 }),
      slot({ position: 3, time: '12:00', ampm: 'AM', stage_id: 'b' }),
    ],
    performances: [], members: [],
    stages: [{ id: 'a', name: 'LIVE', position: 0 }, { id: 'b', name: 'DJ', position: 1 }],
    eventDate: EVENT_DATE,
  });
  const off = axisOffsets(days[0]);
  assert.equal(off.get('7:30 PM'), 19 * 60 + 30, '7:30 PM is tonight, ⛔ not tomorrow');
  // ⭐ And the REAL rollover still fires: midnight closes the DJ stage.
  assert.equal(off.get('12:00 AM'), 24 * 60);

  // ⭐⭐ The point of the whole thing: at 7:46 PM BOTH rooms are playing.
  const states = slotStates(days[0], at(19, 46));
  const playing = days[0].stages
    .flatMap(st => (st.slots || []).map(e => [st.name, states.get(e.slot.id)?.state]))
    .filter(([, s]) => s === PLAYING)
    .map(([name]) => name);
  assert.deepEqual(playing, ['LIVE', 'DJ']);
});

test('⛔⛔ a day starts at LOCAL midnight, ⛔ never at a UTC parse of its date', () => {
  const d = dayMidnight('2026-08-23');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 23);
  assert.equal(d.getHours(), 0);          // ⚠ midnight LOCAL, not 10am after a UTC parse
  assert.equal(dayMidnight(''), null);
});

test('⭐ day 2 of a festival uses the DAY\'s own date, ⛔ not date + index twice', () => {
  // `resolveSchedule` already put 2026-08-23 on day 1. If this module re-added
  // the index the second day would run 24h late and never light up.
  const { days } = resolveSchedule({
    slots: [slot({ id: 'd1', day_index: 1, time: '9:00', ampm: 'PM' })],
    performances: [], members: [], eventDate: EVENT_DATE,
  });
  assert.equal(days[0].date, '2026-08-23');
  assert.equal(slotStates(days[0], at(21, 30, 1)).get('d1').state, PLAYING);
});

// ── The three states ─────────────────────────────────────────────────────

const night = () => resolveSchedule({
  slots: [
    slot({ id: 'early', position: 0, time: '8:00', ampm: 'PM', dur_mins: 60 }),
    slot({ id: 'onnow', position: 1, time: '9:00', ampm: 'PM', dur_mins: 60 }),
    slot({ id: 'later', position: 2, time: '10:00', ampm: 'PM', dur_mins: 60 }),
    slot({ id: 'closer', position: 3, time: '1:00', ampm: 'AM', dur_mins: 60 }),
  ],
  performances: [], members: [], eventDate: EVENT_DATE,
}).days[0];

test('⭐⭐ played · playing · upcoming, at 9:30 PM', () => {
  const st = slotStates(night(), at(21, 30));
  assert.equal(st.get('early').state, PLAYED);
  assert.equal(st.get('onnow').state, PLAYING);
  assert.equal(st.get('later').state, UPCOMING);
  assert.equal(st.get('closer').state, UPCOMING);
});

test('⚠⚠ the 1 AM closer is PLAYING at 1:30 AM on the NEXT calendar day', () => {
  const st = slotStates(night(), at(1, 30, 1));
  assert.equal(st.get('closer').state, PLAYING);
  assert.equal(st.get('later').state, PLAYED);
});

test('⚠ a set is PLAYED the instant it ends, ⛔ not a minute later', () => {
  const st = slotStates(night(), at(22, 0));
  assert.equal(st.get('later').state, PLAYING);         // 10:00 starts
  assert.equal(st.get('onnow').state, PLAYED);          // 9:00–10:00 is over
});

test('⭐⭐ before doors and after the last set, NOTHING is marked', () => {
  // ⛔ Otherwise every finished event on the site is a wall of grey forever.
  assert.equal(slotStates(night(), at(17, 0)).size, 0);
  assert.equal(slotStates(night(), at(4, 0, 1)).size, 0);
  assert.equal(nightIsRunning(night(), at(21, 0)), true);
  assert.equal(nightIsRunning(night(), at(17, 0)), false);
});

test('⛔ an unplaceable night is UNMARKED, ⛔ never "already played"', () => {
  const d = resolveSchedule({
    slots: [slot({ id: 'x', time: '9:00', ampm: '' })],
    performances: [], members: [], eventDate: '',
  }).days[0];
  assert.equal(slotStates(d, at(21, 0)).size, 0);
});

test('⚠ concurrent stages are ALL playing — ⛔ nothing picks a winner', () => {
  const d = resolveSchedule({
    slots: [
      slot({ id: 'm9', position: 0, time: '9:00', ampm: 'PM', stage_id: 'a' }),
      slot({ id: 'c9', position: 1, time: '9:00', ampm: 'PM', stage_id: 'b' }),
    ],
    performances: [], members: [],
    stages: [{ id: 'a', name: 'MAIN', position: 0 }, { id: 'b', name: 'CHILL', position: 1 }],
    eventDate: EVENT_DATE,
  }).days[0];
  const st = slotStates(d, at(21, 30));
  assert.equal(st.get('m9').state, PLAYING);
  assert.equal(st.get('c9').state, PLAYING);
});

// ── The phases of a set, and the follow window ───────────────────────────

/** A one-hour set, 9:00–10:00 PM, as a bare window. */
const HOUR = { start: at(21, 0), end: at(22, 0) };

test('⭐⭐ GETTING READY covers the 20 minutes before the start, ⛔ not a second more', () => {
  assert.equal(readSlot(HOUR, at(20, 39)).phase, null);        // 21 min out
  assert.equal(readSlot(HOUR, at(20, 40)).phase, READY);       // exactly 20
  assert.equal(readSlot(HOUR, at(20, 59)).phase, READY);
  // ⚠ Still UPCOMING throughout — getting ready is not playing.
  assert.equal(readSlot(HOUR, at(20, 45)).state, UPCOMING);
  assert.equal(readSlot(HOUR, at(20, 45)).progress, 0);
});

test('⭐ STARTING is the first 10 minutes, ENDING the last 10, and the middle is unnamed', () => {
  assert.equal(readSlot(HOUR, at(21, 0)).phase, STARTING);
  assert.equal(readSlot(HOUR, at(21, 9)).phase, STARTING);
  assert.equal(readSlot(HOUR, at(21, 10)).phase, MIDSET);
  assert.equal(readSlot(HOUR, at(21, 49)).phase, MIDSET);
  assert.equal(readSlot(HOUR, at(21, 50)).phase, ENDING);
  assert.equal(readSlot(HOUR, at(21, 59)).phase, ENDING);
  // ⛔ The middle gets no words — the bar is already saying it.
  assert.equal(phaseLabel(MIDSET), null);
  assert.equal(phaseLabel(READY), 'GETTING READY');
});

test('⚠⚠ a SHORT set cannot be starting and ending at once', () => {
  // 15 minutes: two 10-minute edges would overlap for 5 of them.
  const short = { start: at(21, 0), end: at(21, 15) };
  assert.equal(readSlot(short, at(21, 0)).phase, STARTING);
  assert.equal(readSlot(short, at(21, 7)).phase, STARTING);    // still first half
  assert.equal(readSlot(short, at(21, 8)).phase, ENDING);      // flips at the midpoint
  assert.equal(readSlot(short, at(21, 14)).phase, ENDING);
});

test('⭐ progress measures THE SET, 0 before and 1 after', () => {
  assert.equal(readSlot(HOUR, at(20, 45)).progress, 0);
  assert.equal(readSlot(HOUR, at(21, 15)).progress, 0.25);
  assert.equal(readSlot(HOUR, at(21, 30)).progress, 0.5);
  assert.equal(readSlot(HOUR, at(22, 30)).progress, 1);
});

test('⭐⭐ the follow offer is a WINDOW after the set, ⛔ not every played card', () => {
  assert.equal(readSlot(HOUR, at(22, 0)).phase, FINISHED);     // the instant it ends
  assert.equal(readSlot(HOUR, at(22, 14)).phase, FINISHED);
  assert.equal(readSlot(HOUR, at(22, 15)).phase, null);        // 15 min: gone
  // ⚠ Still PLAYED either way — losing the offer is not losing the state.
  assert.equal(readSlot(HOUR, at(22, 30)).state, PLAYED);
});

test('⛔ a zero-length slot is never PLAYING and never claims progress', () => {
  // `dur` unreadable upstream: it has a start, so it can be next and then past.
  const zero = { start: at(21, 0), end: at(21, 0) };
  assert.equal(readSlot(zero, at(20, 50)).state, UPCOMING);
  assert.equal(readSlot(zero, at(21, 0)).state, PLAYED);
  assert.equal(readSlot(zero, at(21, 0)).progress, 1);
});

/* ── ⭐⭐ WHICH DAY THE SCHEDULE OPENS ON ────────────────────────────────
   ⚠⚠ The peek used to open on `days[0]`, so on the Saturday of a three-day
   festival it showed FRIDAY — a night already over — and the reader had to
   scroll past it to reach the day they were standing in (owner, 2026-08-28). */

const FEST = [
  { dayIndex: 0, date: '2026-08-28' },
  { dayIndex: 1, date: '2026-08-29' },
  { dayIndex: 2, date: '2026-08-30' },
];

test('mid-festival it opens on TODAY, not on day one', () => {
  assert.equal(focusDayIndex(FEST, '2026-08-29'), 1);
  assert.equal(focusDayIndex(FEST, '2026-08-30'), 2);
});

test('before it starts, the next day still to come', () => {
  // A reader planning ahead wants day one, and that is what "next" resolves to.
  assert.equal(focusDayIndex(FEST, '2026-08-01'), 0);
  assert.equal(focusDayIndex(FEST, '2026-08-28'), 0);
});

test('⛔ once it is over it opens on the LAST day, not the first', () => {
  // The final night is the most recent thing that happened. Opening a finished
  // festival on its opening day is the same mistake in the other direction.
  //
  // ⚠⚠ NARROWED 2026-09-01. This is now the fallback for days that carry NO
  // slots, which is all `FEST` has. Where a day knows its programme, a finished
  // festival opens on its BIGGEST night instead — the last day is usually the
  // wind-down, and Neverland's was three workshops. See the busiest-day tests
  // at the foot of this file.
  assert.equal(focusDayIndex(FEST, '2026-09-05'), 2);
});

test('a one-day event always resolves to its only day', () => {
  const one = [{ dayIndex: 0, date: '2026-08-28' }];
  for (const d of ['2026-08-01', '2026-08-28', '2026-12-25']) {
    assert.equal(focusDayIndex(one, d), 0);
  }
});

test('⛔ dayIndex is the identity, not the array position', () => {
  // Days keep their index when one is deleted — the gap is deliberate.
  const gapped = [{ dayIndex: 0, date: '2026-08-28' }, { dayIndex: 2, date: '2026-08-30' }];
  assert.equal(focusDayIndex(gapped, '2026-08-30'), 2);
});

test('no days, and dateless days, do not throw', () => {
  assert.equal(focusDayIndex([], '2026-08-29'), null);
  assert.equal(focusDayIndex(null, '2026-08-29'), null);
  // Dates were never set on this event; the last day is as good an answer as
  // any and stays consistent with the all-past case.
  assert.equal(focusDayIndex([{ dayIndex: 0 }, { dayIndex: 1 }], '2026-08-29'), 1);
});

/**
 * ⭐⭐ A FINISHED FESTIVAL OPENS ON ITS BIGGEST NIGHT (owner, 2026-09-01:
 * "show the main part of the festival, go the friday night or sat night").
 *
 * ⛔⛔ THE LAST DAY IS THE WIND-DOWN. Neverland Weekender runs two stages on
 * Friday and Saturday and three workshops on Sunday; opening on Sunday with
 * the LIVE stage selected showed an empty column on an event with 38 set
 * times.
 */
const FEST_SLOTS = [
  { dayIndex: 0, date: '2026-08-28', stages: [{ slots: new Array(8).fill({}) }, { slots: new Array(6).fill({}) }] },
  { dayIndex: 1, date: '2026-08-29', stages: [{ slots: new Array(10).fill({}) }, { slots: new Array(7).fill({}) }, { slots: new Array(4).fill({}) }] },
  { dayIndex: 2, date: '2026-08-30', stages: [{ slots: new Array(3).fill({}) }] },
];

/**
 * ⚠⚠ THIS ASSERTED THE BUSIEST DAY (1) UNTIL 2026-09-01, and the rule it
 * pinned was mine. By count Saturday IS bigger — nine live acts to Friday's
 * six — so it was choosing correctly and still produced the worse page.
 *
 * ⭐ A finished festival is READ, not navigated: it opens on the night it
 * opened on, which carries the Welcome to Country and the acts whose profiles
 * have artwork. Volume was the measurable thing, ⛔ not the right one.
 */
test('once it is over it opens on the OPENING night', () => {
  assert.equal(focusDayIndex(FEST_SLOTS, '2026-09-05'), 0, 'Friday opened the festival');
});

/**
 * ⛔ THE OPENING-NIGHT RULE NEVER OUTRANKS WHERE YOU ARE. These are questions
 * about the present, and a reader standing in the field on Sunday wants
 * Sunday — not the Friday that is already over.
 */
test('a running or upcoming festival still opens on today, or on its first day', () => {
  assert.equal(focusDayIndex(FEST_SLOTS, '2026-08-30'), 2, 'standing in Sunday');
  assert.equal(focusDayIndex(FEST_SLOTS, '2026-08-01'), 0, 'still to come');
});

/* ⚠ Bare days carry no slots, and those callers keep the old rule exactly. */
test('with no slot data a finished event still opens on the last day', () => {
  assert.equal(focusDayIndex(FEST, '2026-09-05'), 2);
});

/**
 * ⛔ THE OPENING NIGHT IS THE FIRST DAY WITH A PROGRAMME, ⛔ not `list[0]`. A
 * festival can carry a build day, or a day whose slots were never filled in,
 * and opening on an empty one is the blank the whole rule exists to avoid.
 */
test('a build day with nothing on it is skipped', () => {
  const withBuildDay = [
    { dayIndex: 0, date: '2026-08-27', stages: [{ slots: [] }] },
    { dayIndex: 1, date: '2026-08-28', stages: [{ slots: new Array(5).fill({}) }] },
    { dayIndex: 2, date: '2026-08-29', stages: [{ slots: new Array(9).fill({}) }] },
  ];
  assert.equal(focusDayIndex(withBuildDay, '2026-09-05'), 1);
});
