/**
 * AREAS — pure. What places people ASK the scene for.
 * ---------------------------------------------------------------------------
 * Demand geography, not surveillance geography. The platform stores no
 * IP and no geolocation (A1, deliberately); what it does record is the
 * region facets of `filtered` events — a normalised region when the
 * filter APPLIED, a `region_intent` when the person asked for a place
 * the search could not use, and a bare `region_unresolved` flag when
 * they typed somewhere the suburb vocabulary does not know (the flag
 * only — never the text).
 *
 * So this answers "what areas are people interested in", which is the
 * bookable question — not "where were they sitting", which the
 * platform cannot and will not answer.
 *
 * ⚠ ASKED and APPLIED are different claims and stay separate columns:
 * an intent that never applies is a coverage gap, and folding it into
 * the applied count would hide exactly the signal it carries.
 */

import { inPopulation } from './identity.js';

/**
 * @param rows raw usage_events (mixed names fine — only `filtered` reads)
 * @param opts {population, segments}
 * @returns {regions, states, unresolved, searches, searches_with_region}
 */
export function areaBreakdown(rows, opts) {
  const { population, segments } = opts || {};
  const regions = new Map();  // name -> {applied, asked, devices:Set}
  const states = new Map();   // state facet -> count
  let unresolved = 0;
  let searches = 0;
  let withRegion = 0;

  const bump = (name, kind, deviceId) => {
    let r = regions.get(name);
    if (!r) { r = { region: name, applied: 0, asked: 0, devices: new Set() }; regions.set(name, r); }
    r[kind]++;
    if (deviceId) r.devices.add(deviceId);
  };

  for (const row of rows || []) {
    if (row.name !== 'filtered') continue;
    if (!inPopulation(row, segments, population)) continue;
    searches++;
    const p = row.props || {};
    let touched = false;
    if (typeof p.region === 'string') { bump(p.region, 'applied', row.device_id); touched = true; }
    if (typeof p.region_intent === 'string') { bump(p.region_intent, 'asked', row.device_id); touched = true; }
    if (p.region_unresolved === true) { unresolved++; touched = true; }
    if (typeof p.state === 'string') states.set(p.state, (states.get(p.state) || 0) + 1);
    if (touched) withRegion++;
  }

  return {
    searches,
    searches_with_region: withRegion,
    unresolved,
    regions: [...regions.values()]
      .map((r) => ({ region: r.region, applied: r.applied, asked: r.asked, devices: r.devices.size }))
      .sort((a, b) => (b.applied + b.asked) - (a.applied + a.asked) || a.region.localeCompare(b.region)),
    states: [...states.entries()]
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count),
  };
}
