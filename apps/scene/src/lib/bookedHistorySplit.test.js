import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBookedRow, isUpcomingBooking, isPastBooking } from './enquiryUtils.js';
import { dateStr, today } from './dates.js';

/**
 * ⭐⭐ BOOKED AND HISTORY ARE ONE SET SPLIT BY TODAY.
 *
 * Every profile type has both tabs, so the split has to hold for a venue's
 * accepted enquiry exactly as it does for an act's gig. These tests exist
 * because the failure is SILENT either way: a row in neither tab simply is not
 * there, and a row in both is only noticed by someone counting.
 */

const YESTERDAY = dateStr(-1);
const TOMORROW  = dateStr(1);

test('an accepted enquiry for a future night is BOOKED, not HISTORY', () => {
  const row = { status: 'accepted', date_requested: TOMORROW };
  assert.equal(isUpcomingBooking(row), true);
  assert.equal(isPastBooking(row), false);
});

test('an accepted enquiry for a night already past is HISTORY, not BOOKED', () => {
  const row = { status: 'accepted', date_requested: YESTERDAY };
  assert.equal(isPastBooking(row), true);
  assert.equal(isUpcomingBooking(row), false);
});

/* ⛔⛔ TODAY IS NOT PAST. A gig tonight is a booking the owner still has to
   act on, and sweeping it into HISTORY at midnight would take the most
   time-critical row off the tab they are watching. */
test("tonight's booking stays in BOOKED all day", () => {
  const row = { status: 'booked', date_requested: today() };
  assert.equal(isUpcomingBooking(row), true);
  assert.equal(isPastBooking(row), false);
});

/* ⛔⛔ ABSENT IS NOT PAST — the rendering contract's own distinction. A booking
   with no date has not been shown to have happened. */
test('a booking with no date stays in BOOKED rather than ageing out', () => {
  const row = { status: 'accepted' };
  assert.equal(isUpcomingBooking(row), true);
  assert.equal(isPastBooking(row), false);
});

test('preferred_date is read when date_requested is absent', () => {
  assert.equal(isPastBooking({ status: 'accepted', preferred_date: YESTERDAY }), true);
  assert.equal(isUpcomingBooking({ status: 'accepted', preferred_date: TOMORROW }), true);
});

/* A booked row is booked whichever direction it was asked in — the split asks
   about STATUS and must never consult `direction`. */
test('direction does not decide either tab', () => {
  for (const direction of ['incoming', 'outgoing', undefined]) {
    assert.equal(isUpcomingBooking({ status: 'booked', direction, date_requested: TOMORROW }), true);
    assert.equal(isPastBooking({ status: 'booked', direction, date_requested: YESTERDAY }), true);
  }
});

/* ⛔ NEITHER TAB CLAIMS AN UNSETTLED ROW. A pending or declined enquiry belongs
   to its direction's pipeline; putting it in HISTORY because its date passed
   would file a refusal as a gig that happened. */
test('unbooked rows appear in neither tab, whatever their date', () => {
  for (const status of ['pending', 'new', 'seen', 'shortlisted', 'declined', 'rejected']) {
    for (const date_requested of [YESTERDAY, TOMORROW]) {
      const row = { status, date_requested };
      assert.equal(isBookedRow(row), false, status);
      assert.equal(isUpcomingBooking(row), false, status);
      assert.equal(isPastBooking(row), false, status);
    }
  }
});

/* ⭐ THE PARTITION ITSELF: every booked row lands in exactly one of the two.
   This is the property the two tabs promise, and it is cheaper to assert than
   to notice. */
test('every booked row is in exactly one of BOOKED and HISTORY', () => {
  const rows = [
    { status: 'accepted', date_requested: YESTERDAY },
    { status: 'accepted', date_requested: today() },
    { status: 'booked',   date_requested: TOMORROW },
    { status: 'booked' },
    { status: 'accepted', preferred_date: YESTERDAY },
  ];
  for (const row of rows) {
    assert.equal(Number(isUpcomingBooking(row)) + Number(isPastBooking(row)), 1);
  }
});
