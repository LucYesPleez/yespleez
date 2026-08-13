import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tallySlots, tallySummary } from './slotTally.js';

/**
 * THE COUNT THAT WAS FLATTERING THE ORGANISER.
 *
 * These are written against the real Bass Heavy running order (3 Oct 2026),
 * because the defect was found on it and a synthetic fixture would not have
 * shown it: the event has one accepted act, two offers nobody answered for five
 * weeks, one slot never sent, and one decline. The shipped count called that
 * "4 of 5 filled".
 */

const bassHeavy = () => ([{
  name: '',
  slots: [
    { id: 'ehkh62' },   // 7pm  · declined
    { id: 'gxr1ca' },   // 8pm  · accepted
    { id: '6mz65k' },   // 9pm  · offered, unanswered
    { id: 'yv3nqq' },   // 10pm · offered, unanswered
    { id: 'f4ex0e' },   // 11pm · draft, never sent
  ],
}]);

const bassHeavyClaims = () => ({
  ehkh62: { status: 'declined'  },
  gxr1ca: { status: 'confirmed' },
  '6mz65k': { status: 'offered' },
  yv3nqq: { status: 'offered'   },
  f4ex0e: { status: 'draft'     },
});

test('⚠ an unanswered offer is NOT a filled slot', () => {
  const t = tallySlots(bassHeavy(), bassHeavyClaims());

  // THE REGRESSION. `status !== 'declined'` counted 4 here — the two standing
  // offers and the unsent draft all read as booked.
  assert.equal(t.filled, 1, 'only the act that actually accepted');
  assert.notEqual(t.filled, 4, 'the shipped count, preserved so it cannot come back');
  assert.equal(t.total, 5);
});

test('every state is reported, because they are different problems', () => {
  const t = tallySlots(bassHeavy(), bassHeavyClaims());

  assert.equal(t.confirmed, 1, 'agreed to play');
  assert.equal(t.awaiting,  2, 'asked, no answer yet');
  assert.equal(t.unsent,    1, 'never asked');
  assert.equal(t.declined,  1, 'said no');
});

test('⚠ a declined slot counts as EMPTY — it needs refilling like any other', () => {
  const t = tallySlots(bassHeavy(), bassHeavyClaims());
  // 7pm (declined) + 9pm, 10pm, 11pm are all still unfilled.
  assert.equal(t.empty, 1, 'the declined one');
  assert.equal(t.confirmed + t.awaiting + t.unsent + t.empty, t.total,
    'every slot is accounted for exactly once');
});

test('the organiser count and the public count now agree on what "filled" means', () => {
  // A punter reads through SEC-2 and can only ever see `accepted` rows, so
  // their claims map holds one entry. Both viewers must reach the same number,
  // or the host is looking at a different night from their audience.
  const publicClaims = { gxr1ca: { status: 'confirmed' } };
  assert.equal(
    tallySlots(bassHeavy(), publicClaims).filled,
    tallySlots(bassHeavy(), bassHeavyClaims()).filled,
  );
});

test('an empty running order counts nothing rather than dividing by it', () => {
  assert.deepEqual(tallySlots([], {}), {
    total: 0, confirmed: 0, awaiting: 0, unsent: 0, declined: 0, empty: 0, filled: 0,
  });
  assert.equal(tallySummary(tallySlots([], {})), null, 'nothing to say, so say nothing');
});

test('missing days, missing slots and missing claims are all survivable', () => {
  assert.equal(tallySlots(undefined, undefined).total, 0);
  assert.equal(tallySlots([{ name: 'Day 1' }], {}).total, 0, 'a day with no slots array');
  assert.equal(tallySlots([{ slots: [{ id: 'a' }] }], {}).empty, 1, 'a slot nobody claimed');
});

test('a claim on a slot that no longer exists is not counted', () => {
  // performances.slot_id is a plain string join into JSON with no foreign key,
  // so an orphaned claim is a real state. It must not inflate the total.
  const t = tallySlots([{ slots: [{ id: 'a' }] }], { a: { status: 'confirmed' }, ghost: { status: 'confirmed' } });
  assert.equal(t.total, 1);
  assert.equal(t.confirmed, 1, 'the orphan is invisible to the tally, not double counted');
});

test('multi-day running orders sum across days', () => {
  const days = [
    { name: 'Friday',   slots: [{ id: 'a' }, { id: 'b' }] },
    { name: 'Saturday', slots: [{ id: 'c' }] },
  ];
  const t = tallySlots(days, { a: { status: 'confirmed' }, c: { status: 'confirmed' } });
  assert.equal(t.total, 3);
  assert.equal(t.filled, 2);
});
