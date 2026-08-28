/**
 * ── ⭐⭐ THE SCHEDULE, RESOLVED ONCE ─────────────────────────────────────────
 *
 * S3 · the canonical consumer of the canonical model (S2 ratified 2026-08-20,
 * `Claude Cowork\scheduling-architecture-s2-decision-2026-08-20.md`).
 *
 * ⭐⭐ ONE SCHEDULING MODEL, MANY VIEWS. Portrait (time horizontal, stages
 * stacked), landscape (stages as columns, time vertical), single-stage list,
 * multi-day, and every future Festival surface are PROJECTIONS of the object
 * this module returns. ⛔ A view may choose what to draw; it may not decide
 * what the schedule IS, and it may never fetch a second time to find out.
 *
 * ⛔⛔ NOT A REPLACEMENT FOR `groupSlotsIntoDays`. That function feeds the host
 * editor's `DaySlots`/`SlotCard`, which take `{ name, slots }` and keep taking
 * exactly that. This adds the STAGE AXIS for the public projections without
 * touching the editing path — a data reshape and a UI rewrite landing together
 * is how you lose the ability to say which of them broke something (the rule
 * `eventSlots.js` was written under, and it still holds).
 *
 * ⚠ PURE. No supabase client, no React, no formatting decisions beyond the day
 * date. Everything here is a function of its arguments, so the whole schedule
 * is testable without a browser — which is the point, given the one production
 * event that has a schedule keeps its set times private.
 */

import { toRenderSlot } from './eventSlots';

/**
 * ⭐⭐ NULL `stage_id` MEANS THE EVENT'S SINGLE IMPLICIT STAGE (S2 §3).
 *
 * An event with NO `event_stages` rows is a single-stage event, and its views
 * render no stage chrome at all — no names, no columns, no colour coding. That
 * is not a fallback for missing data; it is the correct reading of every event
 * that exists today, and of every pub gig that ever will.
 */
export const IMPLICIT_STAGE_ID = null;

/**
 * ⚠ A DAY'S DATE IS DERIVED, NOT STORED. `event_slots` carries `day_index`, an
 * integer, and days are assumed contiguous: day N is the event's date plus N.
 *
 * ⛔ NEVER `toISOString().slice(0, 10)` here. That is the UTC date, and east of
 * Greenwich it is a different day from the one the Date represents — the whole
 * reason `localDateStr` exists in lib/dates.js. This builds the string from the
 * local parts for the same reason.
 *
 * ⚠ Returns null rather than guessing when the event's own date is unparseable
 * — `config.date` is free text in JSONB and a year 0006 is on record. A day
 * with no resolvable date still renders; it just does not claim one.
 *
 * ⚠ DEFERRED (S6): festivals with gap days need `event_days(day_index, date)`.
 * The upgrade path is deliberate — `day_index` stays the join key, so a lookup
 * replaces this arithmetic and nothing else changes.
 */
export function dayDate(eventDate, dayIndex) {
  if (!eventDate || typeof eventDate !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(eventDate.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + (Number(dayIndex) || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Stage rows → display order. ⚠ `position` first, name only to break a tie. */
function orderStages(stages = []) {
  return (stages || [])
    .filter(Boolean)
    .map(s => ({
      id:       s.id,
      name:     s.name || '',
      accent:   s.accent || null,
      position: s.position ?? 0,
      implicit: false,
    }))
    .sort((a, b) => (a.position - b.position) || String(a.name).localeCompare(String(b.name)));
}

/**
 * ⭐ THE RESOLVER. Rows in, one schedule out.
 *
 * @param slots   `event_slots` rows (any order)
 * @param stages  `event_stages` rows for the event (empty = single-stage)
 * @param claims  { [slot uuid]: claim } — the occupant map, already keyed on
 *                `performances.slot_uuid` by `indexPerformances`. ⛔ This module
 *                does not build it: who occupies a slot is a participation
 *                question, and `eventSlots.js` already answers it deterministically.
 * @param eventDate  `config.date`, for deriving each day's date. Optional.
 *
 * @returns {{
 *   days: Array<{ dayIndex, name, date, stages: Array<{
 *     id, name, accent, position, implicit,
 *     slots: Array<{ slot, claim }>
 *   }> }>,
 *   stageCount, isMultiStage, isMultiDay, slotCount, unstagedOnStagedEvent
 * }}
 */
export function resolveSchedule({ slots = [], stages = [], claims = {}, eventDate = null } = {}) {
  const rows = (slots || []).filter(Boolean);
  const ordered = orderStages(stages);
  const staged = ordered.length > 0;

  /* ⚠⚠ A SLOT WITH NO STAGE ON AN EVENT THAT HAS STAGES IS AN INVALID STATE,
     and it is RENDERED ANYWAY. S2 §3 prevents it at the write layer (creating
     an event's first stage adopts its existing slots, atomically) — but a
     reader that drops rows it disapproves of makes a real booking vanish from
     the schedule with no trace. It buckets under the first stage and is
     COUNTED, so a caller can surface it instead of the page lying. */
  let unstagedOnStagedEvent = 0;

  const byDay = new Map();
  for (const r of rows) {
    const idx = r.day_index ?? 0;
    if (!byDay.has(idx)) {
      byDay.set(idx, { dayIndex: idx, name: r.day_name || '', rows: [] });
    }
    byDay.get(idx).rows.push(r);
  }

  const days = [...byDay.values()]
    .sort((a, b) => a.dayIndex - b.dayIndex)
    .map(day => {
      const buckets = staged
        ? ordered.map(s => ({ ...s, slots: [] }))
        /* The implicit stage: one bucket, no identity to render. */
        : [{ id: IMPLICIT_STAGE_ID, name: '', accent: null, position: 0, implicit: true, slots: [] }];

      const byStageId = new Map(buckets.map(b => [b.id, b]));

      /* ⚠⚠ SORTED HERE, ON THE ROW, ⛔ not on the rendered slot afterwards.
         `toRenderSlot` does not carry `position` — it is an ordering fact, not
         a display one — so a sort applied after the map compares `undefined`
         and silently leaves the schedule in whatever order the query returned.
         Sorting the rows once, before bucketing, also means each bucket keeps
         the organiser's order by construction. */
      const inOrder = [...day.rows].sort((a, z) => (a.position ?? 0) - (z.position ?? 0));

      for (const r of inOrder) {
        let bucket;
        if (!staged) {
          bucket = buckets[0];
        } else {
          bucket = byStageId.get(r.stage_id);
          if (!bucket) {
            /* Either a NULL stage_id, or one pointing at a stage this reader
               was not given (an unfetched or deleted row). Both land first. */
            unstagedOnStagedEvent += 1;
            bucket = buckets[0];
          }
        }
        bucket.slots.push({
          slot:  toRenderSlot(r, bucket.name),
          claim: claims?.[r.id] ?? null,
        });
      }

      return {
        dayIndex: day.dayIndex,
        name:     day.name,
        date:     dayDate(eventDate, day.dayIndex),
        stages:   buckets,
      };
    });

  return {
    days,
    stageCount:   ordered.length,
    /* ⚠ MULTI-STAGE MEANS MORE THAN ONE, ⛔ not "has stages". An event with a
       single named stage is still a single-stage event for every layout
       decision — naming your one room does not earn festival chrome. */
    isMultiStage: ordered.length > 1,
    isMultiDay:   days.length > 1,
    slotCount:    rows.length,
    unstagedOnStagedEvent,
  };
}

/**
 * ⭐ WHICH PROJECTION THIS SCHEDULE WANTS — the ONE place that decides, so
 * portrait, landscape and the event-page embed cannot disagree about what kind
 * of event they are drawing.
 *
 * ⛔ ORIENTATION IS NOT PASSED IN. It is a rendering choice the view makes with
 * a media query; this answers only what the DATA supports. A single-stage
 * event has no stage columns to show in landscape, so landscape stays a plain
 * timeline (brief §7) — ⛔ do not synthesise an empty stage column to make the
 * two orientations symmetrical.
 */
export function scheduleShape(resolved) {
  const r = resolved || {};
  return {
    hasSchedule:  (r.slotCount ?? 0) > 0,
    showStages:   !!r.isMultiStage,
    showDayPicker: !!r.isMultiDay,
    /* The event page embeds a short schedule and links out to a long one.
       ⚠ Counted in SLOTS, not days: eight slots on one day is long, and two
       days of two is not. The threshold lives here so the embed and the
       expand control can never disagree about which is showing. */
    embedInline:  (r.slotCount ?? 0) > 0 && (r.slotCount ?? 0) <= INLINE_SLOT_MAX && !r.isMultiStage,
  };
}

/** ⚠ Must match nothing else — it is the only definition. See `scheduleShape`. */
export const INLINE_SLOT_MAX = 6;
