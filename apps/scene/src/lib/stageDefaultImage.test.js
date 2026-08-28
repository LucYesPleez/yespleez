/**
 * THE STAGE'S OWN PICTURE — pinned to the real stage names, and to the LIMITS.
 *
 * ⚠ These tests exist as much to hold the mechanism SMALL as to prove it works.
 * A "guess the vibe from the stage name" matcher would quietly start deciding
 * things nobody asked it to; the assertions below say what it must NOT answer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stageDefaultImage } from './stageDefaultImage.js';

test("Neverland's real stage name resolves", () => {
  // The exact string in event_stages for Neverland Weekender.
  assert.equal(stageDefaultImage('WORKSHOPS & GALLERY'), '/defaultworkshop.jpg');
});

test('the gallery half matches on its own', () => {
  // ⭐ The Saturday 1pm booking is the ART GALLERY, and on this event it shares
  // the workshops stage. If they are ever split into two stages, the gallery
  // must still find a picture rather than falling back to a DJ.
  assert.equal(stageDefaultImage('ART GALLERY'), '/defaultworkshop.jpg');
});

test('case and surrounding words do not matter', () => {
  assert.equal(stageDefaultImage('Sunday Workshop Tent'), '/defaultworkshop.jpg');
});

test('a music stage says NOTHING and leaves the type default alone', () => {
  // ⛔ Returning an image here would put a yoga photo on the DJ stage — the same
  // defect in reverse. Null means "no opinion", and SlotCard's existing
  // profileIdentity fallback runs untouched.
  for (const name of ['LIVE STAGE', 'DJ STAGE', 'Main Stage']) {
    assert.equal(stageDefaultImage(name), null, `${name} must not claim an image`);
  }
});

test('no stage at all is not an error', () => {
  // A single-stage event has stageName null by design: that IS the implicit
  // stage, and it must behave exactly as it did before this existed.
  assert.equal(stageDefaultImage(null), null);
  assert.equal(stageDefaultImage(undefined), null);
  assert.equal(stageDefaultImage(''), null);
});

/* ── The bill's order ──────────────────────────────────────────────────
   ⭐ The image default and the LINEUP order are two consequences of one fact,
   so they must never be able to disagree — the picture saying "workshop" while
   the ordering says "music". One predicate, asked twice. */
test('the same stages that lend the picture are the ones that read last', async () => {
  const { isWorkshopStage } = await import('./stageDefaultImage.js');
  assert.equal(isWorkshopStage('WORKSHOPS & GALLERY'), true);
  assert.equal(isWorkshopStage('ART GALLERY'), true);
  assert.equal(isWorkshopStage('LIVE STAGE'), false);
  assert.equal(isWorkshopStage('DJ STAGE'), false);
  assert.equal(isWorkshopStage(null), false, 'a single-stage event has no stage opinion');
});
