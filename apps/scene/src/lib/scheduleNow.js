/**
 * ── ⭐⭐ WHERE THE NIGHT IS UP TO ────────────────────────────────────────────
 *
 * S3 · pure logic over the object `resolveSchedule` returns. Three states per
 * slot, and the owner's spec for them (2026-08-21):
 *
 *     PLAYED     the set is over          → muted
 *     PLAYING    the set is on now        → swells, and gets its vibrancy
 *     UPCOMING   the set has not started  → normal, the page's baseline
 *
 * ⛔ NOTHING HERE SCROLLS, ANIMATES OR RENDERS. It answers "what state is this
 * slot in at this instant" and stops. The emphasis moving down the page IS the
 * live behaviour — no auto-scroll, no chasing the reader.
 *
 * ⚠⚠ A SLOT HAS NO INSTANT. It has `time` ("11:00"), `ampm` ("PM"), `dur` in
 * minutes, a `day_index` and a `position`. Every instant below is DERIVED, and
 * the derivation is the whole of this file's difficulty.
 */

import { timeAxis, timeKey } from './schedulePortrait';

/** ⚠ Unknown, ⛔ not "no". Returned whenever the night cannot be placed on a
    clock at all — an unparseable event date, a slot whose time is free text
    nobody can read. Per the Rendering Contract, absent is not the same as
    false: an unplaceable schedule renders at its NORMAL weight, it does not
    render as "already played". */
export const UNKNOWN = null;

export const PLAYED = 'played';
export const PLAYING = 'playing';
export const UPCOMING = 'upcoming';

/**
 * ⭐⭐ THE PHASES OF A SET (owner, 2026-08-21). A finer reading than the three
 * states, for the card's own bottom strip:
 *
 *     READY      the 20 minutes leading up to the start
 *     STARTING   the first 10 minutes
 *     ENDING     the last 10 minutes
 *     FINISHED   just came off — the moment to offer the follow
 *
 * ⚠ MIDSET IS DELIBERATELY UNNAMED IN THE UI. A set that is simply running
 * needs no announcement; the progress bar already says how far through it is,
 * and a label that never changes for forty minutes stops being read.
 */
export const READY = 'ready';
export const STARTING = 'starting';
export const MIDSET = 'midset';
export const ENDING = 'ending';
export const FINISHED = 'finished';

/** How long before a set the room starts getting ready. */
export const READY_MINS = 20;
/** The first-and-last window that earns STARTING and ENDING. */
export const EDGE_MINS = 10;
/**
 * ⭐ How long the follow offer lives after a set ends.
 *
 * ⚠⚠ A WINDOW, ⛔ NOT FOREVER. The offer works because the audience JUST
 * watched them; an hour later it is a follow button bolted to a history entry,
 * and by the end of the night every played card would carry one. ⛔ Do not
 * "simplify" this to every played set.
 */
export const FOLLOW_MINS = 15;

/**
 * Minutes past midnight for a slot's printed time, or null.
 *
 * ⚠ 12 IS THE AWKWARD ONE, IN BOTH DIRECTIONS. 12:30 AM is 30 minutes past
 * midnight and 12:30 PM is 12h30 — the hour wraps to 0 before the PM offset is
 * added, and getting that backwards moves a midnight set half a day.
 *
 * ⚠ A MISSING `ampm` IS NOT AN ERROR to guess at. Without it "1:00" could be
 * either end of the day; this returns null and the slot reads as UNKNOWN
 * rather than being placed twelve hours from where it belongs.
 */
export function clockMinutes(time, ampm) {
  const m = /^\s*(\d{1,2})\s*[:.]?\s*(\d{2})?\s*$/.exec(String(time ?? ''));
  if (!m) return null;
  const hour = Number(m[1]);
  const mins = Number(m[2] ?? 0);
  if (hour > 12 || hour < 1 || mins > 59) {
    /* 24-hour input is not what the editor writes, but it is what somebody
       will eventually type. Accept an unambiguous 0–23 with no meridiem. */
    if (!ampm && hour >= 0 && hour <= 23 && mins <= 59) return hour * 60 + mins;
    return null;
  }
  const mer = String(ampm ?? '').trim().toUpperCase();
  if (mer !== 'AM' && mer !== 'PM') return null;
  const h12 = hour % 12;                       // 12 AM → 0, 12 PM → 0 (+12 below)
  return (mer === 'PM' ? h12 + 12 : h12) * 60 + mins;
}

/**
 * ⭐⭐ THE ROLLOVER RULE, AND IT IS THE REASON THIS IS NOT A ONE-LINER.
 *
 * A night crosses midnight. Solstice's SATURDAY list ends at 1:00 AM, which
 * happens on Sunday's clock — the slot belongs to Saturday's LIST and to
 * Sunday's DAY. So walking the day's columns in the order the schedule
 * actually runs, the first time the clock goes BACKWARDS the night has rolled
 * over, and everything after it is on the next calendar day.
 *
 * ⚠⚠ THE ORDER COMES FROM `position`, ⛔ NEVER from sorting the clock. That is
 * `timeAxis`'s own law, restated because the temptation here is stronger: any
 * numeric sort files 1:00 AM before 4:00 PM and rewrites the evening, and then
 * the rollover it is meant to detect can never happen.
 *
 * ⛔⛔ THE WALK IS PER STAGE. THE ANSWER IS SHARED. Both halves matter, and
 * getting the first one wrong is what broke Neverland (owner, 2026-08-28: "2
 * stages so 2 slots should be lit up").
 *
 * ⚠⚠ WHY THE WALK CANNOT BE THE AXIS. `timeAxis` lists each stage's times in
 * turn, first seen wins — it is a set of COLUMNS, and its order is stage
 * order, ⛔ not running order. Walking it, Neverland's Friday read:
 *
 *     4:30 PM · 5 · 6 · 7 · 8 · 9 · 10:30 · 11:30 PM   (LIVE, in order)
 *     7:30 PM                                          (DJ's first new time)
 *     12:00 AM
 *
 * The clock "went backwards" at 7:30 PM purely because a second room was
 * appended after the first room's midnight, so the rollover fired and the DJ
 * stage's 7:30 set was placed on SATURDAY. At 7:46 PM on the Friday, LIVE
 * STAGE lit up and DJ STAGE could not: its set was a day away. ⛔ A stage's
 * position among other stages must never move it in time.
 *
 * ⭐ One STAGE, though, is a room's night in running order, and there a clock
 * that goes backwards genuinely means midnight passed. So each stage carries
 * its own rollover.
 *
 * ⭐⭐ THEN THE ROW IS RECONCILED, which is the half the shared axis was right
 * about: one printed time is ONE instant on the grid, or the same 1:00 AM is
 * two different moments depending which room you read it in. Where stages
 * disagree the LATER reading wins — a night moves forward, so a room listing
 * only 1:00 AM inside a night that crossed midnight means that 1:00 AM, not
 * the one seventeen hours before the doors opened.
 *
 * Returns a Map of column key → minutes from the day's own midnight, which may
 * exceed 24h. ⚠ Null for a time nobody can read: UNKNOWN, ⛔ never a guess.
 */
export function axisOffsets(day) {
  const out = new Map();
  for (const col of timeAxis(day)) out.set(col.key, null);

  for (const stage of day?.stages || []) {
    let carry = 0;
    let prev = null;
    for (const entry of stage?.slots || []) {
      const mins = clockMinutes(entry?.slot?.time, entry?.slot?.ampm);
      if (mins == null) continue;                        // UNKNOWN: left null
      if (prev != null && mins < prev) carry += 24 * 60;
      prev = mins;
      const key = timeKey(entry.slot);
      const seen = out.get(key);
      out.set(key, seen == null ? mins + carry : Math.max(seen, mins + carry));
    }
  }
  return out;
}

/**
 * The wall-clock instant a day's midnight falls on, as local time.
 *
 * ⛔⛔ BUILT FROM LOCAL PARTS, NEVER FROM A SLICE OF A TIMESTAMP. `new
 * Date('2026-08-21')` is parsed as UTC and is the PREVIOUS evening in AEST —
 * the same bug that once filed every event happening today as past. The date
 * is read with a regex and handed to the local-time constructor, which is what
 * `lib/dates.js` exists to keep honest.
 *
 * ⭐ TAKES THE DAY'S OWN DATE, ⛔ not the event's date plus an index. `dayDate`
 * in `scheduleModel` already did that arithmetic and put the answer on
 * `day.date`; redoing it here would be two answers to one question, and the
 * day this module has to grow gap days (S6's `event_days`) it would be the one
 * that quietly kept guessing "date + N".
 */
export function dayMidnight(dayDateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dayDateStr ?? '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A slot's start and end as epoch ms, or null when it cannot be placed. */
export function slotWindow(day, entry) {
  const base = dayMidnight(day?.date);
  if (!base) return null;
  const offset = axisOffsets(day).get(timeKey(entry?.slot));
  if (offset == null) return null;
  const start = base.getTime() + offset * 60_000;
  const dur = Number(entry?.slot?.dur);
  /* ⚠ A slot with no readable duration still has a START, so it can still be
     "next" and still be "played" once the following set begins. Zero-length is
     the honest reading: it is never PLAYING, because nothing says how long it
     runs. ⛔ Do not default to 60 here — `toRenderSlot` already decided that
     question upstream, and deciding it twice is how two answers diverge. */
  return { start, end: start + (Number.isFinite(dur) && dur > 0 ? dur : 0) * 60_000 };
}

/**
 * ⭐⭐ THE LIVE TREATMENT ONLY ENGAGES WHILE THE NIGHT IS RUNNING.
 *
 * ⚠⚠ Without this, every past event on the site renders as a wall of muted,
 * greyed-out cards forever — which reads as broken, or as data failing to
 * load, rather than as "this happened". A finished night is ARCHIVE: every
 * card back to normal weight, exactly as it looks before doors.
 *
 * ⚠ It also quietly contains the timezone problem. Events carry no timezone
 * (S2 defers it), so "now" is the READER'S device clock — right for the case
 * that matters, someone standing at the gig, and harmlessly inert for someone
 * reading a Melbourne lineup from Perth, because outside the window nothing is
 * marked at all.
 */
export function nightIsRunning(day, now) {
  const windows = allWindows(day);
  if (!windows.length) return false;
  const first = Math.min(...windows.map(w => w.start));
  const last = Math.max(...windows.map(w => w.end));
  return now >= first && now <= last;
}

function allWindows(day) {
  const out = [];
  for (const stage of day?.stages || []) {
    for (const entry of stage.slots || []) {
      const w = slotWindow(day, entry);
      if (w) out.push(w);
    }
  }
  return out;
}

/**
 * ⭐ THE ONE FUNCTION A VIEW CALLS. Returns a Map of slot id → state, or an
 * empty Map when nothing should be marked.
 *
 * ⚠ A GAP IS NOT A STATE. A stage with nothing on at 11PM has no slot there,
 * so it appears in no map — the hatched NOTHING ON cell keeps saying exactly
 * what it said before, which is the truth about that stage at that moment.
 *
 * ⚠ MORE THAN ONE SLOT MAY BE PLAYING, and that is correct: three stages at
 * 9:00 PM are three sets playing at once. ⛔ Nothing here picks a winner.
 */
export function slotStates(day, now) {
  const states = new Map();
  if (!nightIsRunning(day, now)) return states;
  for (const stage of day?.stages || []) {
    for (const entry of stage.slots || []) {
      const w = slotWindow(day, entry);
      if (!w) continue;                                    // UNKNOWN: unmarked
      states.set(entry.slot.id, readSlot(w, now));
    }
  }
  return states;
}

/**
 * ⭐ ONE SLOT'S WHOLE STORY at an instant: `{ state, phase, progress }`.
 *
 * ⚠ `progress` MEASURES THE SET AND ONLY THE SET — 0 before it starts, 1 once
 * it is over. ⛔ It does NOT switch to counting down the run-up during READY:
 * a bar that silently changes what it is measuring is a bar nobody can read.
 * So a card getting ready shows an empty bar and says so in words.
 *
 * ⚠⚠ THE EDGES SHRINK FOR A SHORT SET. A 15-minute slot cannot have a
 * 10-minute start AND a 10-minute end — they would overlap and the set would be
 * STARTING and ENDING at once. The edge is capped at half the set, so a short
 * one simply flips from starting to ending at its midpoint.
 */
export function readSlot(w, now) {
  const len = w.end - w.start;
  if (now >= w.end) {
    return {
      state: PLAYED,
      phase: now < w.end + FOLLOW_MINS * 60_000 ? FINISHED : null,
      progress: 1,
    };
  }
  if (now >= w.start) {
    const edge = Math.min(EDGE_MINS * 60_000, len / 2);
    const phase = now < w.start + edge ? STARTING : now >= w.end - edge ? ENDING : MIDSET;
    return { state: PLAYING, phase, progress: len > 0 ? (now - w.start) / len : 0 };
  }
  return {
    state: UPCOMING,
    phase: now >= w.start - READY_MINS * 60_000 ? READY : null,
    progress: 0,
  };
}

/**
 * ⭐ THE WORDS LIVE WITH THE RULE THAT PICKS THEM, so a phase cannot be renamed
 * in one place and left alone in the other.
 * ⛔ No em dashes, and ⛔ nothing for MIDSET — see the note on the constants.
 */
export function phaseLabel(phase) {
  return {
    [READY]: 'GETTING READY',
    [STARTING]: 'STARTING',
    [ENDING]: 'ENDING',
  }[phase] || null;
}

/**
 * ⭐⭐ WHICH DAY THE SCHEDULE SHOULD OPEN ON (owner, 2026-08-28: "users
 * shouldn't have to scroll past Friday time slots to get to today").
 *
 * ⚠⚠ THE PEEK USED TO PICK `days[0]`, so on the Saturday of a three-day
 * festival it opened on Friday — the day that had already happened — and the
 * reader had to scroll a finished night to reach the one they were standing in.
 *
 * The rule, in order:
 *   1. TODAY, if the event is running on it.
 *   2. Otherwise the NEXT day still to come — before the festival starts, that
 *      is day one, which is what a reader planning ahead wants.
 *   3. Otherwise the LAST day. The whole event is over; its final night is the
 *      most recent thing that happened, and ⛔ opening a finished festival on
 *      its first day would be the same mistake in the other direction.
 *
 * ⚠ Compared as `YYYY-MM-DD` STRINGS against the LOCAL date, ⛔ never
 * `toISOString()` — that is UTC, which reads as yesterday every Australian
 * morning and would open the schedule on the wrong day for half the day.
 *
 * @param days  the resolved schedule's days, each with a `date` string
 * @param todayStr `dates.today()` — passed in so this stays pure and testable
 * @returns the chosen day's `dayIndex`, or null when there are no days
 */
export function focusDayIndex(days = [], todayStr = '') {
  const list = (days || []).filter(Boolean);
  if (!list.length) return null;

  const onToday = list.find(d => d.date && d.date === todayStr);
  if (onToday) return onToday.dayIndex;

  const upcoming = list.find(d => d.date && d.date > todayStr);
  if (upcoming) return upcoming.dayIndex;

  /* ⚠ Every day is in the past — or none of them carries a date at all, which
     is a real state on an event whose dates were never set. The last day is the
     honest answer to the first case; for the second, `list[0]` would be as
     arbitrary as anything, so the LAST stays consistent with it. */
  return list[list.length - 1].dayIndex;
}
