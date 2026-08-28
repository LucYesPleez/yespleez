/**
 * DAILY SERIES — pure. The same canonical metrics, grouped by Sydney day.
 * ---------------------------------------------------------------------------
 * No new storage: a day is a read-time grouping of raw events, exactly
 * as a week is — weeks stay the PERMANENT artefacts (snapshots), days
 * are derived on demand and never stored, so there is no second copy
 * of history to drift.
 *
 * ⭐ DAYS ARE SYDNEY DAYS. `weeks.cjs` owns the calendar (localDate);
 * a UTC slice would file every AU morning until 10/11am under
 * yesterday — the exact bug the dates law exists to prevent.
 *
 * ⛔ A quiet day is a ZERO ROW, not an absent one. A chart built on
 * absent days silently compresses time; the series carries every
 * calendar day in the window, empty or not.
 */

import { aggregate } from './metrics.js';
import WEEKS from './weeks.cjs';

/**
 * @param rows  raw usage_events for the window (any order)
 * @param opts  {population, segments, linkedDevices, fromDay, toDay}
 *              fromDay/toDay: 'YYYY-MM-DD' Sydney calendar days, inclusive.
 * @returns     [{day, weekday, metrics, rows_in_population}] oldest first
 */
export function dailySeries(rows, opts) {
  const { population, segments, linkedDevices, fromDay, toDay } = opts;

  // Bucket once, by the Sydney calendar day of each event.
  const buckets = new Map();
  for (const r of rows || []) {
    const day = WEEKS.localDate(new Date(r.created_at));
    if (day < fromDay || day > toDay) continue;
    if (!buckets.has(day)) buckets.set(day, []);
    buckets.get(day).push(r);
  }

  // Every calendar day in the range, present even when empty.
  const out = [];
  let d = new Date(fromDay + 'T12:00:00+10:00'); // midday dodges DST edges
  for (;;) {
    const day = WEEKS.localDate(d);
    if (day > toDay) break;
    const agg = aggregate(buckets.get(day) || [], { population, segments, linkedDevices });
    out.push({
      day,
      weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][WEEKS.sydneyParts(d).weekday],
      metrics: agg.metrics,
      rows_in_population: agg.rows_in_population,
    });
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}
