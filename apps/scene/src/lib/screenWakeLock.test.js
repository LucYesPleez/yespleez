/**
 * SCREEN WAKE LOCK — the guard on the 29-second Voicey.
 *
 * These exercise the shipped module with a fake navigator/document, because the
 * three failures that matter are all about lifecycle rather than about the
 * platform API:
 *
 *   1. a browser without the API must not break recording (rule 1)
 *   2. a lock the OS takes back must be re-acquired when we return (rule 2)
 *   3. a lock must NOT come back after recording stopped (rule 3) — that one
 *      leaves the user's screen burning and reads as a battery bug
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  acquireScreenWakeLock, releaseScreenWakeLock, isScreenWakeLockHeld,
  __setWakeLockEnv, __resetScreenWakeLock,
} from './screenWakeLock.js';

/** A WakeLockSentinel that records its own release and can be dropped by "the OS". */
function makeSentinel() {
  const listeners = [];
  return {
    released: false,
    addEventListener: (type, fn) => { if (type === 'release') listeners.push(fn); },
    release: async function () { this.released = true; },
    /** What the platform does when the page hides: revokes without asking. */
    revoke() { this.released = true; listeners.forEach(fn => fn()); },
  };
}

/** A document whose visibility can be driven, matching the browser's event. */
function makeDocument() {
  const handlers = new Set();
  return {
    visibilityState: 'visible',
    addEventListener: (type, fn) => { if (type === 'visibilitychange') handlers.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'visibilitychange') handlers.delete(fn); },
    listenerCount: () => handlers.size,
    async setVisibility(state) {
      this.visibilityState = state;
      for (const fn of [...handlers]) await fn();
    },
  };
}

let doc, requests, nextSentinel, requestBehaviour;

function envWithWakeLock() {
  return {
    document: doc,
    navigator: {
      wakeLock: {
        request: async (type) => {
          requests.push(type);
          if (requestBehaviour === 'reject') throw new Error('denied');
          nextSentinel = makeSentinel();
          return nextSentinel;
        },
      },
    },
  };
}

beforeEach(() => {
  __resetScreenWakeLock();
  doc = makeDocument();
  requests = [];
  nextSentinel = null;
  requestBehaviour = 'grant';
  __setWakeLockEnv(envWithWakeLock());
});

test('acquiring asks the platform for a SCREEN lock and holds it', async () => {
  const held = await acquireScreenWakeLock();
  assert.equal(held, true);
  assert.deepEqual(requests, ['screen'], 'the screen is what must stay awake, not the CPU');
  assert.equal(isScreenWakeLockHeld(), true);
});

test('releasing lets the screen sleep again', async () => {
  await acquireScreenWakeLock();
  const sentinel = nextSentinel;
  await releaseScreenWakeLock();
  assert.equal(sentinel.released, true);
  assert.equal(isScreenWakeLockHeld(), false);
});

test('⚠ RULE 1 · a browser with no wake-lock API degrades, it does not throw', async () => {
  __setWakeLockEnv({ document: doc, navigator: {} });
  const held = await acquireScreenWakeLock();
  assert.equal(held, false, 'no lock…');
  await releaseScreenWakeLock();          // must also be safe
  assert.equal(isScreenWakeLockHeld(), false);
});

test('⚠ RULE 1 · a REFUSED request is survivable — recording must continue regardless', async () => {
  requestBehaviour = 'reject';
  const held = await acquireScreenWakeLock();
  assert.equal(held, false);
  assert.equal(isScreenWakeLockHeld(), false);
});

test('releasing without ever acquiring is a no-op', async () => {
  await releaseScreenWakeLock();
  assert.equal(isScreenWakeLockHeld(), false);
});

test('⚠ RULE 2 · a lock the platform revoked is re-acquired when the page returns', async () => {
  await acquireScreenWakeLock();
  assert.equal(requests.length, 1);

  // What iOS does the moment the document hides.
  nextSentinel.revoke();
  await doc.setVisibility('hidden');
  assert.equal(isScreenWakeLockHeld(), false, 'the platform took it back');

  await doc.setVisibility('visible');
  assert.equal(requests.length, 2, 'coming back must ask again — nothing restores it for us');
  assert.equal(isScreenWakeLockHeld(), true);
});

test('⚠ RULE 3 · after release, returning to the page must NOT relight the screen', async () => {
  await acquireScreenWakeLock();
  await releaseScreenWakeLock();
  const afterRelease = requests.length;

  await doc.setVisibility('hidden');
  await doc.setVisibility('visible');

  assert.equal(requests.length, afterRelease,
    'recording is over; re-acquiring here would burn the screen behind the user');
  assert.equal(isScreenWakeLockHeld(), false);
});

test('⚠ RULE 3 · and it still holds when the listener OUTLIVES the recording', async () => {
  // Detaching is the first line of defence, so the test above cannot see the
  // second one. Here removal fails — a document that has gone away, a throwing
  // removeEventListener — and the state guard has to carry rule 3 alone.
  doc.removeEventListener = () => { /* detach silently does nothing */ };

  await acquireScreenWakeLock();
  await releaseScreenWakeLock();
  const afterRelease = requests.length;

  await doc.setVisibility('hidden');
  await doc.setVisibility('visible');

  assert.equal(requests.length, afterRelease,
    'a stranded listener must not be able to relight the screen on its own');
  assert.equal(isScreenWakeLockHeld(), false);
});

test('a still-held lock is not re-requested on every visibility change', async () => {
  await acquireScreenWakeLock();
  await doc.setVisibility('visible');
  await doc.setVisibility('visible');
  assert.equal(requests.length, 1, 'we already hold one; asking again would leak sentinels');
});

test('acquiring twice holds one lock, and release detaches the listener', async () => {
  await acquireScreenWakeLock();
  await acquireScreenWakeLock();
  assert.equal(requests.length, 1, 'the second acquire is a no-op while held');
  assert.equal(doc.listenerCount(), 1, 'listeners must not stack per recording');

  await releaseScreenWakeLock();
  assert.equal(doc.listenerCount(), 0, 'and must not outlive the recording');
});

test('a sentinel that fails to release does not strand the module', async () => {
  await acquireScreenWakeLock();
  nextSentinel.release = async () => { throw new Error('already gone'); };
  await releaseScreenWakeLock();
  assert.equal(isScreenWakeLockHeld(), false, 'our own state is authoritative');
});
