import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { claimAudio, finishAudio, releaseAudio, resetAudio, SHORT } from './mediaSession.js';
import { createResumableSource } from './mediaProviders.js';

beforeEach(resetAudio);

/**
 * INTEGRATION — the manager and a real resumable source together.
 *
 * `mediaSession.test.js` proves arbitration with fake sources. This proves the
 * two layers actually compose: that parking really captures a position, and
 * that resuming really seeks back to it.
 */

/** A provider that records what was done to it and can withhold readiness. */
function fakeProvider({ position = 0, readyNow = true } = {}) {
  let releaseReady;
  const p = {
    id: 'fake',
    position,
    paused: 0, played: 0, seeks: [],
    ready: readyNow,
    readyPromise: readyNow ? Promise.resolve() : new Promise(r => { releaseReady = r; }),
    becomeReady() { p.ready = true; releaseReady?.(); },
  };
  const adapter = {
    id: 'fake',
    pause: () => { p.paused++; },
    play:  () => { p.played++; },
    getPosition: () => p.position,
    seekTo: ms => { p.seeks.push(ms); p.position = ms; },
    whenReady: () => p.readyPromise,
  };
  return { p, source: createResumableSource(adapter) };
}

const shortSource = () => {
  const s = { kind: SHORT, paused: 0 };
  s.pause = () => { s.paused++; };
  return s;
};

// ── 1 · LONG → Voicey → Voicey ends → LONG resumes ───────────────────

test('⚠ 1 · a demo mix resumes from its position after a Voicey finishes', async () => {
  const { p, source } = fakeProvider({ position: 42_000 });
  const voicey = shortSource();

  claimAudio(source);
  claimAudio(voicey);

  assert.equal(p.paused, 1, 'the mix pauses');
  assert.equal(p.played, 0, 'and does not restart yet');

  await finishAudio(voicey);
  await Promise.resolve();

  assert.deepEqual(p.seeks, [42_000], 'restored to where it was, not to zero');
  assert.equal(p.played, 1);
});

// ── 2 · Two Voiceys, one resume ──────────────────────────────────────

test('⚠ 2 · two Voiceys in a row resume the mix exactly ONCE', async () => {
  const { p, source } = fakeProvider({ position: 12_000 });

  claimAudio(source);

  const first = shortSource();
  claimAudio(first);
  const second = shortSource();
  claimAudio(second);          // interrupts the first Voicey, not the mix

  await finishAudio(second);
  await Promise.resolve();

  assert.equal(p.played, 1, 'resumed once');
  assert.equal(p.paused, 1, 'and was only ever paused once');
  assert.deepEqual(p.seeks, [12_000]);
});

// ── 3 · Manual pause means silence ───────────────────────────────────

test('⚠ 3 · manually pausing the Voicey leaves the mix paused', async () => {
  const { p, source } = fakeProvider({ position: 8_000 });
  const voicey = shortSource();

  claimAudio(source);
  claimAudio(voicey);
  releaseAudio(voicey);        // the user pressed pause
  await Promise.resolve();

  assert.equal(p.played, 0, 'silence was the request');
  assert.deepEqual(p.seeks, []);
});

// ── 4 · Readiness, not timers ────────────────────────────────────────

test('⚠ 4 · resume WAITS for the provider and then restores the position', async () => {
  const { p, source } = fakeProvider({ position: 95_000, readyNow: false });
  const voicey = shortSource();

  claimAudio(source);
  claimAudio(voicey);
  finishAudio(voicey);

  // The provider has not reported ready. Nothing may have happened yet — a
  // timer-driven implementation would have played into a dead iframe by now.
  await Promise.resolve();
  assert.equal(p.played, 0, 'must not play before the provider can be driven');
  assert.deepEqual(p.seeks, [], 'and must not seek either — widgets ignore it silently');

  p.becomeReady();
  await new Promise(r => setTimeout(r, 0));

  assert.deepEqual(p.seeks, [95_000], 'restored from the preserved position');
  assert.equal(p.played, 1);
});

// ── 5 · No LONG source at all ────────────────────────────────────────

test('5 · with nothing long-form playing, Voiceys behave exactly as Phase 1', async () => {
  const a = shortSource(), b = shortSource();

  claimAudio(a);
  claimAudio(b);
  assert.equal(a.paused, 1, 'one at a time still holds');

  await finishAudio(b);
  assert.equal(a.paused, 1, 'nothing is resumed, because nothing was parked');
});

// ── STATE CAPTURE ────────────────────────────────────────────────────

test('the captured state names its provider and position', () => {
  const { source } = fakeProvider({ position: 7_500 });
  const state = source.captureState();

  assert.equal(state.provider, 'fake');
  assert.equal(state.positionMs, 7_500);
});

test('⚠ position is captured BEFORE pausing', () => {
  // A provider that zeroes its playhead on pause would otherwise be recorded at
  // zero, and the set would restart from the beginning.
  let position = 30_000;
  const source = createResumableSource({
    id: 'resets-on-pause',
    pause: () => { position = 0; },
    play: () => {},
    getPosition: () => position,
    seekTo: () => {},
  });

  source.pause();
  assert.equal(source.parkedState().positionMs, 30_000);
});

test('an async getPosition still lands in the parked state', async () => {
  const source = createResumableSource({
    id: 'callback-api',
    pause: () => {}, play: () => {}, seekTo: () => {},
    getPosition: () => Promise.resolve(64_000),
  });

  source.pause();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(source.parkedState().positionMs, 64_000);
});

test('resuming from a position of zero does not seek', async () => {
  const seeks = [];
  const source = createResumableSource({
    id: 'fresh',
    pause: () => {}, play: () => {}, getPosition: () => 0,
    seekTo: ms => seeks.push(ms),
  });

  source.pause();
  await source.resume();

  assert.deepEqual(seeks, [], 'a track at the start needs no seek');
});

test('resume is idempotent — a second call does nothing', async () => {
  const { p, source } = fakeProvider({ position: 5_000 });

  source.pause();
  await source.resume();
  await source.resume();

  assert.equal(p.played, 1, 'the parked state is consumed, not repeated');
});
