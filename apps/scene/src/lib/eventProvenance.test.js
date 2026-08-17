import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bookingModel, requiresConfirmation, lineupIsAuthoritative, isImporterSourced,
  LEGACY, IMPORTED, MANAGED,
} from './eventProvenance.js';

test('the three contracts read back as themselves', () => {
  assert.equal(bookingModel({ booking_model: 'legacy' }),   LEGACY);
  assert.equal(bookingModel({ booking_model: 'imported' }), IMPORTED);
  assert.equal(bookingModel({ booking_model: 'managed' }),  MANAGED);
});

/**
 * ⛔⛔ THE ASYMMETRY IS THE WHOLE POINT. Wrongly `legacy` means an event keeps
 * behaving as it does today. Wrongly `managed` means a real, booked, publicly
 * visible bill is downgraded because nobody confirmed a booking made before
 * the concept existed.
 */
test('⛔⛔ anything unknown falls back to legacy, ⛔ NEVER managed', () => {
  for (const ev of [null, undefined, {}, { booking_model: null }, { booking_model: '' },
                    { booking_model: 'MANAGED' }, { booking_model: 'nonsense' }]) {
    assert.equal(bookingModel(ev), LEGACY, `${JSON.stringify(ev)} must grandfather`);
    assert.equal(requiresConfirmation(ev), false);
  }
});

/**
 * ⚠ The app must be SAFE between the migration and the day the Gig Importer is
 * updated: its events arrive with a NULL booking_model and are grandfathered.
 */
test('⚠ an event created before the importer is updated is grandfathered', () => {
  const fresh = { external_ref: 'studio:batch_2026-09-01T00:00:00.000Z:e1', booking_model: null };
  assert.equal(requiresConfirmation(fresh), false);
  assert.equal(lineupIsAuthoritative(fresh), true);
});

test('only a managed event requires two-sided confirmation', () => {
  assert.equal(requiresConfirmation({ booking_model: 'managed' }), true);
  assert.equal(requiresConfirmation({ booking_model: 'legacy' }), false);
  assert.equal(requiresConfirmation({ booking_model: 'imported' }), false);
});

test('legacy and imported lineups are both authoritative', () => {
  assert.equal(lineupIsAuthoritative({ booking_model: 'legacy' }), true);
  assert.equal(lineupIsAuthoritative({ booking_model: 'imported' }), true);
  assert.equal(lineupIsAuthoritative({ booking_model: 'managed' }), false);
});

/**
 * ⛔⛔ SOURCE IS NOT CONTRACT. 62 production rows carry a `studio:` ref and are
 * being backfilled to `legacy`. If any booking rule branched on the ref instead
 * of the model, those rows would silently change contract.
 */
test('⛔⛔ external_ref does NOT decide the contract', () => {
  const grandfathered = { external_ref: 'studio:batch_2026-07-29T04:39:09.170Z:e1', booking_model: 'legacy' };
  assert.equal(bookingModel(grandfathered), LEGACY, 'the ref must not promote it to imported');
  assert.equal(isImporterSourced(grandfathered), true, 'the ref still answers WHERE it came from');

  // ⚠ And the reverse: a managed event with no ref is still managed.
  assert.equal(bookingModel({ booking_model: 'managed' }), MANAGED);
  assert.equal(isImporterSourced({ booking_model: 'managed' }), false);
});

test('isImporterSourced tolerates a missing or odd ref', () => {
  assert.equal(isImporterSourced(null), false);
  assert.equal(isImporterSourced({}), false);
  assert.equal(isImporterSourced({ external_ref: 'other:thing' }), false);
});
