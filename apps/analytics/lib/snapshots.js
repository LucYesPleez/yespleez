/**
 * V2 SNAPSHOTS — pure assembly. One week, one population, one artefact.
 * ---------------------------------------------------------------------------
 * Reuses the canonical aggregate() (so T16 holds by construction: the
 * snapshot and the live summary literally share their arithmetic) and
 * the Sydney week model carried over verbatim from Studio's
 * analytics-weeks.cjs — Monday 00:00 Sydney, DST-aware, 167/169-hour
 * weeks computed in local time. Studio's copy retires with its
 * scheduler; this one is now the canonical copy.
 *
 * ⭐ THE CLASSIFICATION IS FROZEN IN. segments_used records exactly the
 * users/devices maps the week was computed with, so reclassifying an
 * account tomorrow cannot move last month's figures. New
 * classifications apply to new generations, and to explicit rebuilds
 * that say why.
 */

import { aggregate, SCHEMA_VERSION } from './metrics.js';
import WEEKS from './weeks.cjs';

export { SCHEMA_VERSION, WEEKS };

/**
 * Build one snapshot row (minus generated_at, which the database owns).
 *
 * @param rows          raw usage_events ALREADY bounded to [startUTC, endUTC)
 *                      by the caller — the week rules live in one place
 *                      (weeks.cjs) and are not re-derived here.
 * @param opts          {population, segments, linkedDevices, week, finalised, reason}
 */
export function buildSnapshot(rows, opts) {
  const { population, segments, linkedDevices, week, finalised = false, reason = null } = opts;
  const agg = aggregate(rows, { population, segments, linkedDevices });
  return {
    schema_version: SCHEMA_VERSION,
    population,
    week_start: week.weekStart,
    week_end: week.weekEnd,
    metrics: agg.metrics,
    segments_used: {
      users: segments.users || {},
      internal_devices: Object.keys(segments.devices || {}).length,
    },
    rows_considered: agg.rows_considered,
    rows_in_population: agg.rows_in_population,
    finalised,
    rebuild_reason: reason,
  };
}

/**
 * THE PARTITION PROPERTY — the rebuild's self-check. public, internal,
 * beta and test partition every row (classify returns exactly one
 * segment), so their event counts must sum to `all`'s, per week. A
 * failure here means the classifier and the populations disagree, and
 * the rebuild must not be trusted.
 */
export function partitionHolds(byPopulation) {
  const parts = ['public', 'internal', 'beta', 'test']
    .map((p) => byPopulation[p]?.metrics?.events ?? 0)
    .reduce((a, b) => a + b, 0);
  const all = byPopulation.all?.metrics?.events ?? 0;
  return parts === all;
}
