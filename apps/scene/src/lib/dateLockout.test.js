import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isSweepable, findOpenAsksForDate, declineOpenAsks } from './dateLockout.js';

/**
 * ⭐ A LOCKED DATE CLEARS ITS FUNNEL — BY ANSWERING IT, NEVER BY HIDING IT.
 *
 * Publishing an event is the public commitment to a date, and everyone still
 * queued for that date is no longer in the running. ⛔⛔ Removing them from the
 * promoter's view without telling them is the WORSE bug: the screen looks
 * resolved and the person waits forever on a reply nobody was prompted to make
 * — the same failure as the duplicate enquiry that faked success.
 */

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const HOST_VIEW = read('../screens/event/EventHostView.jsx');

function fakeSupabase({ applications = [], enquiries = [], failWrites = false } = {}) {
  const writes = [];
  return {
    writes,
    from(table) {
      const f = {}; let update = null;
      const api = {
        select() { return api; },
        update(vals) { update = vals; return api; },
        eq(c, v) { f[c] = v; return api; },
        in(c, v) { f[`in:${c}`] = v; return api; },
        then(resolve) {
          if (update) {
            writes.push({ table, update, filters: f });
            return Promise.resolve({ error: failWrites ? new Error('nope') : null }).then(resolve);
          }
          const rows = table === 'applications' ? applications : enquiries;
          const data = rows.filter(r =>
            Object.entries(f).every(([k, v]) => k.startsWith('in:')
              ? v.includes(r[k.slice(3)])
              : r[k] === v));
          return Promise.resolve({ data }).then(resolve);
        },
      };
      return api;
    },
  };
}

const DATE = '2026-08-30';
const VENUE_ID = 'venue-1';

// ── Only the unanswered ─────────────────────────────────────────────────────

/**
 * ⛔ `pending` is the PIPELINE — nobody acted on it. `tentative` is the SHORT
 * LIST, someone the promoter deliberately kept alive (EventHostView:
 * `shortList = tentative`, `pipeline = pending`). A sweep that took the short
 * list would delete the promoter's own decisions.
 */
test('the sweep takes only rows nobody has acted on', () => {
  assert.equal(isSweepable('pending'), true);
  assert.equal(isSweepable('new'),     true);
  assert.equal(isSweepable(null),      true, 'a missing status is unanswered');
});

test('⛔ the sweep never takes a decision the promoter already made', () => {
  ['tentative', 'shortlisted', 'interested', 'offered', 'accepted', 'booked', 'confirmed']
    .forEach(st => assert.equal(isSweepable(st), false, `'${st}' would be swept away`));
});

test('⛔ the sweep never re-declines what is already closed', () => {
  ['declined', 'rejected'].forEach(st => assert.equal(isSweepable(st), false));
});

// ── Whose mail is it ────────────────────────────────────────────────────────

/**
 * ⛔⛔ ONLY THE PARTY WHO RECEIVED AN ENQUIRY MAY DECLINE IT. A promoter
 * publishing at a venue they do not own must not touch that venue's enquiries.
 */
test('without an owned venue, no enquiry is even looked at', async () => {
  const sb = fakeSupabase({ enquiries: [{ id: 'e1', status: 'pending', date_requested: DATE, venue_profile_id: VENUE_ID, initiated_by: 'applicant' }] });
  const found = await findOpenAsksForDate({ supabase: sb, eventId: 'ev1', date: DATE });
  assert.deepEqual(found.enquiries, [],
    "another account's enquiries were collected for a bulk decline");
});

test('an owned venue yields its unanswered enquiries for that date', async () => {
  const sb = fakeSupabase({ enquiries: [
    { id: 'e1', status: 'pending',  date_requested: DATE,         venue_profile_id: VENUE_ID, initiated_by: 'applicant' },
    { id: 'e2', status: 'pending',  date_requested: '2026-09-01', venue_profile_id: VENUE_ID, initiated_by: 'applicant' },
    { id: 'e3', status: 'accepted', date_requested: DATE,         venue_profile_id: VENUE_ID, initiated_by: 'applicant' },
  ] });
  const found = await findOpenAsksForDate({ supabase: sb, eventId: 'ev1', date: DATE, venueProfileId: VENUE_ID });
  assert.deepEqual(found.enquiries.map(e => e.id), ['e1'],
    'another date or an already-answered enquiry was swept up');
});

/**
 * ⛔ A venue-initiated row is an INVITATION the venue sent. Sweeping it would
 * cancel the promoter's own outreach.
 */
test('an invitation the venue sent is never swept', async () => {
  const sb = fakeSupabase({ enquiries: [
    { id: 'e1', status: 'pending', date_requested: DATE, venue_profile_id: VENUE_ID, initiated_by: 'venue' },
  ] });
  const found = await findOpenAsksForDate({ supabase: sb, eventId: 'ev1', date: DATE, venueProfileId: VENUE_ID });
  assert.deepEqual(found.enquiries, [], "the venue's own invitation was cancelled by its own booking");
});

test('a dateless event sweeps nothing at all', async () => {
  const sb = fakeSupabase({ applications: [{ id: 'a1', status: 'pending', event_id: 'ev1' }] });
  const found = await findOpenAsksForDate({ supabase: sb, eventId: 'ev1', date: null });
  assert.deepEqual([found.applications, found.enquiries], [[], []]);
});

// ── The decline is an ANSWER ────────────────────────────────────────────────

/**
 * ⚠ THE NOTIFICATION IS THE POINT. A status write with no notice is the silent
 * vanish this mechanism exists to prevent.
 */
test('every declined person is notified', async () => {
  const sent = [];
  const res = await declineOpenAsks({
    supabase: fakeSupabase(),
    writeNotification: async n => { sent.push(n); },
    applications: [{ id: 'a1', artist_id: 'u1', from_profile_id: 'p1', event_id: 'ev1' }],
    enquiries:    [{ id: 'e1', applicant_user_id: 'u2', applicant_profile_id: 'p2', date_requested: DATE }],
    eventName: 'Solstice', venueName: 'Elbows Rest',
  });
  assert.equal(res.declined, 2);
  assert.equal(res.notified, 2, 'someone was declined and never told');
  assert.deepEqual(sent.map(n => n.toUserId), ['u1', 'u2']);
});

/**
 * ⭐ The row already names the profile that asked — never re-derived. Deriving
 * is what addressed a host's reply to their DJ act (2026-08-11).
 */
test('the notice goes to the profile the row names', async () => {
  const sent = [];
  await declineOpenAsks({
    supabase: fakeSupabase(),
    writeNotification: async n => { sent.push(n); },
    enquiries: [{ id: 'e1', applicant_user_id: 'u2', applicant_profile_id: 'host-profile', date_requested: DATE }],
    resolveToProfileId: async () => 'SOME-PERFORMER-PROFILE',
  });
  assert.equal(sent[0].toProfileId, 'host-profile',
    'the decline was addressed to a re-derived profile that never asked');
});

test('the seam resolves a profile only when the row has none', async () => {
  const sent = [];
  await declineOpenAsks({
    supabase: fakeSupabase(),
    writeNotification: async n => { sent.push(n); },
    enquiries: [{ id: 'e1', applicant_user_id: 'u2', applicant_profile_id: null, date_requested: DATE }],
    resolveToProfileId: async () => 'legacy-profile',
  });
  assert.equal(sent[0].toProfileId, 'legacy-profile', 'a legacy row now notifies nobody');
});

/**
 * ⛔ The write re-asserts the status filter. A row shortlisted between the
 * dialog opening and the confirmation must not be swept by a decision made
 * about a list that no longer describes it.
 */
test('the write re-checks the status it read', async () => {
  const sb = fakeSupabase();
  await declineOpenAsks({
    supabase: sb, writeNotification: async () => {},
    applications: [{ id: 'a1', artist_id: 'u1' }],
  });
  const w = sb.writes.find(x => x.table === 'applications');
  assert.deepEqual(w.update, { status: 'declined' });
  assert.ok(w.filters['in:status'], 'a row moved forward mid-dialog would still be declined');
});

test('one undeliverable notice does not abort the rest', async () => {
  let n = 0;
  const res = await declineOpenAsks({
    supabase: fakeSupabase(),
    writeNotification: async () => { if (++n === 1) throw new Error('down'); },
    applications: [{ id: 'a1', artist_id: 'u1' }, { id: 'a2', artist_id: 'u2' }],
  });
  assert.equal(res.notified, 1);
  assert.equal(res.failed, 1);
});

test('a recipient with no account is counted, never silently skipped', async () => {
  const res = await declineOpenAsks({
    supabase: fakeSupabase(),
    writeNotification: async () => {},
    applications: [{ id: 'a1', artist_id: null }],
  });
  assert.equal(res.failed, 1, 'an undeliverable decline was reported as fine');
});

// ── The trigger ─────────────────────────────────────────────────────────────

// ⚠ Offsets, not fixed windows — this file is CRLF, so a byte budget guessed
// from reading it on screen runs out early and fails a rule that holds.
const idx = needle => HOST_VIEW.indexOf(needle);

test('publishing is what locks the date', () => {
  const publish = idx("update({ status: 'live' })");
  const sweep   = HOST_VIEW.indexOf('findOpenAsksForDate', publish);
  assert.ok(publish > 0 && sweep > publish,
    'going live no longer checks who is still queued for the date');
});

/**
 * ⛔ AFTER the publish, never as a condition of it. A failure to read the
 * funnel must not stop an event going live.
 */
test('the sweep never blocks the publish', () => {
  const publish = idx("update({ status: 'live' })");
  const commit  = HOST_VIEW.indexOf('setGoLiveConfirm(false)', publish);
  const sweep   = HOST_VIEW.indexOf('findOpenAsksForDate', publish);
  assert.ok(commit > publish && sweep > commit,
    'the funnel lookup runs before the publish is committed to the UI');
});

test('the venue is only swept when this account owns it', () => {
  assert.match(HOST_VIEW, /venueProfile\.user_id === session\?\.user\?\.id/,
    "a promoter can decline another account's enquiries by publishing");
  assert.match(HOST_VIEW, /venueProfileId: ownsVenue \? venueProfile\.id : null/);
});

/**
 * ⚠⚠ FOUND BY RUNNING IT, NOT BY READING IT (2026-08-11).
 *
 * The sheet OPENS ITSELF straight after GO LIVE, in the same place. With the
 * confirm button in the conventional right-hand slot — where GO LIVE sits — a
 * second GO LIVE click landed on it and committed an irreversible bulk decline
 * before the dialog had even been seen. It happened on the very first run.
 *
 * ⛔ Two independent guards, because either alone is defeatable: the safe
 * choice occupies the previous click position, AND the destructive one is dead
 * for half a second so a click already in flight cannot reach it.
 */
test('the button under the previous click is the HARMLESS one', () => {
  const sheet = HOST_VIEW.slice(idx('{lockoutAsks && ('), idx('{fillSlot && ('));
  const decline = sheet.indexOf('DECLINE & NOTIFY');
  const leave   = sheet.indexOf('LEAVE THEM');
  assert.ok(decline < leave,
    'the destructive button is back in the slot GO LIVE occupies — a stray second click will bulk-decline');
});

test('the destructive button is disarmed while the sheet appears', () => {
  assert.match(HOST_VIEW, /setLockoutArmed\(true\), 500\)/,
    'the confirm button is live the instant the sheet opens');
  const sheet = HOST_VIEW.slice(idx('{lockoutAsks && ('), idx('{fillSlot && ('));
  assert.match(sheet, /disabled=\{lockoutBusy \|\| !lockoutArmed\}/,
    'the decline button ignores the arming delay');
});

/**
 * ⛔ Only the DESTRUCTIVE button is disarmed. Being unable to dismiss a dialog
 * you never asked to open would be its own bug.
 */
test('the dismiss button is never disarmed', () => {
  const sheet = HOST_VIEW.slice(idx('{lockoutAsks && ('), idx('{fillSlot && ('));
  const leaveBtn = sheet.slice(sheet.lastIndexOf('<button', sheet.indexOf('LEAVE THEM')), sheet.indexOf('LEAVE THEM'));
  assert.doesNotMatch(leaveBtn, /lockoutArmed/, 'the escape hatch can be disabled');
});

test('nothing is declined without an explicit confirmation', () => {
  const sheet = HOST_VIEW.slice(idx('{lockoutAsks && ('), idx('{fillSlot && ('));
  assert.ok(sheet.length > 0, 'the confirmation sheet has moved or gone');
  assert.match(sheet, /LEAVE THEM/, 'there is no way to publish and leave the funnel alone');
  assert.match(sheet, /DECLINE & NOTIFY/);
  assert.match(sheet, /shortlisted, offered a slot or already accepted is left alone/,
    'the sheet does not say what it will NOT touch');
  // ⛔ The decline runs from the button, never from the effect that found them.
  assert.match(sheet, /declineOpenAsks\(\{/);
});
