/**
 * A SERVER COUNT AND THE LIST IT LABELS MUST MEAN THE SAME THING.
 *
 * ⛔⛔ THE ASYMMETRY. The renderer buckets a row with `normaliseStatus`, whose
 * last line is `map[st] || 'new'` — an unrecognised status, and a NULL one
 * (it defaults to 'pending'), land in the catch-all bucket. A server-side count
 * cannot call that function, so it used `.in('status', rawStatusesFor('new'))`
 * — the MAPPED spellings only. Two different definitions of "new", one on the
 * badge and one in the list under it.
 *
 * ⚠ It was recorded in `enquiryUtils` as a known and accepted limit because
 * "no `.in()` list can express 'anything not listed'". True of `.in()`; false
 * of PostgREST, which can say `status.is.null,status.not.in.(…)`.
 *
 * ⭐ So the catch-all bucket is described NEGATIVELY, and these tests exist to
 * prove that inversion is faithful rather than the usual bug: everywhere else
 * in this codebase a negative status filter silently admits whatever gets added
 * later, and here that is precisely the specified behaviour.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('./supabase', { exports: { supabase: { from: () => ({}) } } });

const {
  normaliseStatus, bucketFilterFor, bucketFilterMatches, applyBucketFilter,
  rawStatusesFor, bucketsFor, FALLBACK_BUCKET,
} = await import('./enquiryUtils.js');

/**
 * Every status the two vocabularies can produce, plus the two the old filter
 * could not see. ⚠ `undefined` is here as well as `null`: a `select` that omits
 * the column hands the renderer a row with no `status` key at all.
 */
const CASES = [
  'pending', 'new', 'viewed', 'seen', 'tentative', 'shortlisted', 'offered',
  'accepted', 'confirmed', 'booked', 'declined', 'rejected', 'cancelled',
  'PENDING', 'Accepted',            // casing — normaliseStatus lowercases
  'archived', 'expired', 'wat',     // unknown spellings nobody has written
  null, undefined, '',              // absent, in its three spellings
];

for (const direction of ['incoming', 'outgoing']) {
  test(`⭐⭐ ${direction}: the filter and the renderer agree on EVERY status`, () => {
    for (const bucket of bucketsFor(direction)) {
      const filter = bucketFilterFor(bucket, direction);
      for (const status of CASES) {
        const rendered = normaliseStatus({ status, direction }) === bucket;
        const counted  = bucketFilterMatches(filter, status);
        assert.equal(counted, rendered,
          `${direction}/${bucket}: status ${JSON.stringify(status)} is ` +
          `${rendered ? 'IN' : 'NOT IN'} the list but ` +
          `${counted ? 'IS' : 'IS NOT'} counted`);
      }
    }
  });

  test(`⭐ ${direction}: every status lands in exactly ONE bucket`, () => {
    for (const status of CASES) {
      const hits = bucketsFor(direction)
        .filter(b => bucketFilterMatches(bucketFilterFor(b, direction), status));
      assert.equal(hits.length, 1,
        `${JSON.stringify(status)} matched ${hits.length} buckets (${hits.join(', ')})`);
    }
  });
}

test('the six statuses the owner named, incoming', () => {
  const inNew = s => bucketFilterMatches(bucketFilterFor('new', 'incoming'), s);
  // ⭐ BOTH VOCABULARIES REACH THIS TABLE. `venue_enquiries.status` defaults to
  // 'pending'; the newer host surfaces write 'new'. Counting one is how the
  // other stops being counted, which is the drift this is all about.
  assert.equal(inNew('new'),     true,  'new is new');
  assert.equal(inNew('pending'), true,  'pending is the column DEFAULT, so it is most of them');
  assert.equal(inNew('accepted'), false);
  assert.equal(inNew('declined'), false);
  // ⛔ cancelled files under DECLINED for the venue — the asker walked away, and
  // that is the "off the table" pile, not a decision anyone made.
  assert.equal(inNew('cancelled'), false);
  assert.equal(normaliseStatus({ status: 'cancelled', direction: 'incoming' }), 'declined');
});

test('⛔⛔ an UNKNOWN status is counted as new, because that is where it renders', () => {
  const status = 'some_status_nobody_has_written_yet';
  assert.equal(normaliseStatus({ status, direction: 'incoming' }), 'new');
  assert.equal(bucketFilterMatches(bucketFilterFor('new', 'incoming'), status), true);
  // ⚠ And the OLD form is what could not: this is the whole defect, in one line.
  assert.equal(rawStatusesFor('new').includes(status), false);
});

test('⛔⛔ a NULL status is counted as new, for the same reason', () => {
  /* ⚠ `venue_enquiries.status` is NOT NULL DEFAULT 'pending', so this leg is
     unreachable on the offers count today. `applications.status` is NULLABLE
     and asks the identical question, so the answer may not depend on which
     table the caller happened to be pointing at. */
  assert.equal(normaliseStatus({ status: null, direction: 'incoming' }), 'new');
  assert.equal(bucketFilterMatches(bucketFilterFor('new', 'incoming'), null), true);
  assert.equal(bucketFilterMatches(bucketFilterFor('accepted', 'incoming'), null), false);
});

test('⭐ the catch-all bucket is the only one described negatively', () => {
  for (const direction of ['incoming', 'outgoing']) {
    for (const bucket of bucketsFor(direction)) {
      const { kind } = bucketFilterFor(bucket, direction);
      assert.equal(kind, bucket === FALLBACK_BUCKET[direction] ? 'not-in-or-null' : 'in',
        `${direction}/${bucket} used the wrong form`);
    }
  }
});

test('⛔ the negative list is DERIVED, so a new spelling cannot drift out of it', () => {
  const { statuses } = bucketFilterFor('new', 'incoming');
  const others = bucketsFor('incoming')
    .filter(b => b !== 'new')
    .flatMap(b => rawStatusesFor(b));
  assert.deepEqual([...statuses].sort(), [...new Set(others)].sort());
  // ⛔ and no status that belongs to `new` may appear in the exclusion list, or
  // the count would exclude the very rows it is counting.
  for (const s of rawStatusesFor('new')) assert.ok(!statuses.includes(s), s);
});

/** Records what a PostgREST builder was asked to do. */
function recorder() {
  const calls = [];
  const q = {
    calls,
    in:  (col, val) => { calls.push(['in', col, val]); return q; },
    or:  (expr)     => { calls.push(['or', expr]);     return q; },
  };
  return q;
}

test('⭐ applyBucketFilter emits `.in()` for a mapped bucket', () => {
  const q = applyBucketFilter(recorder(), 'accepted', 'incoming');
  assert.deepEqual(q.calls, [['in', 'status', rawStatusesFor('accepted')]]);
});

test('⭐⭐ applyBucketFilter emits the NULL-safe negative form for the catch-all', () => {
  const q = applyBucketFilter(recorder(), 'new', 'incoming');
  assert.equal(q.calls.length, 1);
  const [kind, expr] = q.calls[0];
  assert.equal(kind, 'or');
  /* ⛔⛔ THE NULL LEG IS NOT OPTIONAL. `NOT IN (…)` evaluates to NULL for a NULL
     status, and a NULL predicate excludes the row — so without this the filter
     would silently drop exactly the rows the renderer calls new. */
  assert.match(expr, /^status\.is\.null,status\.not\.in\.\(/);
  for (const s of ['accepted', 'declined', 'cancelled', 'seen']) {
    assert.ok(expr.includes(s), `${s} must be excluded`);
  }
  for (const s of rawStatusesFor('new')) {
    assert.ok(!expr.includes(`,${s},`) && !expr.includes(`(${s},`),
      `${s} belongs to this bucket and must NOT be excluded`);
  }
});

test('⚠ direction is honoured — outgoing has its own catch-all', () => {
  assert.equal(FALLBACK_BUCKET.outgoing, 'awaiting');
  assert.equal(bucketFilterFor('awaiting', 'outgoing').kind, 'not-in-or-null');
  // ⛔ 'new' is not even a bucket outgoing, so it must not be treated as one.
  assert.equal(bucketFilterFor('new', 'outgoing').kind, 'in');
  assert.deepEqual(bucketFilterFor('new', 'outgoing').statuses, []);
});
