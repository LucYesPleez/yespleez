import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normaliseStatus, rawStatusesFor, bucketsFor, PIPELINE_BUCKETS, isUndecided } from './enquiryUtils.js';

/**
 * THE TABS THAT WERE PERMANENTLY EMPTY.
 *
 * Measured in production 2026-08-15: `applications.status` holds
 * `accepted 9 · shortlisted 1 · confirmed 1 · declined 1 · seen 1`.
 * The code filtered `pending` (PIPELINE) and `tentative` (SHORT LIST) — both
 * ZERO rows — so both tabs were empty on every event, while real applications
 * sat underneath them. `ApplicationsScreen` additionally offered a REJECTED tab
 * filtering a value nothing has ever written.
 *
 * These tests are written against the ACTUAL production values, not invented
 * ones, because a synthetic fixture using the code's own vocabulary would have
 * passed against the broken filters.
 */

/** Exactly what production holds, with counts, as measured. */
const PRODUCTION = [
  ['accepted', 9], ['shortlisted', 1], ['confirmed', 1], ['declined', 1], ['seen', 1],
];

/** Every value any writer in the codebase can emit, both vocabularies. */
const EVERY_WRITABLE = [
  'pending',                                  // ApplyButton, ArtistDashboard, DB default
  'tentative',                                // EventHostView SHORTLIST, acceptInvite, declineSlotOffer
  'offered',                                  // doAssign, publishSetTimes
  'confirmed',                                // acceptSlotOffer
  'declined', 'rejected',                     // host declines, both spellings
  'seen', 'shortlisted', 'accepted', 'cancelled',   // EnquiryCard
];

const bucket = status => normaliseStatus({ status, direction: 'incoming' });

test('⚠⚠ every production status lands in a real bucket', () => {
  for (const [status] of PRODUCTION) {
    const b = bucket(status);
    assert.ok(bucketsFor('incoming').includes(b), `${status} -> ${b} is not a bucket`);
  }
});

test('the PIPELINE and SHORT LIST tabs are no longer empty against real data', () => {
  const rows = PRODUCTION.flatMap(([status, n]) => Array.from({ length: n }, () => ({ status })));
  const inNew         = rows.filter(r => bucket(r.status) === 'new').length;
  const inShortlisted = rows.filter(r => bucket(r.status) === 'shortlisted').length;
  const inAccepted    = rows.filter(r => bucket(r.status) === 'accepted').length;
  const inDeclined    = rows.filter(r => bucket(r.status) === 'declined').length;
  const inSeen        = rows.filter(r => bucket(r.status) === 'seen').length;

  assert.equal(inShortlisted, 1, 'SHORT LIST: the one shortlisted application, which used to be invisible');
  assert.equal(inSeen, 1);
  // 9 accepted + 1 confirmed. ⚠ `confirmed` normalises to accepted for DISPLAY
  // only — it is not evidence of a host decision, and must NOT be written back
  // to the row. See the forensic trace of application f8e03ca7.
  assert.equal(inAccepted, 10);
  assert.equal(inDeclined, 1);
  assert.equal(inNew, 0, 'nothing is undecided today, which is true and not a bug');
  assert.equal(inNew + inShortlisted + inAccepted + inDeclined + inSeen, 13, 'every row has a home');
});

test('⛔ no application can become invisible by being spelled differently', () => {
  for (const status of EVERY_WRITABLE) {
    const b = bucket(status);
    assert.ok(bucketsFor('incoming').includes(b), `${status} has no bucket`);
  }
  // And a value nobody has ever written still lands somewhere rather than vanishing.
  assert.equal(bucket('a_status_from_the_future'), 'new');
  assert.equal(bucket(undefined), 'new');
  assert.equal(bucket(null), 'new');
});

/**
 * ⚠⚠ OPENING AN APPLICATION USED TO REMOVE IT FROM THE QUEUE.
 *
 * `EnquiryCard` auto-writes `seen` when a card is expanded, and PIPELINE
 * matched `new` alone. So Bass Heavy's PIPELINE read EMPTY while an
 * application sat in it, because someone had once looked at it.
 *
 * ⛔ Reading is not deciding — the rule ArtistDashboard already states:
 * "NEW means UNDECIDED, not unread."
 */
test('⚠⚠ looking at an application does not remove it from the pipeline', () => {
  assert.equal(isUndecided({ status: 'pending' }), true);
  assert.equal(isUndecided({ status: 'seen' }), true, 'the regression: this was false, and Bass Heavy went blank');
  assert.equal(isUndecided({ status: 'shortlisted' }), false, 'shortlisting IS a decision');
  assert.equal(isUndecided({ status: 'accepted' }), false);
  assert.equal(isUndecided({ status: 'declined' }), false);
  assert.deepEqual([...PIPELINE_BUCKETS].sort(), ['new', 'seen']);
});

test('every production application now appears in exactly one host tab', () => {
  // PIPELINE = new+seen · SHORT LIST = shortlisted · ACCEPTED = accepted
  // (DECLINED is deliberately not a host tab; it is the closed pile.)
  const rows = PRODUCTION.flatMap(([status, n]) => Array.from({ length: n }, () => ({ status })));
  const tabOf = r => {
    const b = bucket(r.status);
    if (PIPELINE_BUCKETS.includes(b)) return 'PIPELINE';
    if (b === 'shortlisted') return 'SHORT LIST';
    if (b === 'accepted') return 'ACCEPTED';
    return 'none';
  };
  const counts = rows.reduce((acc, r) => { const t = tabOf(r); acc[t] = (acc[t] || 0) + 1; return acc; }, {});
  assert.equal(counts.PIPELINE, 1, 'the seen application on Bass Heavy, which was invisible');
  assert.equal(counts['SHORT LIST'], 1);
  assert.equal(counts.ACCEPTED, 10, 'nine accepted plus the one confirmed, which display-normalises to accepted');
  assert.equal(counts.none, 1, 'only the declined one, which has no host tab by design');
  // ⭐ 12 of 13 now have a home. Before this: 1 of 13.
  assert.equal(rows.length - counts.none, 12);
});

test('the synonym pairs collapse, as ratified', () => {
  assert.equal(bucket('tentative'), bucket('shortlisted'));
  assert.equal(bucket('rejected'),  bucket('declined'));
  assert.equal(bucket('pending'),   bucket('new'));
});

/**
 * ⚠⚠ THE SERVER-SIDE COUNT CANNOT CALL THE NORMALISER.
 *
 * `HostDashboard` counts the PIPELINE with a PostgREST `.in()`, which needs the
 * raw spellings up front. Deriving that list from the same map is what stops it
 * drifting from the client-side filter beside it — the exact drift that made
 * the header read 0 while applications sat below it.
 */
test('the server-side list is derived from the same map the renderer uses', () => {
  const raw = rawStatusesFor('new');
  assert.ok(raw.includes('pending'), 'the DB default must be counted');
  assert.ok(raw.includes('new'));
  // Every raw value claimed for a bucket must actually normalise into it.
  for (const b of bucketsFor('incoming')) {
    for (const status of rawStatusesFor(b)) {
      assert.equal(bucket(status), b, `${status} claimed by ${b} but normalises to ${bucket(status)}`);
    }
  }
});

test('every writable status is claimed by exactly one bucket, so counts cannot double', () => {
  for (const status of EVERY_WRITABLE) {
    const owners = bucketsFor('incoming').filter(b => rawStatusesFor(b).includes(status));
    assert.ok(owners.length <= 1, `${status} is claimed by ${owners.join(' and ')}`);
  }
});

/**
 * ⭐ THE DRIFT GUARD. If someone adds a spelling to the map, this forces them to
 * add it to EVERY_WRITABLE too — which is the list a reviewer actually reads.
 */
test('the map holds no spelling this test does not know about', () => {
  const known = new Set([...EVERY_WRITABLE, 'new', 'viewed', 'booked']);
  const inMap = bucketsFor('incoming').flatMap(b => rawStatusesFor(b));
  const surprises = inMap.filter(s => !known.has(s));
  assert.deepEqual(surprises, [], 'add these to EVERY_WRITABLE and check every tab still counts them once');
});

/**
 * ⛔ THE HOST'S DECISIONS WERE SILENT. Both notification maps were keyed on
 * `tentative` and `rejected`; EnquiryCard writes `shortlisted` and `declined`,
 * so `NOTIF[status]` was undefined and nothing was sent. Keying on the bucket
 * is what makes both spellings reach the same notice.
 */
test('shortlist and decline both resolve to a notifiable bucket', () => {
  const NOTIF = { accepted: 1, shortlisted: 1, declined: 1 };
  for (const status of ['tentative', 'shortlisted']) assert.ok(NOTIF[bucket(status)], `${status} sends nothing`);
  for (const status of ['rejected', 'declined'])     assert.ok(NOTIF[bucket(status)], `${status} sends nothing`);
  // ⛔ `seen` is written automatically when a card is expanded. Notifying
  // someone that their application was looked at is not a decision.
  assert.equal(NOTIF[bucket('seen')], undefined);
});
