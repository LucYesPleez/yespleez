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

test('⚠ a bar is wide enough to read as audio', () => {
  // Bars are a FIXED width now — they no longer divide the container — so the
  // question is simply whether that width is legible. 56 bars at under 2px was
  // tried during M9f and failed: thin enough that varying heights stopped being
  // visible, which is the real reason the waveform once looked uniform.
  const view = readFileSync(new URL('../components/VoiceMessage.jsx', import.meta.url), 'utf8');
  const w = Number(view.match(/const BAR_W\s*=\s*([\d.]+)/)?.[1]);

  assert.ok(Number.isFinite(w), 'BAR_W is missing');
  assert.ok(w >= 3.2, `bars at ${w}px read as a comb, not as audio`);
  assert.ok(w <= 7, `bars at ${w}px are blocky`);
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

/* ── a short note is not stretched ──────────────────────────────────── */

test('⚠ a bar is a fixed slice of TIME, so a short note draws a short wave', async () => {
  // Every note used to draw DISPLAY_BARS whatever its length, so a bar meant
  // 107ms in a three-second note and 1.07s in a thirty-second one. Same picture
  // width, wildly different amounts of speech — which is what made a short
  // Voicey look artificially wide.
  const { barsForDuration, DISPLAY_BARS, MS_PER_BAR } = await import('./voicePeaks.js');

  assert.ok(barsForDuration(3000) < DISPLAY_BARS, 'a 3s note must not fill the player');
  assert.equal(barsForDuration(DISPLAY_BARS * MS_PER_BAR), DISPLAY_BARS, 'and 7s must exactly fill it');

  // Proportional in between: twice the audio, twice the bars.
  assert.equal(barsForDuration(2000) * 2, barsForDuration(4000));
});

test('a long note fills the width and never exceeds it', async () => {
  // Past the full width a note DOES still compress — the player has a fixed
  // width and something has to give. The point is that compression now starts
  // at seven seconds rather than at one.
  const { barsForDuration, DISPLAY_BARS } = await import('./voicePeaks.js');
  assert.equal(barsForDuration(30_000), DISPLAY_BARS);
  assert.equal(barsForDuration(600_000), DISPLAY_BARS);
});

test('⚠ a very short note is stretched rather than drawn as four bars', async () => {
  // Deliberate: below the floor a wave stops reading as a wave and starts
  // reading as a rendering failure. "Not quite to scale" beats "looks broken".
  const { barsForDuration, MIN_DISPLAY_BARS } = await import('./voicePeaks.js');
  assert.equal(barsForDuration(200), MIN_DISPLAY_BARS);
  assert.equal(barsForDuration(1), MIN_DISPLAY_BARS);
});

test('an unknown duration draws the full width rather than guessing', async () => {
  // A payload with no duration_ms predates that field. Drawing it short would
  // assert a length nothing measured.
  const { barsForDuration, DISPLAY_BARS } = await import('./voicePeaks.js');
  for (const bad of [undefined, null, 0, -5, NaN, 'seven']) {
    assert.equal(barsForDuration(bad), DISPLAY_BARS, `${bad} should fall back to the full count`);
  }
});

test('⚠ bars must be a fixed width, or fewer of them just get fatter', async () => {
  // The whole mechanism depends on it. While bars were `flex: 1` they shared
  // whatever width existed, so drawing fewer would have filled the player
  // anyway and a short note would have looked exactly as long as a long one.
  const view = readFileSync(new URL('../components/VoiceMessage.jsx', import.meta.url), 'utf8');
  assert.match(view, /width:\s*BAR_W/, 'bars must take a fixed width');
  assert.match(view, /flex:\s*'none'/, 'a flexing bar cannot represent a fixed slice of time');
  assert.match(view, /justifyContent:\s*'flex-start'/, 'the wave must end, not spread');
});

test('⚠ a full-length wave fits the NARROWEST screen, not the widest', async () => {
  const view = readFileSync(new URL('../components/VoiceMessage.jsx', import.meta.url), 'utf8');
  const { DISPLAY_BARS } = await import('./voicePeaks.js');
  const w = Number(view.match(/const BAR_W\s*=\s*([\d.]+)/)?.[1]);
  const gap = Number(view.match(/const BAR_GAP\s*=\s*([\d.]+)/)?.[1]);

  const full = DISPLAY_BARS * w + (DISPLAY_BARS - 1) * gap;
  // ⚠ THE BINDING CONSTRAINT IS A 360px HANDSET, not the desktop player. The
  // two-thirds cap leaves ~133px of wave there — far tighter than desktop — and
  // an earlier version of this test checked desktop, passed, and shipped a wave
  // that overflowed a phone by 62px.
  assert.ok(full <= 133, `a full wave is ${full}px and a 360px phone offers ~133px`);
  assert.ok(full > 110, `a full wave is only ${full}px — it should very nearly fill that`);
});
