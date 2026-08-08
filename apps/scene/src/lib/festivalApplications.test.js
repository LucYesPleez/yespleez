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

const { applicationOutcome } = await import('./festivalApplications.js');

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
