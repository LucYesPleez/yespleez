import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { claimPlayback, releasePlayback, currentPlayback } from './voicePlayback.js';

/** Stands in for an <audio>: only pause() and a paused flag are ever touched. */
function fakeAudio(name) {
  return { name, paused: true, pause() { this.paused = true; }, play() { this.paused = false; } };
}

beforeEach(() => releasePlayback(currentPlayback()));

test('a second note silences the first', async () => {
  // The whole point. Media elements do not compete for audio focus, so without
  // this two voice notes play over each other.
  const a = fakeAudio('a'); const b = fakeAudio('b');

  claimPlayback(a); a.play();
  assert.equal(a.paused, false);

  claimPlayback(b); b.play();
  assert.equal(a.paused, true, 'the first must be paused by the second');
  assert.equal(b.paused, false);
  assert.equal(currentPlayback(), b);
});

test('claiming twice with the same element does not pause it', async () => {
  // Play → pause → play on ONE note must not have the second claim stop the
  // audio it just started.
  const a = fakeAudio('a');
  claimPlayback(a); a.play();
  claimPlayback(a);
  assert.equal(a.paused, false);
});

test('pausing the current note releases the claim', async () => {
  const a = fakeAudio('a');
  claimPlayback(a);
  releasePlayback(a);
  assert.equal(currentPlayback(), null);
});

test('a late release from an old element cannot steal a newer claim', async () => {
  // Pause and unmount can arrive in either order. An old element releasing
  // after a new one has claimed would leave the new note playing with nothing
  // registered — and the note after THAT would not silence it.
  const a = fakeAudio('a'); const b = fakeAudio('b');
  claimPlayback(a);
  claimPlayback(b);
  releasePlayback(a);                       // arrives late
  assert.equal(currentPlayback(), b, 'b must still hold the claim');

  const c = fakeAudio('c');
  claimPlayback(c);
  assert.equal(b.paused, true, 'and b must still be pausable by the next note');
});

test('an element that throws on pause does not break the handover', async () => {
  // A node removed from the DOM mid-playback can throw. The new note must still
  // start — refusing to play because the old one could not be stopped is the
  // worse failure.
  const dead = { pause() { throw new Error('detached'); } };
  const next = fakeAudio('next');

  claimPlayback(dead);
  assert.doesNotThrow(() => claimPlayback(next));
  assert.equal(currentPlayback(), next);
});

test('claiming nothing is a no-op rather than a crash', async () => {
  const a = fakeAudio('a');
  claimPlayback(a); a.play();

  assert.doesNotThrow(() => claimPlayback(null));
  assert.equal(currentPlayback(), a, 'a null claim must not clear a real one');
  assert.equal(a.paused, false, 'and must not stop the audio that is playing');
});
