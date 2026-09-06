/**
 * TWO COUNTERS THAT DISAGREED WITH THE LISTS THEY LABEL.
 *
 * ⛔⛔ HOST — "STILL WAITING ON THE HOST" IS NOT ONE BUCKET. It is
 * `PIPELINE_BUCKETS = ['new','seen']`, because `EnquiryCard` auto-writes `seen`
 * the moment an application is expanded. `HostDashboard`'s header counted
 * `rawStatusesFor('new')` — `new` ALONE — while the list beneath it read both.
 * So OPENING an application decremented the number and left the row exactly
 * where it was. Reading is not deciding.
 *
 * ⛔⛔ ARTIST — `newAppsCount` was `(a.status || 'pending') === 'pending'`, a
 * hand-written rule that named no direction. These are the asker's OWN
 * applications, so the bucket is `awaiting` = `pending` AND `new` plus the
 * catch-all. The literal missed `new` outright.
 *
 * ⚠ Both are READ counts. Every consequential write near them (`dateLockout`'s
 * sweep, `answerOpenRequests`, the applications DELETE, the auto-`seen`) stays
 * deliberately narrower, and none is touched here.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('./supabase', { exports: { supabase: { from: () => ({}) } } });

const {
  normaliseStatus, bucketFilterFor, bucketFilterMatches, bucketMatches,
  applyBucketFilter, rawStatusesFor, FALLBACK_BUCKET, PIPELINE_BUCKETS,
} = await import('./enquiryUtils.js');

/** Every spelling both vocabularies use, plus absence in its three forms. */
const CASES = [
  'pending', 'new', 'viewed', 'seen', 'tentative', 'shortlisted', 'offered',
  'accepted', 'confirmed', 'booked', 'declined', 'rejected', 'cancelled',
  'PENDING', 'Accepted',
  'archived', 'expired', 'wat',
  null, undefined, '',
];

/** Records what a PostgREST builder was asked to do. */
function recorder() {
  const calls = [];
  const q = {
    calls,
    in: (col, val) => { calls.push(['in', col, val]); return q; },
    or: (expr) => { calls.push(['or', expr]); return q; },
  };
  return q;
}

// ── HOST DASHBOARD ─────────────────────────────────────────────────────────

test('HOST · the pipeline count and the PIPELINE_BUCKETS list agree on EVERY status', () => {
  /* THE INVARIANT. `newApps` in HostDashboard is
     `allApps.filter(a => PIPELINE_BUCKETS.includes(bucketOfApp(a)))`, so that
     expression IS the specification and the count must match it exactly. */
  const filter = bucketFilterFor(PIPELINE_BUCKETS, 'incoming');
  for (const status of CASES) {
    const listed = PIPELINE_BUCKETS.includes(normaliseStatus({ status, direction: 'incoming' }));
    const counted = bucketFilterMatches(filter, status);
    assert.equal(counted, listed,
      `status ${JSON.stringify(status)} is ${listed ? 'IN' : 'NOT IN'} the list `
      + `but ${counted ? 'IS' : 'IS NOT'} counted`);
  }
});

test('HOST · pending, new and seen are all in the pipeline count', () => {
  const inPipeline = s => bucketMatches(PIPELINE_BUCKETS, s, 'incoming');
  assert.equal(inPipeline('pending'), true, 'the column DEFAULT');
  assert.equal(inPipeline('new'), true, 'the newer vocabulary');
  // ⛔⛔ THE BUG. `seen` is written BY LOOKING, so excluding it meant opening an
  // application removed it from the host's own queue.
  assert.equal(inPipeline('seen'), true, 'reading is not deciding');
  assert.equal(inPipeline('viewed'), true, 'the older spelling of the same act');
});

test('HOST · a DECIDED application is not in the pipeline count', () => {
  const inPipeline = s => bucketMatches(PIPELINE_BUCKETS, s, 'incoming');
  for (const s of ['accepted', 'confirmed', 'booked', 'declined', 'rejected', 'cancelled']) {
    assert.equal(inPipeline(s), false, `${s} has been decided`);
  }
  /* ⚠ shortlisted is a DECISION too — the host deliberately kept them alive,
     and it has its own tab. ⛔ Not part of the undecided pipeline. */
  for (const s of ['shortlisted', 'tentative', 'offered']) {
    assert.equal(inPipeline(s), false, `${s} is on the short list, not the pipeline`);
  }
});

test('HOST · an UNKNOWN status follows the catch-all, into the count', () => {
  for (const s of ['archived', 'expired', 'wat']) {
    assert.equal(normaliseStatus({ status: s, direction: 'incoming' }), 'new');
    assert.equal(bucketMatches(PIPELINE_BUCKETS, s, 'incoming'), true);
  }
});

test('HOST · a NULL status follows the catch-all, into the count', () => {
  /* ⚠ `applications.status` IS NULLABLE — `text DEFAULT pending` with no NOT
     NULL — so unlike the offers count on `venue_enquiries`, this leg is
     genuinely reachable here. */
  for (const s of [null, undefined, '']) {
    assert.equal(normaliseStatus({ status: s, direction: 'incoming' }), 'new');
    assert.equal(bucketMatches(PIPELINE_BUCKETS, s, 'incoming'), true);
  }
});

test('HOST · the union emits ONE NULL-safe negative predicate', () => {
  const q = applyBucketFilter(recorder(), PIPELINE_BUCKETS, 'incoming');
  assert.equal(q.calls.length, 1, 'one predicate, not one per bucket');
  const [kind, expr] = q.calls[0];
  assert.equal(kind, 'or', 'the union contains the catch-all, so it must be negative');
  assert.match(expr, /^status\.is\.null,status\.not\.in\.\(/);
  for (const s of ['accepted', 'confirmed', 'booked', 'declined', 'rejected',
    'cancelled', 'shortlisted', 'tentative', 'offered']) {
    assert.ok(expr.includes(s), `${s} must be excluded`);
  }
  for (const s of ['pending', 'new', 'seen', 'viewed']) {
    assert.ok(!expr.includes(`,${s},`) && !expr.includes(`(${s},`) && !expr.includes(`,${s})`),
      `${s} is in the pipeline and must NOT be excluded`);
  }
});

test('a union WITHOUT the catch-all stays positive', () => {
  /* ⭐ The form follows the CONTENT of the union, not the fact that it is one:
     no catch-all means the mapped spellings are the whole answer. */
  const f = bucketFilterFor(['shortlisted', 'accepted'], 'incoming');
  assert.equal(f.kind, 'in');
  assert.deepEqual([...f.statuses].sort(),
    [...new Set([...rawStatusesFor('shortlisted'), ...rawStatusesFor('accepted')])].sort());
  assert.equal(bucketMatches(['shortlisted', 'accepted'], null, 'incoming'), false,
    'NULL renders as new, so it is NOT in a union that excludes new');
});

test('the single-bucket API is unchanged by the union support', () => {
  /* ⛔ A bare string must behave exactly as it did before, or every existing
     caller silently changes meaning. */
  assert.deepEqual(bucketFilterFor('accepted', 'incoming'), bucketFilterFor(['accepted'], 'incoming'));
  assert.deepEqual(bucketFilterFor('new', 'incoming'), bucketFilterFor(['new'], 'incoming'));
  assert.equal(bucketFilterFor('accepted', 'incoming').kind, 'in');
  assert.equal(bucketFilterFor('new', 'incoming').kind, 'not-in-or-null');
});

// ── ARTIST DASHBOARD ───────────────────────────────────────────────────────

/** Exactly the predicate ArtistDashboard's newAppsCount now uses. */
const isAwaiting = status => normaliseStatus({ status, direction: 'outgoing' }) === 'awaiting';

test('ARTIST · pending and new are both outgoing AWAITING', () => {
  assert.equal(isAwaiting('pending'), true, 'the column DEFAULT');
  // ⛔⛔ THE BUG. The literal `=== pending` missed this one outright.
  assert.equal(isAwaiting('new'), true, 'the newer vocabulary, and it was being dropped');
});

test('ARTIST · an ANSWERED application is not awaiting', () => {
  for (const s of ['accepted', 'confirmed', 'booked', 'declined', 'rejected', 'cancelled']) {
    assert.equal(isAwaiting(s), false, `${s} has been answered`);
  }
  /* ⚠ OUTGOING DIFFERS FROM INCOMING HERE, and it is not a mistake: to the
     ASKER, being shortlisted is movement worth its own tab (`interested`). */
  for (const s of ['shortlisted', 'tentative', 'offered']) {
    assert.equal(isAwaiting(s), false, `${s} is interest, not silence`);
  }
});

test('ARTIST · unknown and NULL follow the outgoing catch-all', () => {
  assert.equal(FALLBACK_BUCKET.outgoing, 'awaiting');
  for (const s of ['archived', 'wat', null, undefined, '']) {
    assert.equal(isAwaiting(s), true, `${JSON.stringify(s)} falls to awaiting`);
  }
});

test('ARTIST · the counter agrees with the outgoing pipeline bucketing', () => {
  /* THE INVARIANT. ArtistDashboard builds `outStatuses` with
     `normaliseStatus({ ...row, direction: 'outgoing' })`, and the AWAITING tab
     shows bucket === 'awaiting'. The banner count must select the same rows. */
  for (const status of CASES) {
    const inTab = normaliseStatus({ status, direction: 'outgoing' }) === 'awaiting';
    assert.equal(isAwaiting(status), inTab, `${JSON.stringify(status)} disagrees with its tab`);
  }
});

test('ARTIST · the OLD literal really did disagree, which is the defect', () => {
  const oldWay = status => (status || 'pending') === 'pending';
  assert.equal(oldWay('new'), false);
  assert.equal(isAwaiting('new'), true);
  for (const s of ['archived', 'wat']) {
    assert.equal(oldWay(s), false);
    assert.equal(isAwaiting(s), true);
  }
  // …and they agree on the common case, which is why it survived this long.
  assert.equal(oldWay('pending'), isAwaiting('pending'));
});

// ── THE CALLERS REALLY USE THESE DEFINITIONS ───────────────────────────────

test('⛔ neither screen has a hand-typed status vocabulary left in its counter', async () => {
  /* ⚠ ONE STRUCTURAL CLAIM ONLY, and it is the one the pure tests above cannot
     make: that the screens actually call this model. Without it both counters
     could be correct in here and still wrong on screen. */
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const host = read('../screens/HostDashboard.jsx');
  assert.match(host, /applyBucketFilter\(\s*[\s\S]{0,240}?PIPELINE_BUCKETS\)/,
    'the host count must be the PIPELINE_BUCKETS union');
  assert.ok(!/\.in\('status', rawStatusesFor\('new'\)\)/.test(host),
    'the single-bucket count must not come back');

  const artist = read('../screens/ArtistDashboard.jsx');
  assert.match(artist, /normaliseStatus\(\{ status: a\.status, direction: 'outgoing' \}\) === 'awaiting'/,
    'the artist counter must use the canonical outgoing bucket');
  assert.ok(!/\(a\.status \|\| 'pending'\) === 'pending'/.test(artist),
    'the hand-written literal must not come back');
});
