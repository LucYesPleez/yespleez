/**
 * THE RECONCILIATION GATE — AV3's exit condition, runnable any time.
 * ---------------------------------------------------------------------------
 * The v2 classifier + metrics must reproduce the audit's corrected
 * production figures EXACTLY. Same code path the live summary uses —
 * aggregate() over classify() — fed the audit's frame:
 *
 *   asOf     2026-08-28T23:59:59Z   (the audit's "now")
 *   segments the audit-era classification: ONLY the operator account
 *            internal, devices derived from that account's links
 *
 * Mads was classified on 28 Aug AFTER the audit measured, so the gate
 * runs under the audit's classification — reproducing a historical
 * figure means reproducing its inputs, not today's. The live summary
 * (current classification, Mads excluded) is printed alongside for the
 * record; it is EXPECTED to differ and its differing is correct.
 *
 * Usage:  node --env-file=.env reconcile.js
 * Exit 0 = gate passed. Exit 1 = STOP, diagnose, fix, rerun.
 */

import { makeDb } from './lib/db.js';
import { deriveDeviceSegments } from './lib/identity.js';
import { aggregate } from './lib/metrics.js';

const OP = '94a88288-43aa-445b-abb8-7dc895804b51';
const AS_OF = '2026-08-28T23:59:59Z';

// The audit's corrected figures, verbatim from the approved build prompt.
const EXPECTED = {
  7:     { authenticated_people: 12, sessions: 221, events: 5334 },
  30:    { authenticated_people: 29, sessions: 542, events: 10398 },
  all:   { authenticated_people: 33, sessions: 739, events: 12843 },
};

const db = makeDb({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY });

const [events, links, segs] = await Promise.all([
  db.readAll(
    'usage_events?select=name,device_id,user_id,session_id,created_at' +
    '&created_at=lte.' + encodeURIComponent(AS_OF) + '&order=id.asc',
    { schema: 'public' }
  ),
  db.readAll('identity_links?select=device_id,user_id&order=id.asc'),
  db.readAll('account_segments?select=user_id,segment&order=user_id.asc'),
]);
if (!events.complete) { console.error('STOP: raw read incomplete (' + events.rows.length + '/' + events.total + ')'); process.exit(1); }
console.log('raw rows ≤ asOf: ' + events.rows.length + ' (complete) · links: ' + links.rows.length);

/**
 * PIN THE AUDIT'S DATASET. The audit measured a live table at an
 * instant; rows have kept arriving since (they are real usage, not
 * noise). The gate's question is "does the same code over the same
 * evidence produce the same figures" — so it runs on the exact prefix
 * the audit saw: the first 41,444 rows in insertion order. The live
 * columns run on everything and are expected to drift upward daily.
 */
const AUDIT_ROWS = 41444;
const auditRows = events.rows.slice(0, AUDIT_ROWS);
if (events.rows.length !== AUDIT_ROWS) {
  console.log((events.rows.length - AUDIT_ROWS) + ' row(s) postdate the audit fetch — gate pinned to the first ' + AUDIT_ROWS + '.');
}

// Audit-era classification: operator internal, nobody else.
const auditUsers = { [OP]: 'internal' };
const auditSegments = { users: auditUsers, devices: deriveDeviceSegments(links.rows, auditUsers) };
// Current classification, for the record.
const nowUsers = {};
segs.rows.forEach((r) => { nowUsers[r.user_id] = r.segment; });
const nowSegments = { users: nowUsers, devices: deriveDeviceSegments(links.rows, nowUsers) };
const linkedDevices = new Set(links.rows.map((l) => l.device_id));

const asOfMs = Date.parse(AS_OF);
const windowRows = (set, days) => days === 'all'
  ? set
  : set.filter((r) => Date.parse(r.created_at) >= asOfMs - days * 86400000);

let failed = false;
for (const key of [7, 30, 'all']) {
  const gate = aggregate(windowRows(auditRows, key), { population: 'public', segments: auditSegments, linkedDevices });
  const live = aggregate(windowRows(events.rows, key), { population: 'public', segments: nowSegments, linkedDevices });
  const got = {
    authenticated_people: gate.metrics.authenticated_people,
    sessions: gate.metrics.sessions,
    events: gate.metrics.events,
  };
  const want = EXPECTED[key];
  const ok = Object.keys(want).every((k) => got[k] === want[k]);
  if (!ok) failed = true;
  console.log(
    (ok ? 'PASS' : 'FAIL') + '  ' + String(key).padStart(3) + 'd  ' +
    'people ' + got.authenticated_people + '/' + want.authenticated_people +
    ' · sessions ' + got.sessions + '/' + want.sessions +
    ' · events ' + got.events + '/' + want.events +
    '   [live, Mads excluded: people ' + live.metrics.authenticated_people +
    ' · sessions ' + live.metrics.sessions + ' · events ' + live.metrics.events +
    ' · visitors ' + live.metrics.anonymous_visitors + ']'
  );
}

if (failed) { console.error('\nGATE FAILED — stop, diagnose, fix, rerun. Do not proceed to AV4.'); process.exit(1); }
console.log('\nGATE PASSED — the v2 implementation reproduces the audit. AV4 is unblocked.');
