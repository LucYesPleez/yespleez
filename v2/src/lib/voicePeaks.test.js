import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

/* ── one bar count, both players ───────────────────────────────────── */

test('⚠ the drawn bars clear the comb on BOTH players', async () => {
  // The count is chosen in PIXELS PER BAR, which is what decides whether a wave
  // reads as audio. 56 bars at under 2px was tried during M9f and failed — thin
  // enough that varying heights stopped being visible, which is the real reason
  // the waveform once looked uniform.
  //
  // ⚠ THE WIDTHS ARE A RANGE, NOT A NUMBER, and this test says so because an
  // earlier version did not: it asserted against a single 164px wave, and that
  // width moved the same day when the bubble was widened and the play button
  // shrank — leaving the test passing against geometry that no longer existed.
  //
  // phone   = bubble at 76% of 412, less padding, button and gap
  // desktop = the player min-width of 252, less the inset, button and gap
  const WAVES = { phone: 207, desktop: 199 };
  const GAP = 1.5;
  const perBar = (n, px) => (px - (n - 1) * GAP) / n;

  const { DISPLAY_BARS } = await import('./voicePeaks.js');

  for (const [player, px] of Object.entries(WAVES)) {
    const w = perBar(DISPLAY_BARS, px);
    assert.ok(w > 3.2, `${player}: bars must clear the comb, got ${w.toFixed(1)}px`);
    assert.ok(w < 6.5, `${player}: bars must not go absurd, got ${w.toFixed(1)}px`);
  }

  // The two players must not drift apart in character — the owner asked for
  // desktop to match the phone, and one count is how that is guaranteed.
  const spread = Math.abs(perBar(DISPLAY_BARS, WAVES.phone) - perBar(DISPLAY_BARS, WAVES.desktop));
  assert.ok(spread < 0.75, `phone and desktop bars differ by ${spread.toFixed(2)}px`);
});

test('⚠ no viewport split in the bar count', async () => {
  // It was 42 on desktop and 28 on phones for a day. A second constant coming
  // back means a Voicey has started looking like a different component
  // depending on the screen it is read on.
  const src = readFileSync(new URL('./voicePeaks.js', import.meta.url), 'utf8');
  assert.equal(/DISPLAY_BARS_COMPACT/.test(src), false, 'the viewport split is back');

  // ⚠ WIDTH queries only. The player legitimately asks for
  // `prefers-reduced-motion`, and an earlier version of this test banned
  // matchMedia outright — which would have forced someone to delete an
  // accessibility check to make a bar-count test pass.
  const view = readFileSync(new URL('../components/VoiceMessage.jsx', import.meta.url), 'utf8');
  assert.equal(/matchMedia\?\.\(['"`]\(max-width|matchMedia\(['"`]\(max-width/.test(view), false,
    'the player is choosing a bar count by viewport again');
});

test('the drawn count never invents detail it was not given', async () => {
  // Both formats downsample to this from a frozen payload. Drawing MORE bars
  // than were stored would be interpolation presented as measurement.
  const { DISPLAY_BARS, PEAK_COUNT, PEAK_MAX, toDisplayPeaks } = await import('./voicePeaks.js');
  const peaks = Array.from({ length: PEAK_COUNT }, (_, i) => (i % PEAK_MAX));

  const drawn = toDisplayPeaks(peaks, DISPLAY_BARS);
  assert.equal(drawn.length, DISPLAY_BARS);
  assert.ok(DISPLAY_BARS <= PEAK_COUNT, 'drawing more bars than v1 stored is interpolation');
  assert.ok(drawn.every(v => v >= 0 && v <= 1));
});

/* ── consistent dynamics, outliers clipped ──────────────────────────── */

/** A note of ordinary speech with one loud transient in it. */
function speechWithSlam(slamAt = 34, slam = 0.9) {
  const per = 200;
  const out = new Float32Array(PEAK_COUNT * per);
  for (let i = 0; i < PEAK_COUNT; i++) {
    const level = i === slamAt ? slam : 0.05 + 0.13 * Math.abs(Math.sin(i * 0.7));
    for (let j = 0; j < per; j++) out[i * per + j] = level * (j % 2 ? 1 : -1);
  }
  return out;
}

test('⚠ ONE loud moment must not flatten the rest of the note', () => {
  // The reported fault: normalising to the loudest bucket let a door slam set
  // the scale for every word, collapsing speech toward the 2px floor. The owner
  // saw it as "most of the chat looks like nothing".
  const peaks = peaksFromChannel(speechWithSlam());
  const median = peaks.slice().sort((a, b) => a - b)[Math.floor(peaks.length / 2)];

  assert.ok(median > PEAK_MAX * 0.25,
    `ordinary speech must occupy real height, got ${median}/${PEAK_MAX}`);
});

test('the outlier CLIPS rather than compressing everything below it', () => {
  // The owner's words: "if there's a massive peak it just gets clipped".
  const peaks = peaksFromChannel(speechWithSlam());
  assert.equal(Math.max(...peaks), PEAK_MAX, 'the loud bucket still reaches full height');
  assert.ok(peaks.every(v => v <= PEAK_MAX), 'and nothing may exceed the stored range');
});

test('a louder slam does not change how the speech is drawn', () => {
  // This is what "consistent dynamics" means: the same words render the same
  // way whether or not something loud happened elsewhere in the recording.
  const quiet = peaksFromChannel(speechWithSlam(34, 0.5));
  const loud  = peaksFromChannel(speechWithSlam(34, 3.0));
  const speechOnly = a => a.filter((_, i) => i !== 34);

  assert.deepEqual(speechOnly(quiet), speechOnly(loud),
    'a bigger transient must not redraw the words around it');
});

test('a quiet recording is still drawn, not flattened', () => {
  // C20 keeps gain control OFF on Android, so absolute level swings with the
  // room. This is why the scale is a percentile and not a fixed reference.
  const per = 200;
  const samples = new Float32Array(PEAK_COUNT * per);
  for (let i = 0; i < PEAK_COUNT; i++) {
    const level = 0.004 + 0.006 * Math.abs(Math.sin(i * 0.7));   // very quiet
    for (let j = 0; j < per; j++) samples[i * per + j] = level * (j % 2 ? 1 : -1);
  }
  const peaks = peaksFromChannel(samples);
  const median = peaks.slice().sort((a, b) => a - b)[Math.floor(peaks.length / 2)];
  assert.ok(median > PEAK_MAX * 0.25, `a quiet note must still read as speech, got ${median}`);
});

test('⚠ a mostly-silent note does not become a solid block', () => {
  // The 90th percentile can land inside the silence, driving the reference to
  // near zero and clipping the speech flat. REFERENCE_FLOOR guards this.
  const per = 200;
  const samples = new Float32Array(PEAK_COUNT * per);
  for (let i = 0; i < PEAK_COUNT; i++) {
    const level = i > PEAK_COUNT - 6 ? 0.2 : 0.0005;   // silent, then a few words
    for (let j = 0; j < per; j++) samples[i * per + j] = level * (j % 2 ? 1 : -1);
  }
  const peaks = peaksFromChannel(samples);
  assert.ok(peaks.filter(v => v >= PEAK_MAX).length < PEAK_COUNT / 2,
    'most of a mostly-silent note must not clip to full height');
  assert.ok(peaks.slice(0, 10).every(v => v < PEAK_MAX * 0.3),
    'and the silence must still read as silence');
});

test('⚠ the buckets stay in TIME order', () => {
  // The reference is a percentile, so a sort is involved. Sorting `rms` in place
  // rather than a copy would draw the note as a smooth ascending ramp — which
  // looks plausible enough to ship unnoticed.
  const peaks = peaksFromChannel(speechWithSlam());
  const ascending = peaks.every((v, i) => i === 0 || v >= peaks[i - 1]);
  assert.equal(ascending, false, 'a monotonic ramp means the buckets were sorted in place');
});
