import test from 'node:test';
import assert from 'node:assert/strict';
import { alignRight } from './liveWaveform.js';

const U = undefined;

test('the newest sample is always the LAST bar', () => {
  // The whole point of the change: the live edge does not wander.
  assert.equal(alignRight([0.5], 5).at(-1), 0.5);
  assert.equal(alignRight([0.1, 0.2, 0.3], 5).at(-1), 0.3);
  assert.equal(alignRight([1, 2, 3, 4, 5], 5).at(-1), 5);
});

test('empty slots sit on the LEFT while the row is filling', () => {
  assert.deepEqual(alignRight([0.9], 4), [U, U, U, 0.9]);
  assert.deepEqual(alignRight([0.1, 0.9], 4), [U, U, 0.1, 0.9]);
});

test('a single sample does not land on the left edge', () => {
  // The old behaviour, and the bug being fixed — one sample drawn at index 0.
  const row = alignRight([0.7], 6);
  assert.equal(row[0], U);
  assert.equal(row[5], 0.7);
});

test('order is preserved — oldest left, newest right', () => {
  assert.deepEqual(alignRight([1, 2, 3], 3), [1, 2, 3]);
});

test('a full row is exactly the history', () => {
  assert.deepEqual(alignRight([1, 2, 3, 4], 4), [1, 2, 3, 4]);
});

test('an over-long history keeps the TAIL, not the head', () => {
  // Makes the row a moving window. Keeping the head would freeze the display on
  // the first few seconds while the timer kept counting.
  assert.deepEqual(alignRight([1, 2, 3, 4, 5, 6], 3), [4, 5, 6]);
});

test('the output is always exactly barCount long', () => {
  for (const len of [0, 1, 5, 40, 100]) {
    assert.equal(alignRight(Array.from({ length: len }, (_, i) => i), 42).length, 42);
  }
});

test('an empty history draws nothing rather than a flat line', () => {
  // A row of zeroes would be a waveform claiming silence was recorded. Nothing
  // has been recorded yet — those are different things.
  assert.deepEqual(alignRight([], 3), [U, U, U]);
});

test('a missing or malformed history is treated as empty', () => {
  assert.deepEqual(alignRight(undefined, 2), [U, U]);
  assert.deepEqual(alignRight(null, 2), [U, U]);
  assert.deepEqual(alignRight('nope', 2), [U, U]);
});

test('a zero-width row returns nothing without throwing', () => {
  assert.deepEqual(alignRight([1, 2], 0), []);
  assert.deepEqual(alignRight([1, 2], -3), []);
});

test('a real level of 0 is kept, not confused with an empty slot', () => {
  // 0 is falsy; an implementation testing truthiness would drop genuine silence
  // and shift every later bar one place left.
  const row = alignRight([0, 0.4], 3);
  assert.deepEqual(row, [U, 0, 0.4]);
  assert.notEqual(row[1], U);
});
