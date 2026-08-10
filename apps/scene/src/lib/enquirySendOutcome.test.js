import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ⚠⚠ AN ENQUIRY THAT DID NOT SEND MUST NOT LOOK LIKE ONE THAT DID.
 *
 * `venue_enquiries` carries UNIQUE (venue_user_id, applicant_user_id,
 * date_requested). A second enquiry for the same date is rejected — and the
 * rejection used to be swallowed as noise while the sheet closed on that path,
 * which is exactly what a SUCCESS looks like. An artist believed they had
 * enquired; no row existed; no notification fired; they waited for a reply the
 * venue was never asked to make.
 *
 * Found 2026-08-10 by reading the database after a send that looked perfect on
 * screen — which is the only reason it was found at all.
 */

const PROFILE = readFileSync(fileURLToPath(new URL('../screens/ProfileScreen.jsx', import.meta.url)), 'utf8');
const sendFn = (() => {
  // ⚠ `async function sendEnquiry` also prefix-matches `sendEnquiryAndSuppress`,
  // which is declared FIRST — anchor on the empty parameter list.
  const from = PROFILE.indexOf('async function sendEnquiry()');
  assert.ok(from > 0, 'sendEnquiry() not found — did it get renamed?');
  return PROFILE.slice(from, PROFILE.indexOf('\n  }', from));
})();

test('a duplicate is recognised by SQLSTATE, not only by message text', () => {
  // The message string is a Postgres/PostgREST detail that can change between
  // versions; 23505 is the contract.
  assert.match(sendFn, /error\.code === '23505'/,
    'duplicate detection depends entirely on error-message wording');
});

test('every failure path sets something the person can read', () => {
  assert.match(sendFn, /setEnquiryError\(/, 'a failure leaves nothing on screen');
  // Both branches: the duplicate explanation and the generic failure.
  assert.match(sendFn, /already enquired/i);
  assert.match(sendFn, /did not send/i);
});

/**
 * ⚠ Asserted by CONTENT, not by a character count — an earlier version of this
 * test used `returnAt < 600` and failed when the message copy grew by sixty
 * characters. What matters is that nothing consequential happens between
 * detecting the error and leaving.
 */
test('a failure RETURNS before anything consequential happens', () => {
  const errBlock = sendFn.slice(sendFn.indexOf('if (error) {'));
  const returnAt = errBlock.indexOf('return;');
  assert.ok(returnAt > 0, 'the error branch never returns — execution continues into the success path');
  const beforeReturn = errBlock.slice(0, returnAt);
  assert.doesNotMatch(beforeReturn, /writeNotification/,
    'a notification is written for an enquiry that failed to store');
  assert.doesNotMatch(beforeReturn, /setPickerDate\(null\)/,
    'the sheet is torn down before the failure is shown');
});

test('the sheet is NOT closed on a failure — closing is what hid the bug', () => {
  const errBlock = sendFn.slice(sendFn.indexOf('if (error) {'), sendFn.indexOf('return;'));
  assert.doesNotMatch(errBlock, /setEnquiryProf\(null\)|setPickerDate\(null\)/,
    'a failed send tears the sheet down exactly as a successful one does');
});

test('the note survives a failed send', () => {
  const errBlock = sendFn.slice(sendFn.indexOf('if (error) {'), sendFn.indexOf('return;'));
  assert.doesNotMatch(errBlock, /setEnquiryNote\(''\)/,
    'a failed send throws away what they wrote');
});

test('the notification is only written for a row that actually exists', () => {
  assert.match(sendFn, /if \(inserted\?\.id\) \{/,
    'a notification could be sent for an enquiry that was never stored');
});

test('the stale message is cleared whenever the target changes', () => {
  // A message about last Tuesday must not sit above a fresh attempt.
  assert.match(PROFILE, /setPickerDate\(dateStr\);\s*\n\s*\/\/[^\n]*\n\s*setEnquiryError\(''\)/,
    'picking a new date leaves the previous failure on screen');
});

test('the message renders in the sheet, not only in the console', () => {
  assert.match(PROFILE, /\{enquiryError && \(/,
    'the failure is stored in state but never displayed');
});
