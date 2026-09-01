/**
 * E6 · THE EMAIL NOTIFICATION SETTINGS — what the panel may do, and may not.
 *
 * ⚠⚠ WHAT THESE TESTS CAN AND CANNOT PROVE, STATED SO NOBODY OVER-READS THEM.
 *
 * The real supabase client is REPLACED by a recording stub, so these exercise
 * the actual production module and observe exactly which table and which rows
 * it touches. That is what makes "changing Bookings does not change push" a
 * real assertion rather than a hopeful one: the stub fails the test if any
 * table other than email_notification_preferences is written.
 *
 * ⛔ THEY DO NOT PROVE DATABASE BEHAVIOUR. Whether muting `schedule` actually
 * withholds an email, whether the E4 cooldown fires, and whether slot_changed
 * resolves to `schedule` are facts about Postgres, and they are proven where
 * they live — E1's V10, E3's V5/V7/V8 and E4's V1/V2/V5, all of which PROVOKE
 * the behaviour against production inside a rolled-back transaction. ⛔ A unit
 * test asserting them here would be theatre: it would pass with the database in
 * any state at all.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

/* Records every table touched and every row written, so a test can assert on
   what was NOT touched — which is the whole point of most of these. */
const calls = { selects: [], upserts: [] };
let selectResult = { data: [], error: null };
let upsertError = null;

function table(name) {
  return {
    select() {
      return {
        eq(col, val) {
          calls.selects.push({ table: name, col, val });
          return Promise.resolve(selectResult);
        },
      };
    },
    upsert(row, opts) {
      calls.upserts.push({ table: name, row, opts });
      return Promise.resolve({ error: upsertError });
    },
  };
}

mock.module('./supabase', { exports: { supabase: { from: table } } });

const {
  EMAIL_CATEGORIES, EMAIL_MASTER, WRITABLE_EMAIL_CATEGORIES,
  getEmailPreferences, setEmailPreference,
} = await import('./emailPreferences.js');

const USER = '00000000-0000-4000-8000-00000000e006';

function reset() {
  calls.selects.length = 0;
  calls.upserts.length = 0;
  selectResult = { data: [], error: null };
  upsertError = null;
}

/* ── 1 · the master switch loads ────────────────────────────────── */

test('1 · the master switch reads OFF only when the database says so', async () => {
  reset();
  selectResult = { data: [{ category: 'all', enabled: false }], error: null };
  const { disabled } = await getEmailPreferences(USER);
  assert.ok(disabled.has(EMAIL_MASTER), 'an explicit all=false must read as off');

  reset();
  const fresh = await getEmailPreferences(USER);
  assert.equal(fresh.disabled.has(EMAIL_MASTER), false,
    '⭐ absence means ENABLED — a fresh account must not read as muted');
});

/* ── 2 · individual preferences load ────────────────────────────── */

test('2 · individual categories load from the database, sparsely', async () => {
  reset();
  selectResult = {
    data: [
      { category: 'bookings', enabled: false },
      { category: 'messages', enabled: true },
    ],
    error: null,
  };
  const { disabled } = await getEmailPreferences(USER);

  assert.ok(disabled.has('bookings'), 'an explicit false is off');
  assert.equal(disabled.has('messages'), false, 'an explicit true is on');
  assert.equal(disabled.has('events'), false, 'an absent row is on');
  assert.equal(disabled.size, 1, 'only explicit falses are held');
});

test('⚠ a failed read fails toward ON, never toward a false mute', async () => {
  reset();
  selectResult = { data: null, error: { message: 'network' } };
  const { disabled, error } = await getEmailPreferences(USER);
  assert.ok(error, 'the error is surfaced to the caller');
  assert.equal(disabled.size, 0,
    '⛔ a failed read must never claim the user muted something');
});

/* ── 3 & 4 · master off suppresses, master on RESTORES ──────────── */

test('3+4 · turning the master off and on again preserves the individual rows', async () => {
  reset();
  await setEmailPreference(USER, EMAIL_MASTER, false);

  assert.equal(calls.upserts.length, 1);
  assert.deepEqual(
    { category: calls.upserts[0].row.category, enabled: calls.upserts[0].row.enabled },
    { category: 'all', enabled: false },
    'the master writes exactly one row, for the reserved category',
  );

  // ⭐⭐ THE RESTORE PROPERTY, AND IT IS STRUCTURAL RATHER THAN IMPLEMENTED.
  // Turning the master off writes ONE row and touches no category row, so the
  // user's individual choices are still on disk and reappear untouched when it
  // goes back on. ⛔ Nothing has to "remember" them, which is why nothing can
  // forget them.
  const touchedCategories = calls.upserts.map(u => u.row.category);
  assert.deepEqual(touchedCategories, ['all'],
    '⛔ the master switch must not rewrite any individual category');

  reset();
  await setEmailPreference(USER, EMAIL_MASTER, true);
  assert.deepEqual(calls.upserts.map(u => u.row.category), ['all'],
    '⛔ turning it back on must not reset categories to ON either');
});

/* ── 5 & 6 · a category change is EMAIL ONLY ────────────────────── */

for (const cat of ['bookings', 'schedule', 'events', 'messages']) {
  test(`5+6 · changing ${cat} writes only email_notification_preferences`, async () => {
    reset();
    await setEmailPreference(USER, cat, false);

    assert.equal(calls.upserts.length, 1, 'exactly one write');
    assert.equal(calls.upserts[0].table, 'email_notification_preferences',
      '⛔⛔ PUSH AND IN-APP ARE UNTOUCHED: notification_preferences and '
      + 'notification_channel_prefs must never be written by this panel');
    assert.equal(calls.upserts[0].row.category, cat);
    assert.equal(calls.upserts[0].row.enabled, false);
    assert.equal(calls.upserts[0].opts.onConflict, 'user_id,category',
      'upsert keyed on the real primary key');
  });
}

test('⛔ the panel reads only its own table', async () => {
  reset();
  await getEmailPreferences(USER);
  assert.deepEqual([...new Set(calls.selects.map(s => s.table))],
    ['email_notification_preferences'],
    '⛔ it must not read notification_preferences or notification_channel_prefs');
});

/* ── 8 & 9 · what has no switch, and why ────────────────────────── */

test('8 · payments and account are presented as ALWAYS ON, with no switch', () => {
  const row = EMAIL_CATEGORIES.find(c => c.key === 'payments_account');
  assert.ok(row, 'the row exists');
  assert.equal(row.state, 'always');
  assert.equal(WRITABLE_EMAIL_CATEGORIES.includes('payments_account'), false,
    '⛔ display-only: it is one row standing for two un-mutable categories and '
    + 'must never be written as a category');
});

test('9 · social and contacts are IN THE APP, never emailed', () => {
  for (const key of ['social', 'contacts']) {
    const row = EMAIL_CATEGORIES.find(c => c.key === key);
    assert.ok(row, `${key} is shown rather than hidden`);
    assert.equal(row.state, 'in_app',
      `${key} must read as in-app only, ⛔ not as a switch the user can flip`);
    assert.equal(WRITABLE_EMAIL_CATEGORIES.includes(key), false,
      `⛔ ${key} must not be writable — the platform excludes it from email scope`);
  }
});

/* ── the shape of the list itself ───────────────────────────────── */

test('the panel offers exactly the four approved switches', () => {
  assert.deepEqual(WRITABLE_EMAIL_CATEGORIES,
    ['bookings', 'schedule', 'events', 'messages'],
    '⛔ no category may be added to this panel without a decision');
});

test('every row has a plain label and no internal type name leaks', () => {
  const INTERNAL = /new_message|slot_changed|set_times_released|availability_request|new_application/;
  for (const c of EMAIL_CATEGORIES) {
    assert.ok(c.label && c.desc, `${c.key} has a label and a description`);
    assert.doesNotMatch(c.label, INTERNAL, `${c.key}: ⛔ no internal type in the label`);
    assert.doesNotMatch(c.desc, INTERNAL, `${c.key}: ⛔ no internal type in the copy`);
    assert.doesNotMatch(c.desc, /—/, `${c.key}: ⛔ NO EM DASHES in user-facing copy`);
    assert.doesNotMatch(c.label, /—/, `${c.key}: ⛔ NO EM DASHES in user-facing copy`);
  }
});

test('⚠ SCHEDULE is described by what it does, not by the types behind it', () => {
  // ⭐ The point of the schedule row: it covers set times being published AND a
  // set time changing. A reader must be able to tell that from the copy without
  // knowing that two notification types map into one email category.
  const row = EMAIL_CATEGORIES.find(c => c.key === 'schedule');
  assert.match(row.desc, /set times?/i, 'mentions set times being published');
  assert.match(row.desc, /change/i, 'and a set time changing');
});

/* ── writes are refused without an account ──────────────────────── */

test('⛔ nothing is written when signed out', async () => {
  reset();
  const { error } = await setEmailPreference(null, 'bookings', false);
  assert.ok(error, 'it refuses rather than writing a row with a null user');
  assert.equal(calls.upserts.length, 0);
});
