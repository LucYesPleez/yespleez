/**
 * A VENUE DECISION THAT NEVER LANDED, ANNOUNCED AS IF IT HAD.
 *
 * ⛔⛔ THE WRITE CHECKED NOTHING — not `error`, not the rows:
 *
 *     await supabase.from('venue_enquiries').update({ status }).eq('id', id);
 *
 * and then unconditionally moved the card, ran `onAccepted` (which CREATES A
 * DRAFT EVENT or adds the act to an existing one) and told the artist
 * "{venue} accepted your enquiry". RLS filters an UPDATE rather than erroring
 * it, so a refused decision produced a night in the organiser's list, a
 * notification in the artist's, and a row that still said pending.
 *
 * The invariant, both directions:
 *   ERROR or ZERO ROWS → ok:false; the caller's early return makes the state
 *                        change, onAccepted and the notification unreachable
 *   A ROW BACK         → ok:true, and all three may proceed
 */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let result;
const writes = [];

function builder(table) {
  const filters = {};
  const chain = {
    update(values) { chain._values = values; return chain; },
    eq(col, val) { filters[col] = val; return chain; },
    /* ⛔ `.select()` ENDS the chain and is the verification — the recorder only
       observes a write that reaches it, so a bare update would go unseen. */
    select(cols) {
      writes.push({ table, values: chain._values, filters: { ...filters }, cols });
      return Promise.resolve(result);
    },
  };
  return chain;
}

mock.module('./supabase', { exports: { supabase: { from: table => builder(table) } } });

const { updateEnquiryStatus } = await import('./updateEnquiryStatus.js');

beforeEach(() => {
  writes.length = 0;
  result = { data: [{ id: 7 }], error: null };
});

test('⛔⛔ ZERO ROWS is a failure — the RLS refusal shape', () => {
  /* ⚠⚠ error is NULL here. This is precisely the case the old code could not
     see, because there was nothing to see. */
  result = { data: [], error: null };
  return updateEnquiryStatus(7, 'accepted').then(res => {
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'refused');
    assert.equal(res.error, null, 'a refusal carries no error, which is the whole trap');
  });
});

test('⛔ an ERROR is a failure', async () => {
  result = { data: null, error: { message: 'boom' } };
  const res = await updateEnquiryStatus(7, 'accepted');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'error');
  assert.equal(res.error.message, 'boom');
});

test('⛔ a null data payload with no error is still a failure', async () => {
  result = { data: null, error: null };
  const res = await updateEnquiryStatus(7, 'declined');
  assert.equal(res.ok, false);
});

test('⭐ a returned row is success', async () => {
  const res = await updateEnquiryStatus(7, 'accepted');
  assert.equal(res.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].table, 'venue_enquiries');
});

test('⭐ the decision semantics are preserved — the status is written verbatim', async () => {
  /* ⛔ The predicate is NOT broadened or reinterpreted: whatever the screen
     decided is what reaches the column. */
  for (const status of ['shortlisted', 'accepted', 'booked', 'declined', 'interested']) {
    writes.length = 0;
    await updateEnquiryStatus(7, status);
    assert.deepEqual(writes[0].values, { status }, `${status} is written as itself`);
    assert.deepEqual(writes[0].filters, { id: 7 }, 'scoped by id, exactly as before');
  }
});

test('⚠ the write asks for the id back — that IS the verification', async () => {
  await updateEnquiryStatus(7, 'accepted');
  assert.equal(writes[0].cols, 'id', 'minimal representation, not the whole row');
});

test('⛔ a missing id or status writes nothing', async () => {
  for (const args of [[null, 'accepted'], [7, null], [null, null]]) {
    writes.length = 0;
    const res = await updateEnquiryStatus(...args);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'missing-identity');
    assert.deepEqual(writes, []);
  }
});

test('⛔⛔ the screen GUARDS on the result before its three side effects', () => {
  /* ⚠ ONE STRUCTURAL CLAIM, and the one the pure tests cannot make: that the
     optimistic state change, `onAccepted` (which creates an event) and the
     notification all sit AFTER the early return. Without this they could be
     correct here and still fire on a refusal. */
  const src = readFileSync(
    fileURLToPath(new URL('../screens/VenueDashboard.jsx', import.meta.url)), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const i = code.indexOf('async function handleEnquiryRespond');
  assert.ok(i > 0, 'the decision handler must exist');
  const fn = code.slice(i);

  const call   = fn.indexOf('await updateEnquiryStatus(id, status)');
  const guard  = fn.indexOf('if (!res.ok) return;');
  const state  = fn.indexOf('setEnquiries(allEnquiries.map(');
  const accept = fn.indexOf('await onAccepted(enq)');
  const notify = fn.indexOf('await writeNotification(');

  assert.ok(call  > 0, 'the verified write must be used');
  assert.ok(guard > call, 'the guard follows the write');
  assert.ok(state  > guard, 'the card must not move on a refused decision');
  assert.ok(accept > guard, 'a refused decision must not create an event');
  assert.ok(notify > guard, 'and must not tell the artist anything');
  /* ⭐ ORDER PRESERVED: onAccepted still runs BEFORE the notice, so a
     "you're booked" cannot point at a night that does not exist yet. */
  assert.ok(accept < notify, 'onAccepted must still precede the notification');

  assert.ok(!/from\('venue_enquiries'\)\s*\.update\(\{ status \}\)/.test(code),
    'the unverified write must not come back');
});

test('⛔⛔ the dead `interested` NOTIF key is gone — a bucket is not a raw status', () => {
  /**
   * `NOTIF[status]` is keyed on the RAW status being written. `interested` is
   * the OUTGOING BUCKET — the asker's name for the state this side calls
   * `shortlisted` — and appears in enquiryUtils only as a map VALUE, so nothing
   * writes it and the entry could never be selected. The `shortlisted` key
   * already tells the asker; the dead one only made the raw column look as
   * though it could hold a bucket name.
   */
  const src = readFileSync(
    fileURLToPath(new URL('../screens/VenueDashboard.jsx', import.meta.url)), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const i = code.indexOf('const NOTIF = {');
  assert.ok(i > 0, 'the notification map must exist');
  const map = code.slice(i, code.indexOf('};', i));

  /* ⚠ The keys are read by SPLITTING, ⛔ not by building a RegExp from a
     template literal: an escaped b inside one is a BACKSPACE CHARACTER, not a
     word boundary, so the pattern silently matches nothing. That exact
     corruption bit this repo once already, in auLocations. */
  const keys = map.split(/\r?\n/)
    .map(l => (l.trim().match(/^([a-z_]+)\s*:/) || [])[1])
    .filter(Boolean);

  assert.ok(!keys.includes('interested'), 'the bucket name must not be a key');
  // ⭐ and the states that ARE written keep their notices
  for (const k of ['shortlisted', 'accepted', 'booked', 'declined']) {
    assert.ok(keys.includes(k), `${k} must still notify`);
  }
});
