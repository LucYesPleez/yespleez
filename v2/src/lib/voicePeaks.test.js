import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  peaksFromChannel, isRenderablePeaks, computePeaks,
  PEAK_COUNT, PEAK_MAX,
} from './voicePeaks.js';

/** A sine at `amp`, long enough to fill every bucket. */
function tone(amp = 1, length = PEAK_COUNT * 400) {
  return Float32Array.from({ length }, (_, i) => Math.sin(i / 8) * amp);
}

// ── the encoding contract (this is what lands in payload forever) ───

test('peaks are a fixed-length array of small ints', () => {
  // Fixed length because bar count is a visual constant, not a function of
  // duration — and because every row in the database will carry this shape.
  const peaks = peaksFromChannel(tone());
  assert.equal(peaks.length, PEAK_COUNT);
  for (const p of peaks) {
    assert.ok(Number.isInteger(p), `${p} is not an integer — payload must stay compact`);
    assert.ok(p >= 0 && p <= PEAK_MAX, `${p} outside [0, ${PEAK_MAX}]`);
  }
});

test('a long note and a short note produce the same number of bars', () => {
  const short = peaksFromChannel(tone(1, PEAK_COUNT * 100));
  const long  = peaksFromChannel(tone(1, PEAK_COUNT * 5000));
  assert.equal(short.length, long.length);
  assert.equal(short.length, PEAK_COUNT);
});

test('the payload cost stays small', () => {
  // This travels with every message read, on every thread load. If it ever
  // stops being small, it stops being free.
  const bytes = JSON.stringify(peaksFromChannel(tone())).length;
  assert.ok(bytes < 400, `peaks serialise to ${bytes} bytes — too heavy for every row`);
});

// ── normalisation, which C20 makes necessary ────────────────────────

test('a quiet recording is not rendered as a flat line', () => {
  // C20 disables auto gain control, so absolute level varies hugely between a
  // quiet room and a loud venue. Without normalising, the quiet recording — the
  // exact one the DSP decision protects — would draw as nothing.
  const loud  = peaksFromChannel(tone(1.0));
  const quiet = peaksFromChannel(tone(0.02));
  assert.deepEqual(quiet, loud, 'normalisation must make level irrelevant to shape');
  assert.ok(Math.max(...quiet) === PEAK_MAX, 'the loudest bucket must reach full scale');
});

test('RMS is used, so one transient does not flatten everything else', () => {
  // With peak-amplitude bucketing, a single click sets its bucket to max and
  // normalisation crushes every other bar toward zero — the "flat wall with
  // spikes" waveform. RMS follows perceived loudness instead.
  const samples = tone(0.3);
  samples[Math.floor(samples.length / 2)] = 1.0;   // one click, mid-recording

  const peaks = peaksFromChannel(samples);
  const typical = peaks.filter(p => p > 0);
  const mean = typical.reduce((a, b) => a + b, 0) / typical.length;

  assert.ok(mean > PEAK_MAX * 0.4,
    `speech collapsed to a mean of ${mean.toFixed(1)}/${PEAK_MAX} — a transient dominated the scale`);
});

// ── degrading rather than failing ───────────────────────────────────

test('silence yields no waveform rather than an invisible one', () => {
  // A zero array renders as an empty waveform, which reads as a bug. null means
  // "nothing to draw" and the player shows its plain bar.
  assert.equal(peaksFromChannel(new Float32Array(PEAK_COUNT * 100)), null);
});

test('audio too short to bucket yields no waveform', () => {
  assert.equal(peaksFromChannel(new Float32Array(10)), null);
  assert.equal(peaksFromChannel(new Float32Array(0)), null);
  assert.equal(peaksFromChannel(null), null);
});

test('computePeaks never throws, whatever the audio stack does', async () => {
  // A voice note whose waveform failed is still a good voice note. A decorative
  // step must never be able to fail a communication one.
  const Exploding = class {
    decodeAudioData() { throw new Error('cannot decode'); }
    close() {}
  };
  assert.equal(await computePeaks({ size: 10, arrayBuffer: async () => new ArrayBuffer(10) }, Exploding), null);

  const Rejecting = class {
    decodeAudioData() { return Promise.reject(new Error('bad format')); }
    close() {}
  };
  assert.equal(await computePeaks({ size: 10, arrayBuffer: async () => new ArrayBuffer(10) }, Rejecting), null);

  // No audio stack at all (node, SSR).
  assert.equal(await computePeaks({ size: 10, arrayBuffer: async () => new ArrayBuffer(10) }, null), null);
  // No recording.
  assert.equal(await computePeaks(null, Exploding), null);
});

test('the AudioContext is closed even when decoding fails', async () => {
  // Contexts are a limited resource; leaking one per recording eventually
  // refuses to create any more — a failure that only appears after heavy use.
  let closed = false;
  const Tracking = class {
    decodeAudioData() { return Promise.reject(new Error('nope')); }
    close() { closed = true; }
  };
  await computePeaks({ size: 10, arrayBuffer: async () => new ArrayBuffer(10) }, Tracking);
  assert.equal(closed, true, 'a failed decode must still release its context');
});

// ── what the renderer will accept ───────────────────────────────────

test('only a well-formed peak array is renderable', () => {
  assert.equal(isRenderablePeaks(peaksFromChannel(tone())), true);

  // Every pre-M9f note is permanently in this state — peaks cannot be
  // retrofitted without re-downloading and rewriting every row.
  assert.equal(isRenderablePeaks(undefined), false, 'legacy notes have no peaks');
  assert.equal(isRenderablePeaks(null), false);

  // A future build with a different bar count is not corrupt, just not
  // drawable here — fall back rather than distort.
  assert.equal(isRenderablePeaks(new Array(PEAK_COUNT + 8).fill(4)), false);

  // Payloads are unvalidated by design (M9a), so junk is reachable.
  assert.equal(isRenderablePeaks([1, 2, 'three']), false);
  assert.equal(isRenderablePeaks(new Array(PEAK_COUNT).fill(PEAK_MAX + 50)), false);
  assert.equal(isRenderablePeaks(new Array(PEAK_COUNT).fill(NaN)), false);
  assert.equal(isRenderablePeaks('not an array'), false);
});

// ── display peaks: stored summary → drawn bars ──────────────────────

test('drawn bars are fewer than stored peaks, and always the same count', async () => {
  const { toDisplayPeaks, DISPLAY_BARS } = await import('./voicePeaks.js');
  // 56 bars in a ~190px player is under 2px each, which reads as a comb rather
  // than as audio — the real reason the waveform looked uniform.
  const drawn = toDisplayPeaks(peaksFromChannel(tone()));
  assert.equal(drawn.length, DISPLAY_BARS);
  assert.ok(DISPLAY_BARS < PEAK_COUNT, 'drawing must downsample, never upsample');
});

test('drawn heights are 0..1 so the caller can scale them freely', async () => {
  const { toDisplayPeaks } = await import('./voicePeaks.js');
  for (const v of toDisplayPeaks(peaksFromChannel(tone()))) {
    assert.ok(v >= 0 && v <= 1, `${v} outside 0..1`);
  }
});

test('the contrast curve deepens valleys rather than flattening them', async () => {
  const { toDisplayPeaks } = await import('./voicePeaks.js');
  // A stored peak at half scale must draw at LESS than half height, or the
  // curve is doing nothing and the waveform stays a gentle mound.
  const half = new Array(PEAK_COUNT).fill(Math.round(PEAK_MAX / 2));
  const drawn = toDisplayPeaks(half);
  assert.ok(drawn[0] < 0.5, `half-scale drew at ${drawn[0]}, expected below 0.5`);
  assert.ok(drawn[0] > 0.15, 'but not so deep that ordinary speech vanishes');
});

test('full scale still draws at full height', async () => {
  const { toDisplayPeaks } = await import('./voicePeaks.js');
  const loud = new Array(PEAK_COUNT).fill(PEAK_MAX);
  assert.equal(toDisplayPeaks(loud)[0], 1, 'the loudest moment must reach the top');
});

test('downsampling keeps peaks rather than averaging them away', async () => {
  const { toDisplayPeaks } = await import('./voicePeaks.js');
  // One loud bucket in a quiet passage must survive into its bar. Averaging a
  // second time after RMS would flatten what little range was left.
  const quiet = new Array(PEAK_COUNT).fill(1);
  quiet[0] = PEAK_MAX;
  const drawn = toDisplayPeaks(quiet);
  assert.equal(drawn[0], 1, 'the loud bucket must carry its bar');
  assert.ok(drawn[10] < 0.1, 'and must not lift the quiet ones');
});

test('unrenderable peaks draw nothing, so the caller falls back', async () => {
  const { toDisplayPeaks } = await import('./voicePeaks.js');
  assert.equal(toDisplayPeaks(undefined), null, 'pre-M9f notes have no peaks');
  assert.equal(toDisplayPeaks(null), null);
  assert.equal(toDisplayPeaks([1, 2, 3]), null, 'wrong length is not drawable');
  assert.equal(toDisplayPeaks(new Array(PEAK_COUNT).fill(NaN)), null);
});

/* ── the phone's coarser wave ───────────────────────────────────────── */

test('⚠ the compact count clears the bar-width floor on EVERY phone', async () => {
  // The count is chosen in PIXELS PER BAR, which is what decides whether a wave
  // reads as audio. 42 bars in a phone bubble was ~2.4px — inside the range
  // already measured as too thin when 56 bars failed. Reported as compressed.
  //
  // ⚠ THE WIDTH IS A RANGE, NOT A NUMBER, and this test says so because an
  // earlier version did not. It asserted against a single 164px wave, and that
  // width MOVED the same day — the bubble was widened to match a text bubble and
  // the play button shrank 44 to 36 — leaving the test passing against geometry
  // that no longer existed.
  //
  // Wave width = bubble(76% of viewport - 32px padding) - 34 bubble padding
  //              - 36 button - 12 gap
  const WAVES = { 360: 167, 412: 207 };
  const GAP = 1.5;
  const perBar = (n, px) => (px - (n - 1) * GAP) / n;

  const { DISPLAY_BARS, DISPLAY_BARS_COMPACT } = await import('./voicePeaks.js');

  for (const [device, px] of Object.entries(WAVES)) {
    const compact = perBar(DISPLAY_BARS_COMPACT, px);
    assert.ok(compact > 3.2, `${device}px: bars must clear the comb, got ${compact.toFixed(1)}px`);
    assert.ok(compact < 5.5, `${device}px: bars must not go blocky, got ${compact.toFixed(1)}px`);
  }

  // The narrow phone is the one that justifies the constant existing at all:
  // after the widening, 42 bars is fine at 412px and still too thin at 360px.
  assert.ok(perBar(DISPLAY_BARS, 167) < 2.6, 'if 42 ever fits a 360px phone, this constant can go');
  assert.ok(DISPLAY_BARS_COMPACT < DISPLAY_BARS, 'compact means FEWER bars');
});
test('both counts downsample the same frozen payload, and neither invents detail', async () => {
  // Nothing stored changes. A note drawn at 32 bars on a phone is the same note
  // drawn at 42 on a desktop.
  const { DISPLAY_BARS, DISPLAY_BARS_COMPACT, PEAK_COUNT, PEAK_MAX, toDisplayPeaks } = await import('./voicePeaks.js');
  const peaks = Array.from({ length: PEAK_COUNT }, (_, i) => (i % PEAK_MAX));

  for (const n of [DISPLAY_BARS, DISPLAY_BARS_COMPACT]) {
    const drawn = toDisplayPeaks(peaks, n);
    assert.equal(drawn.length, n);
    assert.ok(n <= PEAK_COUNT, 'drawing more bars than were stored would be inventing detail');
    assert.ok(drawn.every(v => v >= 0 && v <= 1), 'heights stay 0..1 whatever the count');
  }
});
