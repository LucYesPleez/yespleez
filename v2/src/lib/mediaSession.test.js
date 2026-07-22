import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  claimAudio, finishAudio, releaseAudio, resetAudio,
  currentAudio, parkedAudio, LONG, SHORT,
} from './mediaSession.js';

beforeEach(resetAudio);

/** A source that records what was done to it. */
function source(kind, { resumable = true } = {}) {
  const s = { kind, paused: 0, resumed: 0 };
  s.pause = () => { s.paused++; };
  if (resumable) s.resume = () => { s.resumed++; };
  return s;
}

test('only one source holds audio at a time', () => {
  const a = source(SHORT), b = source(SHORT);

  claimAudio(a);
  claimAudio(b);

  assert.equal(a.paused, 1, 'the previous holder must be stopped');
  assert.equal(currentAudio(), b);
});

// ── THE FEATURE: A VOICEY INTERRUPTS A SET, THE SET COMES BACK ────────

test('⚠ short-form parks long-form and resumes it on completion', () => {
  const set = source(LONG), voicey = source(SHORT);

  claimAudio(set);
  claimAudio(voicey);

  assert.equal(set.paused, 1, 'the set pauses');
  assert.equal(parkedAudio(), set, 'and is remembered');
  assert.equal(set.resumed, 0, 'but not yet resumed');

  finishAudio(voicey);

  assert.equal(set.resumed, 1, 'the set comes back by itself');
  assert.equal(currentAudio(), set, 'and holds the claim again, so it can be interrupted twice');
});

test('a set interrupted twice still resumes the second time', () => {
  const set = source(LONG);
  claimAudio(set);

  for (const _ of [1, 2]) {
    const v = source(SHORT);
    claimAudio(v);
    finishAudio(v);
  }

  assert.equal(set.resumed, 2);
});

test('⚠ two Voiceys in a row do not resume the first — that is moving on, not interrupting', () => {
  const first = source(SHORT), second = source(SHORT);

  claimAudio(first);
  claimAudio(second);
  finishAudio(second);

  assert.equal(first.resumed, 0, 'a player fighting its listener');
  assert.equal(currentAudio(), null);
});

test('⚠ the SET resumes even when a Voicey was interrupted by another Voicey', () => {
  // Only one level of parking: the middle link is short-form and was never
  // resumable, so the long-form source underneath is still what comes back.
  const set = source(LONG), v1 = source(SHORT), v2 = source(SHORT);

  claimAudio(set);
  claimAudio(v1);
  claimAudio(v2);
  finishAudio(v2);

  assert.equal(set.resumed, 1);
  assert.equal(v1.resumed, 0);
});

test('long-form replacing long-form is a handover, never a resume', () => {
  const first = source(LONG), second = source(LONG);

  claimAudio(first);
  claimAudio(second);
  finishAudio(second);

  assert.equal(first.resumed, 0, 'choosing another set is not an interruption');
  assert.equal(parkedAudio(), null);
});

test('a long-form source that cannot resume is simply not resumed', () => {
  const set = source(LONG, { resumable: false }), voicey = source(SHORT);

  claimAudio(set);
  claimAudio(voicey);
  finishAudio(voicey);

  assert.equal(set.paused, 1);
  assert.equal(parkedAudio(), null, 'nothing is held that cannot be brought back');
});

// ── PAUSE IS NOT COMPLETION ──────────────────────────────────────────

test('⚠ pausing a Voicey does NOT resume the music — silence was the request', () => {
  const set = source(LONG), voicey = source(SHORT);

  claimAudio(set);
  claimAudio(voicey);
  releaseAudio(voicey);

  assert.equal(set.resumed, 0);
  assert.equal(currentAudio(), null);
  assert.equal(parkedAudio(), set, 'but the set is still remembered, so it can be resumed by hand');
});

test('a stale release from an old source cannot clear a newer claim', () => {
  const a = source(SHORT), b = source(SHORT);

  claimAudio(a);
  claimAudio(b);
  releaseAudio(a);          // arrives late, after b took over

  assert.equal(currentAudio(), b);
});

test('finishing a source that no longer holds audio does nothing', () => {
  const a = source(SHORT), b = source(LONG);

  claimAudio(b);
  finishAudio(a);

  assert.equal(currentAudio(), b, 'an unmounting component must not stop the current track');
});

test('a source with no pause is refused rather than half-registered', () => {
  claimAudio({ kind: SHORT });
  assert.equal(currentAudio(), null);
});
