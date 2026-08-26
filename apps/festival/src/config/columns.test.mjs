import test from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, columnsFor } from './columns.js';
import { CATEGORIES } from './categories.js';

/**
 * ⚠⚠ THESE EXIST BECAUSE FOUR OF SIX VOLUNTEER COLUMNS RENDERED A PERMANENT
 * DASH IN PRODUCTION (measured 2026-08-27) while the answers were stored
 * perfectly. The failure was silent by construction: a column resolved
 * `application[key] ?? answers[key]`, so a key that matched nothing simply
 * looked like an applicant who had not answered.
 *
 * ⛔ A dash in this table MEANS "asked and not answered". Any column that can
 * never resolve is therefore a lie, not a cosmetic gap — which is why these
 * assert against THE EXACT SHAPE SCENE WRITES rather than a fixture invented
 * here. The in-memory fixture repository is what hid this for months: it
 * stuffed `skills`/`date` into `answers`, so the placeholder UI looked right.
 */

// Exactly what apps/scene writes for a volunteer — verified against the real
// production rows on Echo Valley.
const volunteerApplication = {
  id: 'a1',
  name: 'Luc',
  location: 'Bellingen, NSW',
  status: 'submitted',
  submittedAt: '2026-08-06T05:34:05.149165+00:00',
  answers: {
    days: ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'],
    departments: ['Front Gate', 'Site Crew', 'Build Crew'],
  },
};

const resolve = (col, app) =>
  (col.value ? col.value(app) : app[col.key] ?? app.answers?.[col.key]);

const isDash = v => v == null || v === '';

test('every volunteer column resolves against the shape Scene actually writes', () => {
  const volunteer = CATEGORIES.find(c => c.key === 'volunteer');
  for (const col of columnsFor(volunteer)) {
    if (col.cell === 'applicant') continue;   // renders from name/location
    assert.ok(
      !isDash(resolve(col, volunteerApplication)),
      `column "${col.key}" rendered a dash for a fully answered application — ` +
      'a reviewer would read that as "they did not answer"',
    );
  }
});

test('⛔ no volunteer column asks for something nothing writes', () => {
  const keys = CATEGORIES.find(c => c.key === 'volunteer').columns;
  // `skills` lives on `profiles` and is never re-asked; `stage` has no writer
  // anywhere in the app. Both used to sit in this list rendering dashes.
  assert.ok(!keys.includes('skills'), 'skills is never collected for a volunteer');
  assert.ok(!keys.includes('stage'), 'nothing writes application.stage');
});

test('the days summary counts, and singular is not "1 days"', () => {
  const v = a => COLUMNS.availability.value(a);
  assert.equal(v(volunteerApplication), '4 days');
  assert.equal(v({ answers: { days: ['2026-11-12'] } }), '1 day');
  assert.equal(v({ answers: {} }), null);
  assert.equal(v({ answers: { days: [] } }), null);
  assert.equal(v({}), null);
});

test('departments name the first and count the rest', () => {
  const v = a => COLUMNS.departments.value(a);
  assert.equal(v(volunteerApplication), 'Front Gate +2');
  assert.equal(v({ answers: { departments: ['Front Gate'] } }), 'Front Gate');
  assert.equal(v({ answers: { departments: [] } }), null);
  assert.equal(v({}), null);
});

test('⛔ the applied date is the LOCAL day, never the UTC one', () => {
  const v = a => COLUMNS.date.value(a);
  // 2026-08-06T05:34Z is the 6th in Sydney and the 6th in UTC; the trap this
  // guards is a same-instant timestamp that falls either side of midnight.
  assert.equal(v(volunteerApplication), '6 Aug');
  // 21:00 UTC on the 5th is already the 6th in Sydney (UTC+10).
  const evening = { submittedAt: '2026-08-05T21:00:00+00:00' };
  const local = new Date(evening.submittedAt)
    .toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  assert.equal(v(evening), local, 'the cell must agree with the viewer’s own clock');
  assert.equal(v({ submittedAt: null }), null);
  assert.equal(v({}), null);
});

test('an application with no answers still dashes honestly', () => {
  const empty = { id: 'b', name: 'Nobody', status: 'submitted', submittedAt: null, answers: {} };
  assert.ok(isDash(COLUMNS.availability.value(empty)));
  assert.ok(isDash(COLUMNS.departments.value(empty)));
  assert.ok(isDash(COLUMNS.date.value(empty)));
});
