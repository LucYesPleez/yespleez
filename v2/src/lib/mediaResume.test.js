import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { claimAudio, finishAudio, releaseAudio, forgetAudio, resetAudio, parkedAudio, SHORT } from './mediaSession.js';
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

// ── SCENARIO 5 · SWITCHING PROVIDERS WHILE A MIX IS PARKED ────────────
//
// The failure this guards is invisible unless an interruption and a provider
// switch overlap: the manager holds a parked reference to a widget that has
// since been replaced, and resuming drives a dead iframe.

test('⚠ 5 · switching provider while parked does NOT resume the dead one', async () => {
  const { p: sc, source: scSource } = fakeProvider({ position: 60_000 });
  const voicey = shortSource();

  claimAudio(scSource);
  claimAudio(voicey);                 // SoundCloud parks

  forgetAudio(scSource);              // the url changed to a Mixcloud track

  await finishAudio(voicey);
  await new Promise(r => setTimeout(r, 0));

  assert.equal(sc.played, 0, 'a replaced widget must never be driven');
  assert.deepEqual(sc.seeks, [], 'and must never be seeked');
});

test('the NEW provider is unaffected by the old one being forgotten', async () => {
  const { source: scSource } = fakeProvider({ position: 60_000 });
  const { p: mc, source: mcSource } = fakeProvider({ position: 5_000 });

  claimAudio(scSource);
  forgetAudio(scSource);
  claimAudio(mcSource);               // Mixcloud takes over

  const voicey = shortSource();
  claimAudio(voicey);
  await finishAudio(voicey);
  await new Promise(r => setTimeout(r, 0));

  assert.equal(mc.played, 1, 'the live provider still resumes normally');
  assert.deepEqual(mc.seeks, [5_000]);
});

test('⚠ forgetAudio and releaseAudio differ ONLY in whether parked survives', async () => {
  // releaseAudio is a manual pause — the mix underneath must be kept, so the
  // listener can still bring it back by hand. Conflating the two would discard
  // it on every Voicey pause.
  const { source } = fakeProvider({ position: 1_000 });
  const voicey = shortSource();

  claimAudio(source);
  claimAudio(voicey);
  releaseAudio(voicey);
  assert.equal(parkedAudio(), source, 'a manual pause keeps the mix parked');

  forgetAudio(source);
  assert.equal(parkedAudio(), null, 'a destroyed provider is dropped entirely');
});

// ── THE INTERRUPTION FADE ─────────────────────────────────────────────

function fadeProvider() {
  const vol = [];
  const src = createResumableSource({
    id: 'fadey', position: 10_000,
    pause: () => {}, play: () => {},
    getPosition: () => 10_000, seekTo: () => {},
    setVolume: v => vol.push(+v.toFixed(3)),
  });
  return { vol, src };
}

test('⚠ parking DUCKS the volume down rather than snapping to silence', async () => {
  const { vol, src } = fadeProvider();
  src.pause();
  await new Promise(r => setTimeout(r, 350));   // let the ramp finish

  // The sequence is duck-to-zero, THEN pause, THEN reset to 1 — so the trailing
  // value is 1, in readiness for the next independent play. The duck itself is
  // everything before that reset.
  const duck = vol.slice(0, -1);
  assert.ok(duck.length >= 5, 'a fade is several steps, not one jump');
  assert.ok(duck[0] > duck[duck.length - 1], 'volume descends');
  assert.equal(duck[duck.length - 1], 0, 'and reaches silence before pausing');
  assert.equal(vol[vol.length - 1], 1, 'then resets to full for the next independent play');
});

test('resuming fades back UP from silence', async () => {
  const { vol, src } = fadeProvider();
  src.pause();
  await new Promise(r => setTimeout(r, 350));
  vol.length = 0;

  await src.resume();
  await new Promise(r => setTimeout(r, 350));

  assert.equal(vol[0], 0, 'starts silent so the seek is inaudible');
  assert.equal(vol[vol.length - 1], 1, 'and climbs back to full');
});

test('a provider with no setVolume simply cuts — nothing breaks', () => {
  const src = createResumableSource({
    id: 'plain', pause: () => {}, play: () => {},
    getPosition: () => 0, seekTo: () => {},
  });
  src.pause();          // must not throw despite no setVolume
  assert.equal(src.parkedState()?.provider, 'plain');
});

test('⚠ a resume that interrupts a duck must not be paused by the stale fade', async () => {
  const calls = [];
  const src = createResumableSource({
    id: 'racey', position: 5_000,
    pause: () => calls.push('pause'), play: () => calls.push('play'),
    getPosition: () => 5_000, seekTo: () => calls.push('seek'),
    setVolume: () => {},
  });

  src.pause();                          // starts a duck-then-pause
  await new Promise(r => setTimeout(r, 40));   // mid-ramp
  await src.resume();                   // supersedes it — must cancel the pause
  await new Promise(r => setTimeout(r, 350));  // let the superseded ramp finish

  assert.ok(calls.includes('play'), 'resume must have played');
  assert.equal(calls.filter(c => c === 'pause').length, 0,
    'the stale duck must not pause what the newer resume just started');
});
