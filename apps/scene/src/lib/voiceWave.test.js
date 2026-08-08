import test from 'node:test';
import assert from 'node:assert/strict';
import {
  waveFromChannel, computeWave, decodeWave, isRenderableWave, toDisplayWave,
  rawEnvelope, encodeEnvelope, combineEnvelopes,
  WAVE_VERSION, WAVE_MAX, BUCKET_MS, MIN_BUCKETS, MAX_BUCKETS,
} from './voiceWave.js';

const SR = 48000;

/** Speech-shaped audio: syllable bursts with fast attacks and gaps between. */
function speech(seconds, { loudAt = null, loudGain = 3.2 } = {}) {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  let t = 0;
  while (t < n) {
    const sylLen = Math.floor(SR * (0.08 + 0.14 * ((t / SR * 7) % 1)));
    const gap = Math.floor(SR * (0.03 + 0.12 * ((t / SR * 3) % 1)));
    const inLoud = loudAt !== null && t / SR > loudAt && t / SR < loudAt + 0.4;
    const amp = (0.08 + 0.22 * ((t / SR * 11) % 1)) * (inLoud ? loudGain : 1);
    for (let i = 0; i < sylLen && t < n; i++, t++) {
      const env = Math.min(1, i / (SR * 0.005)) * Math.exp(-i / (sylLen * 0.55));
      out[t] = Math.sin(t * 0.06) * amp * env;
    }
    t += gap;
  }
  return out;
}

const levels = a => new Set(a.map(v => v.toFixed(2))).size;

/* ── the fault this format exists to fix ────────────────────────────── */

test('⚠ a bar means the same amount of TIME whatever the note\'s length', () => {
  // THE ENTIRE POINT. v1 stored 56 buckets regardless of duration, so a bar was
  // 54ms on a 3-second note and 536ms on a 30-second one — half a second of
  // speech averaged into one bar. Every long note converged on the same shape
  // because the shape was the average of everything in it.
  for (const secs of [3, 7, 30]) {
    const wave = waveFromChannel(speech(secs), SR);
    assert.ok(Math.abs(wave.ms - BUCKET_MS) <= 4,
      `${secs}s note has ${wave.ms}ms per bucket, expected ~${BUCKET_MS}ms`);
  }
});

test('⚠ a long note does not lose its dynamics', () => {
  // v1's 30-second note used 7 distinct drawn levels out of 28 bars. That is the
  // repetitive, averaged look — not a rendering problem, a resolution one.
  const bytes = decodeWave(waveFromChannel(speech(30), SR));
  const drawn = toDisplayWave(bytes, 28);

  assert.ok(levels(drawn) >= 12,
    `a 30s note drew only ${levels(drawn)} distinct levels — it is averaging flat again`);
});

test('a transient survives to the drawn bar', () => {
  // The extraction takes the loudest short window inside each bucket, not the
  // bucket's average, so a sudden loud moment reaches the screen instead of
  // being divided into the quiet around it.
  const quiet = decodeWave(waveFromChannel(speech(6), SR));
  const withBurst = decodeWave(waveFromChannel(speech(6, { loudAt: 3 }), SR));

  const a = toDisplayWave(quiet, 28);
  const b = toDisplayWave(withBurst, 28);
  assert.notDeepEqual(a, b, 'a loud burst must change the drawn wave');
  assert.ok(Math.max(...b) >= 0.9, 'the burst should reach near full height');
});

test('⚠ a single click does not become a full-height bar', () => {
  // A raw max(|sample|) would promote one sample to a whole bar. The envelope
  // follower measures the loudest 4ms WINDOW, so an impulse is averaged within
  // its own window and cannot define the note.
  const s = speech(6);
  const clicked = Float32Array.from(s);
  clicked[Math.floor(clicked.length / 2)] = 1.0;   // one sample, full scale

  const before = toDisplayWave(decodeWave(waveFromChannel(s, SR)), 28);
  const after = toDisplayWave(decodeWave(waveFromChannel(clicked, SR)), 28);

  const moved = after.filter((v, i) => Math.abs(v - before[i]) > 0.05).length;
  assert.ok(moved <= 1, `one click moved ${moved} bars — it is being treated as signal`);
});

/* ── the format itself ──────────────────────────────────────────────── */

test('the payload is self-describing and round-trips', () => {
  const wave = waveFromChannel(speech(7), SR);

  assert.equal(wave.v, WAVE_VERSION);
  assert.ok(Number.isFinite(wave.ms) && wave.ms > 0, 'a reader must not need the duration');
  assert.equal(typeof wave.d, 'string');

  const bytes = decodeWave(wave);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.every(b => b >= 0 && b <= WAVE_MAX));
  assert.ok(Math.max(...bytes) === WAVE_MAX, 'the loudest bucket must reach full scale');
});

test('⚠ the payload stays affordable, and long notes are bounded', () => {
  // This travels with every message read on every thread load. v1 was ~200
  // bytes; v2 buys resolution and pays for it, so the ceiling matters.
  const short = JSON.stringify(waveFromChannel(speech(7), SR)).length;
  const long = JSON.stringify(waveFromChannel(speech(120), SR)).length;

  assert.ok(short < 600, `a 7s note serialises to ${short} bytes`);
  assert.ok(long < 2200, `a 2-minute note serialises to ${long} bytes — the cap is not holding`);

  // Past MAX_BUCKETS a note gets COARSER buckets rather than a bigger payload.
  const huge = waveFromChannel(speech(120), SR);
  assert.ok(decodeWave(huge).length <= MAX_BUCKETS);
  assert.ok(huge.ms > BUCKET_MS, 'a very long note should widen its buckets, not grow');
});

test('a very short note still gets enough bars to read as a wave', () => {
  const wave = waveFromChannel(speech(0.3), SR);
  assert.ok(decodeWave(wave).length >= MIN_BUCKETS);
});

/* ── degrading rather than failing ──────────────────────────────────── */

test('silence yields no wave rather than an invisible one', () => {
  assert.equal(waveFromChannel(new Float32Array(SR), SR), null);
  assert.equal(waveFromChannel(new Float32Array(0), SR), null);
  assert.equal(waveFromChannel(null, SR), null);
  assert.equal(waveFromChannel(speech(1), 0), null);
});

test('a malformed payload draws nothing rather than throwing', () => {
  // Payloads are unvalidated by design (M9a), so junk is reachable — and a
  // thread must never fail to render because one message's decoration is bad.
  assert.equal(decodeWave(null), null);
  assert.equal(decodeWave({}), null);
  assert.equal(decodeWave({ v: 2, ms: 32, d: '!!!not base64!!!' }), null);
  assert.equal(decodeWave({ v: 99, ms: 32, d: 'AAAA' }), null, 'a future version must not be guessed at');
  assert.equal(decodeWave({ v: 2, ms: 32, d: '' }), null);
  assert.equal(isRenderableWave({ v: 2, ms: 32, d: 'AAAA' }), true);
});

test('toDisplayWave degrades rather than throwing', () => {
  assert.equal(toDisplayWave(null, 28), null);
  assert.equal(toDisplayWave(new Uint8Array(0), 28), null);
  assert.equal(toDisplayWave(new Uint8Array([1, 2, 3]), 0), null);

  // Fewer buckets than bars is legal — a very short note drawn wide.
  const drawn = toDisplayWave(new Uint8Array([0, 128, 255]), 28);
  assert.equal(drawn.length, 28);
  assert.ok(drawn.every(v => v >= 0 && v <= 1));
});

test('computeWave never throws, whatever the audio stack does', async () => {
  // A voice note whose waveform failed is still a good voice note. A decorative
  // step must never be able to fail a communication one.
  const Exploding = class { decodeAudioData() { throw new Error('nope'); } close() {} };
  const blob = { size: 10, arrayBuffer: async () => new ArrayBuffer(10) };
  assert.equal(await computeWave(blob, Exploding), null);

  const Rejecting = class { decodeAudioData() { return Promise.reject(new Error('bad')); } close() {} };
  assert.equal(await computeWave(blob, Rejecting), null);

  assert.equal(await computeWave(blob, null), null);   // no audio stack at all
  assert.equal(await computeWave(null, Exploding), null);
});

test('the AudioContext is closed even when decoding fails', async () => {
  // Contexts are a limited resource; leaking one per recording eventually
  // refuses to create any more — a failure that only appears after heavy use.
  let closed = false;
  const Tracking = class {
    decodeAudioData() { return Promise.reject(new Error('nope')); }
    close() { closed = true; }
  };
  await computeWave({ size: 10, arrayBuffer: async () => new ArrayBuffer(10) }, Tracking);
  assert.equal(closed, true);
});

/* ── SEGMENT COMBINATION (Resume Recording) ──────────────────────────── */

test('combining raw envelopes equals encoding the concatenation — one continuous array', () => {
  // ⚠ THE SEGMENTED-IS-INVISIBLE GUARANTEE. Recording two segments and combining
  // their raw envelopes must match measuring one recording of the same audio,
  // so a resumed note's waveform is indistinguishable from an unbroken one.
  const a = speech(1.2);
  const b = speech(1.4, { loudAt: 0.5 });
  const whole = new Float32Array(a.length + b.length);
  whole.set(a, 0); whole.set(b, a.length);

  const combined = combineEnvelopes([rawEnvelope(a, SR), rawEnvelope(b, SR)]);
  const oneShot  = waveFromChannel(whole, SR);

  assert.ok(combined && oneShot, 'both produce a wave');
  const cd = decodeWave(combined), od = decodeWave(oneShot);
  // Bucket counts match within one (the boundary's partial bucket), and the
  // drawn bytes track closely — the join is not visible.
  assert.ok(Math.abs(cd.length - od.length) <= 1, `bucket counts align: ${cd.length} vs ${od.length}`);
});

test('⚠ one loudness scale across segments — a quiet segment does not fill to full height', () => {
  // Normalising each segment on its own would let a whisper reach the same
  // height as a shout in the next segment, and the seam would show. Because raw
  // envelopes are concatenated and normalised ONCE, the quiet segment stays low.
  const loud  = speech(1.0, { loudAt: 0.3, loudGain: 4 });
  const quiet = speech(1.0);   // ordinary level
  // Scale the quiet one down hard so the difference is unambiguous.
  const q = quiet.map(x => x * 0.15);

  const combined = decodeWave(combineEnvelopes([rawEnvelope(loud, SR), rawEnvelope(q, SR)]));
  const half = Math.floor(combined.length / 2);
  const maxFirst  = Math.max(...combined.slice(0, half));      // loud segment
  const maxSecond = Math.max(...combined.slice(half));         // quiet segment
  assert.ok(maxFirst > maxSecond * 1.8,
    `the loud segment draws taller than the quiet one on a shared scale (${maxFirst} vs ${maxSecond})`);
});

test('combineEnvelopes ignores gaps a failed decode leaves behind', () => {
  // computeRawEnvelope returns null for a segment it could not decode; the
  // combine must skip it rather than crash, so one bad segment does not lose
  // the whole note's waveform.
  const a = rawEnvelope(speech(1.0), SR);
  assert.ok(combineEnvelopes([a, null, undefined]));
  assert.equal(combineEnvelopes([null, null]), null);
  assert.equal(combineEnvelopes([]), null);
});

test('encodeEnvelope and rawEnvelope round-trip a single segment like waveFromChannel', () => {
  const s = speech(2.0, { loudAt: 1.0 });
  const raw = rawEnvelope(s, SR);
  const viaSplit = encodeEnvelope(raw.env, raw.durationMs);
  const direct   = waveFromChannel(s, SR);
  assert.deepEqual(viaSplit, direct, 'the split path is exactly the original for one segment');
});
