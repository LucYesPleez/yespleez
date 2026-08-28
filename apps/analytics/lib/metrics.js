/**
 * CANONICAL METRICS — pure. The audit's §6 definitions, as code.
 * ---------------------------------------------------------------------------
 * Given raw rows, a population and the classification, produce the
 * figures. No network, no clock: same rows + same segments = same
 * numbers forever. Every decision about what a number MEANS is here,
 * where it is tested — routes fetch and serve.
 *
 * ⛔ THE WORDS THAT MAY NOT APPEAR: no metric is called "users", and
 * devices are never presented as people. The names below are the
 * canonical vocabulary; surfaces print these names or nothing.
 */

import { inPopulation } from './identity.js';

export const SCHEMA_VERSION = 2;

/**
 * @param rows        raw usage_events rows:
 *                    {name, device_id, user_id, session_id, created_at, display_mode, platform}
 * @param opts.population  'public' | 'internal' | 'beta' | 'test' | 'all'
 * @param opts.segments    {users, devices} — see classify()
 * @param opts.linkedDevices Set of device_ids that have EVER carried an
 *                    account (from identity_links, all history). What
 *                    makes "anonymous visitor" mean never-authenticated
 *                    rather than merely signed-out-this-window. Absent →
 *                    the metric is omitted, never guessed (the audit's
 *                    absent-rather-than-zero rule).
 */
export function aggregate(rows, opts) {
  const o = opts || {};
  const segments = o.segments || {};
  const population = o.population || 'public';

  // ⚠ THE FILTER IS HERE, ONCE, BEFORE ANY ARITHMETIC — every figure
  // below derives from `kept`, so classification is consistent across
  // all of them and fully retroactive.
  const kept = [];
  for (const r of rows || []) {
    if (inPopulation(r, segments, population)) kept.push(r);
  }

  const people = new Set();
  const devices = new Set();
  const sessions = new Set();
  let nullSessionRows = 0;
  const byName = {};

  for (const r of kept) {
    if (r.user_id) people.add(r.user_id);
    if (r.device_id) devices.add(r.device_id);
    if (r.session_id) sessions.add(r.session_id); else nullSessionRows++;
    byName[r.name] = (byName[r.name] || 0) + 1;
  }

  const metrics = {
    events: kept.length,

    // ⭐ SIGNED-IN ACCOUNTS PRESENT — never "users". Anonymous browsing
    // is invisible to this figure by definition, and the name says so.
    authenticated_people: people.size,

    // One browser profile on one origin. Expected to multiply per
    // person (median 2 in production); NEVER a proxy for humans.
    devices: devices.size,

    // ⭐ distinct(session_id) — never count(session_end): lifecycle
    // pings fire per visibility change BY DESIGN (durability), and
    // counting them overcounted 15.7× (audit D7). The denominator
    // travels with the number so the 24 historical null-session rows
    // stay visible (D13).
    sessions: sessions.size,
    sessions_null_rows: nullSessionRows,

    by_name: byName,
  };

  // Anonymous visitors: devices seen in this population's rows that
  // have NEVER carried an account — all history, via the link table,
  // not merely this window. A device that authenticates next month
  // retroactively leaves this figure; that is the definition working,
  // not drift: "never" is a claim about all evidence held.
  if (o.linkedDevices instanceof Set) {
    let anon = 0;
    for (const d of devices) if (!o.linkedDevices.has(d)) anon++;
    metrics.anonymous_visitors = anon;
    // Reach = the two named parts, printed as a sum of named parts.
    metrics.reach = metrics.authenticated_people + anon;
  }

  return {
    schema_version: SCHEMA_VERSION,
    population,
    rows_considered: (rows || []).length,
    rows_in_population: kept.length,
    metrics,
  };
}
