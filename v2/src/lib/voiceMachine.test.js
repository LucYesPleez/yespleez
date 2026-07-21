import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideToggle,
  decideSend,
  isTooShort,
  MIN_DURATION_MS,
} from './voiceMachine.js';

/* ── THE TOGGLE ──────────────────────────────────────────────────── */

test('idle → the toggle starts recording', () => {
  assert.equal(decideToggle({ phase: 'idle' }), 'start');
});

test('recording → the toggle parks, it does NOT send', () => {
  // The whole reason `pending` exists. Under the old hold model, letting go WAS
  // sending; if this ever returns an upload action, stopping and sending have
  // silently become the same act again and nothing can be reviewed.
  assert.equal(decideToggle({ phase: 'recording' }), 'park');
});

test('pending → the toggle starts over rather than doing nothing', () => {
  assert.equal(decideToggle({ phase: 'pending' }), 'start');
});

test('the toggle is inert once the audio has left', () => {
  for (const phase of ['uploading', 'sent']) {
    assert.equal(decideToggle({ phase }), 'ignore', phase);
  }
});

test('an unknown phase is ignored rather than assumed idle', () => {
  // Defensive: a new phase added later must not silently inherit "start" and
  // open a microphone from a state nobody considered.
  assert.equal(decideToggle({ phase: 'something-new' }), 'ignore');
  assert.equal(decideToggle({}), 'ignore');
});

/* ── THE getUserMedia GAP ────────────────────────────────────────── */

test('⚠ a second press DURING startup aborts — it does not open a second microphone', () => {
  // THE DEFECT THIS EXISTS TO PREVENT.
  //
  // `phase` is still 'idle' for the whole permission prompt, because the
  // recorder does not exist yet. If `starting` were not checked, this would
  // return 'start' and a second getUserMedia would open a microphone that
  // nothing holds a reference to — unstoppable, invisible, still recording.
  assert.equal(decideToggle({ phase: 'idle', starting: true }), 'abort-start');
});

test('`starting` wins over EVERY phase, not just idle', () => {
  // The check is first for a reason. Ordering it after the phase table would
  // pass the idle case above while still leaking on any other.
  for (const phase of ['idle', 'recording', 'pending', 'uploading', 'sent']) {
    assert.equal(decideToggle({ phase, starting: true }), 'abort-start', phase);
  }
});

test('a missing `starting` means not starting', () => {
  assert.equal(decideToggle({ phase: 'idle' }), 'start');
  assert.equal(decideToggle({ phase: 'idle', starting: false }), 'start');
});

/* ── SEND ────────────────────────────────────────────────────────── */

test('send stops and uploads while recording', () => {
  assert.equal(decideSend({ phase: 'recording' }), 'stop-and-upload');
});

test('send uploads the parked note while pending', () => {
  assert.equal(decideSend({ phase: 'pending' }), 'upload-parked');
});

test('send does nothing when there is no audio', () => {
  for (const phase of ['idle', 'uploading', 'sent', undefined]) {
    assert.equal(decideSend({ phase }), 'ignore', String(phase));
  }
});

test('send is ignored mid-upload, so a double press cannot send twice', () => {
  assert.equal(decideSend({ phase: 'uploading' }), 'ignore');
});

/* ── TOO SHORT ───────────────────────────────────────────────────── */

test('a recording at the threshold is long enough', () => {
  // Boundary: at exactly MIN it must pass, or the notice fires on a note the
  // user genuinely made.
  assert.equal(isTooShort({ durationMs: MIN_DURATION_MS }), false);
});

test('a recording one millisecond under is too short', () => {
  assert.equal(isTooShort({ durationMs: MIN_DURATION_MS - 1 }), true);
});

test('an unmeasurable result is too short, not assumed valid', () => {
  // Something whose length nothing knows must not be uploaded.
  assert.equal(isTooShort(null), true);
  assert.equal(isTooShort(undefined), true);
  assert.equal(isTooShort({}), true);
  assert.equal(isTooShort({ durationMs: '900' }), true);
  assert.equal(isTooShort({ durationMs: NaN }), true);
});

test('a long recording is never too short', () => {
  assert.equal(isTooShort({ durationMs: 6 * 60 * 1000 }), false);
});
