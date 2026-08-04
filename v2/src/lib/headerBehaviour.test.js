import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireHeaderLock, isHeaderPinned, onHeaderPinChange } from './headerBehaviour.js';

// These drive `acquireHeaderLock` directly, which is exactly what
// useAlwaysVisibleHeader's effect returns — so the tests exercise the shipped
// code path rather than a re-implementation of it.

test('with nothing mounted, the header is free to auto-hide', () => {
  assert.equal(isHeaderPinned(), false);
});

test('⚠ OVERLAPPING SCREENS CANNOT UNPIN EACH OTHER — the counter earns its keep', () => {
  // The real sequence this guards. During a route change React runs the
  // incoming screen's effect BEFORE the outgoing screen's cleanup, so with a
  // boolean the screen that is leaving clears the flag the arriving screen just
  // set — and the header starts hiding underneath a screen that asked for it to
  // stay. Ordering is not something either screen can control.
  const releaseA = acquireHeaderLock();
  assert.equal(isHeaderPinned(), true, 'A pinned it');

  const releaseB = acquireHeaderLock();   // B mounts...
  releaseA();                             // ...then A unmounts
  assert.equal(isHeaderPinned(), true, 'A left, but B still wants it pinned');

  releaseB();
  assert.equal(isHeaderPinned(), false, 'both gone — free again');
});

test('a double release cannot drive the counter negative', () => {
  const release = acquireHeaderLock();
  release();
  release();                              // StrictMode runs cleanups twice
  assert.equal(isHeaderPinned(), false);

  // The bug a negative counter causes: locks would sit at -1, so the next
  // screen to pin the header would reach 0 and NOT pin it. One pin must pin.
  const other = acquireHeaderLock();
  assert.equal(isHeaderPinned(), true, 'one pin is enough, as it must be');
  other();
});

test('every transition is announced, so the header cannot miss an edge', () => {
  const seen = [];
  const off = onHeaderPinChange(v => seen.push(v));

  const a = acquireHeaderLock();
  const b = acquireHeaderLock();
  a();
  b();

  assert.deepEqual(seen, [true, true, true, false]);
  off();
});

test('an unsubscribed listener stops hearing about changes', () => {
  const seen = [];
  const off = onHeaderPinChange(v => seen.push(v));
  const release = acquireHeaderLock();
  off();
  release();
  assert.deepEqual(seen, [true], 'only the change made while subscribed');
});
