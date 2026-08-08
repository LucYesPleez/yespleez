import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideToggle,
  decideSend,
  decideInterrupt,
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

test('⚠ pending → the toggle CONTINUES the parked note, it never starts over', () => {
  // THE DEFECT THIS EXISTS TO PREVENT, found on a real device 2026-07-25.
  //
  // This asserted 'start' until a phone call interrupted a real Voicey: the
  // owner pressed the microphone — the same button they had been using, and
  // the obvious one on screen — and the parked recording was discarded and
  // restarted from zero. The note survived the interruption and was destroyed
  // by the UI.
  //
  // Owner's strengthened constitutional rule: "If a parked Voicey exists, no
  // recording control may implicitly discard it. The user must explicitly
  // choose Continue, Send, Delete or Discard before a new recording can
  // begin." A product rule, not a platform workaround — it holds even where
  // interruption detection never fires.
  assert.equal(decideToggle({ phase: 'pending' }), 'resume');
});

test('⚠ NO toggle result may implicitly destroy parked audio', () => {
  // The rule stated as a property rather than a case, so a future phase that
  // can hold audio cannot regress it by being added to the wrong branch.
  // 'start' clears pendingRef and every segment; reaching it from a state that
  // holds audio is the destruction this forbids.
  for (const phase of ['pending']) {
    const action = decideToggle({ phase });
    assert.notEqual(
      action, 'start',
      `${phase} holds user audio — '${action}' must not be the discarding 'start'`,
    );
  }
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

/* ── INTERRUPTION ────────────────────────────────────────────────── */

test('⚠ an interruption while recording PARKS — the recording is never lost', () => {
  // THE CONSTITUTIONAL RULE. Your friend's phone call landed here: recording,
  // interrupted, and under the old code the note vanished. Parking turns the
  // interruption into a draft — the same three choices (send/replay/delete) a
  // clean stop gives. If this ever returns 'ignore' for 'recording', a call
  // silently destroys a recording again.
  assert.equal(decideInterrupt({ phase: 'recording' }), 'park');
});

test('an interruption while already parked does nothing — the draft is already safe', () => {
  assert.equal(decideInterrupt({ phase: 'pending' }), 'ignore');
});

test('an interruption is inert once idle or past the point of no return', () => {
  // idle: nothing to save. uploading/sent: the audio has already left, and a
  // late pipeline event (the mic finally releasing after we stopped) must not
  // resurrect a phase.
  for (const phase of ['idle', 'uploading', 'sent', undefined]) {
    assert.equal(decideInterrupt({ phase }), 'ignore', String(phase));
  }
});

test('an unknown phase is not treated as recording', () => {
  // Only the one phase that holds live capture may park. Anything unrecognised
  // must not trigger a salvage of a recorder that is not there.
  assert.equal(decideInterrupt({ phase: 'something-new' }), 'ignore');
  assert.equal(decideInterrupt({}), 'ignore');
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
