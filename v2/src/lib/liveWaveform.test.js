import test from 'node:test';
import assert from 'node:assert/strict';
import { alignRight, barHeight } from './liveWaveform.js';

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

/* ── bar height is perceptual ───────────────────────────────────────── */

test('⚠ a normal speaking voice uses a real share of the meter', () => {
  // The bug this fixes: level() delivers ~.22–.55 for ordinary speech, and drawn
  // linearly on a 22px row that was 5–12px — reported as "barely shows" from a
  // real handset. The curve must lift those into the visible middle.
  const H = 34;
  const quiet = barHeight(0.22, H);
  const loud  = barHeight(0.55, H);

  assert.ok(quiet > 0.3 * H, `a quiet voice should clear a third of the meter, got ${(quiet / H).toFixed(2)}`);
  assert.ok(loud  > 0.6 * H, `a normal voice should clear .6 of the meter, got ${(loud / H).toFixed(2)}`);
  assert.ok(loud < H, 'and must leave headroom above it');
});

test('a shout still reaches the top, and nothing exceeds it', () => {
  // 1 maps to 1 for any exponent, so the curve cannot cost the meter its range.
  assert.equal(barHeight(1, 34), 34);
  assert.equal(barHeight(2, 34), 34, 'out of range clamps rather than overflowing the row');
});

test('silence draws a short bar, never a gap', () => {
  // A hole in the row would read as a hole in the recording.
  assert.equal(barHeight(0, 34), 2);
  assert.equal(barHeight(-1, 34), 2);
  assert.equal(barHeight(NaN, 34), 2, 'a missing sample must not become NaNpx');
  assert.equal(barHeight(undefined, 34), 2);
});

test('louder always draws taller', () => {
  // Monotonic, or the meter would misreport which of two moments was louder.
  let prev = 0;
  for (let v = 0; v <= 1; v += 0.05) {
    const h = barHeight(v, 34);
    assert.ok(h >= prev, `height went backwards at ${v.toFixed(2)}`);
    prev = h;
  }
});
