/**
 * WHAT AN APPLICANT IS TOLD — the closing half of the application loop.
 *
 * ⚠ THIS TEST EXISTS BECAUSE THE LOOP DID NOT CLOSE. `FestivalApply` rendered
 * "✓ APPLIED" and stopped, so an accepted applicant returning after the
 * organiser released decisions saw exactly what they saw the second they
 * applied. The data was present the whole time — fetched, mapped, ignored.
 *
 * ⭐ THE DATABASE IS THE MASK, not this file. `my_festival_applications` is
 * SECURITY DEFINER and collapses everything undecided or unreleased to
 * `in_review`, and never emits `shortlisted` at all. So every status that
 * reaches here is one the applicant is entitled to see, and the correct
 * behaviour is to render it — withholding it a second time is the bug.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// ⚠ festivalApplications.js imports supabase.js at module scope, and that file
// reads import.meta.env — a Vite construct that does not exist under plain
// Node. Same trap and same fix as conversationIndex.test.js: mock it before the
// import, so this file never needs to know the module has a network dependency.
// `applicationOutcome` itself is pure and touches none of it.
mock.module('./supabase', { exports: { supabase: {} } });

const { applicationOutcome, festivalDayOptions } = await import('./festivalApplications.js');

test('a released acceptance is actually announced', () => {
  const o = applicationOutcome('accepted');
  assert.equal(o.tone, 'good');
  assert.notEqual(o.label, 'APPLIED',
    'An accepted applicant must not see the same label as an untouched one — ' +
    'that is the defect this test was written for.');
});

test('every masked status the RPC can emit is handled distinctly', () => {
  // The four the database can return, per my_festival_applications' CASE.
  const labels = ['submitted', 'in_review', 'accepted', 'declined', 'withdrawn']
    .map(s => applicationOutcome(s).label);
  assert.equal(new Set([labels[2], labels[3], labels[4]]).size, 3,
    'accepted, declined and withdrawn must each read differently');
  assert.equal(labels[0], labels[1],
    'submitted and in_review are deliberately the same to the applicant: the ' +
    'mask exists so a held decision is indistinguishable from an unread one.');
});

test('an unknown status degrades to pending, never to an outcome', () => {
  // If a status is ever added server-side, the applicant must not be told they
  // were accepted or declined by a fallback. Absent ≠ decided.
  for (const s of [undefined, null, '', 'shortlisted', 'nonsense']) {
    const o = applicationOutcome(s);
    assert.equal(o.tone, 'pending', `${String(s)} must not read as an outcome`);
  }
});

test('shortlisted never reaches the applicant as itself', () => {
  // Belt and braces: the database already refuses to emit it. If that mask were
  // ever weakened, this asserts the client does not leak the organiser's
  // internal workflow either.
  assert.equal(applicationOutcome('shortlisted').label, 'APPLIED');
});

/**
 * ── DAY OPTIONS · THE LABEL AND THE VALUE NAME THE SAME DAY ──────────
 *
 * `festivalDayOptions` built its `value` with `toISOString().slice(0, 10)`
 * (UTC) and its `label` with `toLocaleDateString` (local), while walking a
 * cursor that starts at LOCAL midnight. Anywhere east of Greenwich those two
 * name different days: the option READ "Fri, 14 Aug" and SUBMITTED
 * "2026-08-13", so a volunteer's stored availability was a day earlier than
 * the day they picked. It threw nothing and looked right on screen — the
 * label, the only part anyone sees, was correct the whole time.
 *
 * ⚠ THIS TEST IS ONLY MEANINGFUL AWAY FROM UTC. Under TZ=UTC the old code
 * passes, which is precisely why the bug survived. The assertions below
 * derive the expectation from the LOCAL calendar rather than a hard-coded
 * string, so the file is honest in any zone — and the count assertion pins
 * the off-by-one directly.
 */
test('every day option submits the day it displays', () => {
  const opts = festivalDayOptions({ starts_on: '2026-08-14', ends_on: '2026-08-16' });

  assert.equal(opts.length, 3, 'an inclusive 14th-to-16th range is three days');

  // The values are exactly the days asked for, in order — not shifted.
  assert.deepEqual(opts.map(o => o.value), ['2026-08-14', '2026-08-15', '2026-08-16']);

  // And each label describes its own value. Built from the value string via
  // local Date parts, so this compares the option against the calendar rather
  // than against the same call that produced it.
  for (const o of opts) {
    const [y, m, d] = o.value.split('-').map(Number);
    const expected = new Date(y, m - 1, d)
      .toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    assert.equal(o.label, expected,
      `"${o.label}" is offered but "${o.value}" would be stored`);
  }
});

test('the three phases keep their own days and never collapse', () => {
  const opts = festivalDayOptions({
    build_starts_on: '2026-08-12', build_ends_on: '2026-08-13',
    starts_on:       '2026-08-14', ends_on:       '2026-08-16',
    packdown_starts_on: '2026-08-17', packdown_ends_on: '2026-08-17',
  });
  assert.deepEqual(opts.map(o => o.value), [
    '2026-08-12', '2026-08-13',
    '2026-08-14', '2026-08-15', '2026-08-16',
    '2026-08-17',
  ]);
  assert.deepEqual(opts.map(o => o.phase), [
    'build', 'build', 'festival', 'festival', 'festival', 'pack-down',
  ]);
});

test('a single-day range yields exactly that day', () => {
  // The tightest case the off-by-one could hide in: one day in, one day out,
  // and under the old code the one that came out was the wrong one.
  const opts = festivalDayOptions({ starts_on: '2026-01-01', ends_on: '2026-01-01' });
  assert.deepEqual(opts.map(o => o.value), ['2026-01-01']);
});

test('no dates set is an empty list, not a guess', () => {
  assert.deepEqual(festivalDayOptions(null), []);
  assert.deepEqual(festivalDayOptions({}), []);
  assert.deepEqual(festivalDayOptions({ starts_on: '2026-08-14' }), [],
    'half a range cannot be walked, and inventing an end date would invent days');
});
