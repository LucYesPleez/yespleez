/**
 * WAVEFORM v2 — the envelope, sampled at a fixed rate in TIME.
 *
 * Replaces `voicePeaks.js` for new recordings. That format is not deprecated and
 * not going away: every Voicey ever recorded carries it and it cannot be
 * retrofitted, so both read paths are permanent. See `decodeWave` for how a
 * renderer picks.
 *
 * ── WHY v1 LOOKED SYNTHETIC, MEASURED ────────────────────────────────
 *
 * v1 stored exactly 56 buckets whatever the recording's length, so the time each
 * bar represented was `duration / 56`:
 *
 *     3s note    54ms per bar    23 of 32 levels used
 *     7s note   125ms per bar    21 of 32 levels used
 *     30s note  536ms per bar    11 of 32 levels used
 *
 * A syllable is 100-250ms. At 7 seconds a bar already averaged a whole syllable;
 * at 30 seconds it averaged half a second of speech. Every note converged on the
 * same shape because the shape was the average of everything in it.
 *
 * ⚠ THE OBVIOUS FIX WAS MEASURED AND DOES NOT WORK ALONE. Swapping RMS for
 * peak-per-bucket at 56 buckets changes almost nothing — sd 0.179 → 0.170 on the
 * same signal, slightly WORSE. At 125ms every bucket contains several syllable
 * attacks, so the max saturates and every bucket has one. Peak-preservation only
 * pays off once buckets are short enough that some contain a transient and some
 * do not. Resolution had to move first; that is why this file exists rather than
 * a one-line change to the old one.
 *
 * ── THE FORMAT ───────────────────────────────────────────────────────
 *
 *   { v: 2, ms: <milliseconds per bucket>, d: <base64 of Uint8Array> }
 *
 * Self-describing: `ms` means a reader never has to consult the duration to know
 * what a bucket represents, and a future build can change the rate without
 * breaking this one.
 *
 * ⚠ BASE64, NOT A JSON ARRAY, AND THAT IS WHAT MAKES v2 AFFORDABLE. This travels
 * with every message read on every thread load. A 30-second note is ~940 buckets:
 * as `[12,240,7,...]` that is roughly 3.7KB, as base64 it is ~1.25KB. v1 was
 * ~200 bytes, so v2 is still several times larger — the cost is real and is
 * bought deliberately, and `MAX_BUCKETS` is what bounds it.
 */

/** The version written into every new payload. */
export const WAVE_VERSION = 2;

/**
 * Target milliseconds per bucket.
 *
 * 32ms is under the shortest syllable and above the point where neighbouring
 * buckets become copies of each other. Measured going the other way: at ~18ms a
 * bar is inside a single syllable's envelope, adjacent bars agree, and
 * bar-to-bar movement FELL from 0.170 to 0.038 — smoother, not livelier. More
 * resolution is not automatically more life.
 */
export const BUCKET_MS = 32;

/**
 * Bounds on how many buckets a note may store.
 *
 * The ceiling is a payload budget, not an aesthetic: past it, long notes start
 * costing more to read than they are worth and the extra detail is thrown away
 * by the renderer anyway, which draws 28-42 bars. A note longer than
 * MAX_BUCKETS × BUCKET_MS simply gets coarser buckets rather than a bigger
 * payload. The floor keeps a very short note from being three bars wide.
 */
export const MIN_BUCKETS = 24;
export const MAX_BUCKETS = 1200;   // ~38s at 32ms before buckets start widening

/** Stored amplitudes are bytes. 8 bits, against v1's 5. */
export const WAVE_MAX = 255;

/**
 * The envelope follower's window, in milliseconds.
 *
 * ⚠ THIS IS WHERE TRANSIENTS SURVIVE. Each bucket's value is the LOUDEST 4ms
 * inside it, not the average of the bucket. A plosive or a consonant attack is
 * 5-20ms, so averaging a 32ms bucket would still bury it; taking the maximum of
 * short sub-windows keeps the attack while staying immune to a single-sample
 * click, which a raw `max(|sample|)` would promote to a full-height bar.
 *
 * O(n) — one pass, no sorting. A 30-second note is 1.4M samples and this runs in
 * a few milliseconds on a phone, which matters because it happens between the
 * user releasing the mic and the message appearing.
 */
const WINDOW_MS = 4;

/**
 * Compute a wave from a recording.
 *
 * Returns null rather than throwing on ANY failure, exactly as `computePeaks`
 * does and for the same reason: a voice note whose waveform could not be built
 * is still a perfectly good voice note. Refusing to send it — or worse, failing
 * after the upload has already succeeded — would let a decorative step break a
 * communication one.
 *
 * @param {Blob} blob
 * @param {typeof AudioContext} [ContextClass] injectable for tests
 */
export async function computeWave(blob, ContextClass) {
  const Ctx = ContextClass
    ?? (typeof window !== 'undefined' && (window.AudioContext ?? window.webkitAudioContext));
  if (!Ctx || !blob?.size) return null;

  let ctx;
  try {
    const buffer = await blob.arrayBuffer();
    ctx = new Ctx();
    // Rejects on a format this browser cannot decode — possible even for audio
    // it just recorded, and a reason to degrade rather than fail the send.
    const audio = await ctx.decodeAudioData(buffer);
    return waveFromChannel(audio.getChannelData(0), audio.sampleRate);
  } catch {
    return null;
  } finally {
    // AudioContexts are a limited resource; leaking one per recording
    // eventually refuses to create any more.
    try { await ctx?.close(); } catch { /* already closed */ }
  }
}

/**
 * Build the envelope from decoded audio.
 *
 * @param {Float32Array} samples  mono channel data
 * @param {number} sampleRate
 * @returns {{v:number, ms:number, d:string}|null}
 */
/**
 * ONE waveform across MANY recording segments.
 *
 * Resume Recording stores a Voicey as segments (a call interrupted the first;
 * the user continued into a second). The recipient must see ONE note with ONE
 * continuous waveform, so the peaks are computed across the whole thing, not
 * per segment: every segment is decoded to PCM, the samples are concatenated in
 * order, and the envelope is built from the join. Because a bucket is a fixed
 * span of TIME (BUCKET_MS), the concatenation is time-correct and the boundary
 * between segments is invisible in the drawing — which is the point.
 *
 * Degrades to null (a plain bar) rather than failing a send, exactly like
 * computeWave. A single segment is just computeWave.
 */
export async function computeCombinedWave(blobs, ContextClass) {
  const list = (blobs || []).filter(b => b?.size);
  if (!list.length) return null;
  if (list.length === 1) return computeWave(list[0], ContextClass);

  const Ctx = ContextClass
    ?? (typeof window !== 'undefined' && (window.AudioContext ?? window.webkitAudioContext));
  if (!Ctx) return null;

  let ctx;
  try {
    ctx = new Ctx();
    const channels = [];
    let rate = 0;
    for (const b of list) {
      const audio = await ctx.decodeAudioData(await b.arrayBuffer());
      channels.push(audio.getChannelData(0));
      // Segments come from one mic in one session, so the rate is the same for
      // all; the first is authoritative and a stray mismatch degrades the wave,
      // never the note.
      rate = rate || audio.sampleRate;
    }
    const total = channels.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let off = 0;
    for (const c of channels) { merged.set(c, off); off += c.length; }
    return waveFromChannel(merged, rate);
  } catch {
    return null;
  } finally {
    try { await ctx?.close(); } catch { /* already closed */ }
  }
}

export function waveFromChannel(samples, sampleRate) {
  if (!samples?.length || !(sampleRate > 0)) return null;

  const durationMs = (samples.length / sampleRate) * 1000;
  const wanted = Math.round(durationMs / BUCKET_MS);
  const buckets = Math.max(MIN_BUCKETS, Math.min(MAX_BUCKETS, wanted));

  const per = Math.floor(samples.length / buckets);
  if (per < 1) return null;   // shorter than one sample per bucket

  const win = Math.max(1, Math.floor((WINDOW_MS / 1000) * sampleRate));
  const env = new Float64Array(buckets);

  for (let b = 0; b < buckets; b++) {
    const start = b * per;
    const end = start + per;
    let loudest = 0;

    // Max over sub-window RMS. The window slides in steps of its own length —
    // overlapping would cost 2x for a difference no bar 6px wide can show.
    for (let w = start; w < end; w += win) {
      const stop = Math.min(w + win, end);
      let sum = 0;
      for (let i = w; i < stop; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / (stop - w));
      if (rms > loudest) loudest = rms;
    }
    env[b] = loudest;
  }

  const reference = referenceLevel(env);
  // Digital silence. null means "no waveform" and the player draws its plain
  // bar, which is honest — a zero array renders as an invisible wave that looks
  // like a bug.
  if (!(reference > 0)) return null;

  const bytes = new Uint8Array(buckets);
  for (let b = 0; b < buckets; b++) {
    bytes[b] = Math.min(WAVE_MAX, Math.round((env[b] / reference) * WAVE_MAX));
  }

  return {
    v: WAVE_VERSION,
    ms: Math.round(durationMs / buckets),
    d: toBase64(bytes),
  };
}

/**
 * What counts as full height: the median of the loudest few buckets.
 *
 * Carried over from v1 unchanged, because the reasoning survived the format
 * change and two alternatives were measured and rejected there:
 *
 *   · the MAXIMUM — one door slam sets the scale for every word.
 *   · a percentile FLOORED at a fraction of the maximum — the floor puts the
 *     maximum back into the answer, so a louder slam silently redraws the
 *     speech around it.
 *
 * A median of the top few ignores the slam (it is one member of the set) while
 * still landing on speech when a note is mostly silence.
 *
 * ⚠ THE FRACTION IS SMALLER HERE THAN IN v1, and it has to be. v1 took the top
 * 9% of 56 buckets — five of them. At v2's resolution the top 9% of a 30-second
 * note is 84 buckets, which reaches well down into ordinary speech and would
 * drag the reference below it, clipping half the note flat.
 */
const TOP_FRACTION = 0.02;
const TOP_MIN = 3;

function referenceLevel(env) {
  const sorted = Array.from(env).sort((a, b) => a - b);
  const take = Math.max(TOP_MIN, Math.round(sorted.length * TOP_FRACTION));
  const top = sorted.slice(-take);
  const mid = Math.floor(top.length / 2);
  return top.length % 2 ? top[mid] : (top[mid - 1] + top[mid]) / 2;
}

/** True when this build can draw the given wave payload. */
export function isRenderableWave(wave) {
  return Boolean(
    wave
    && wave.v === WAVE_VERSION
    && typeof wave.d === 'string'
    && wave.d.length > 0
    && Number.isFinite(wave.ms),
  );
}

/**
 * Decode a stored wave back to bytes.
 *
 * Returns null rather than throwing on anything malformed. Payloads are
 * unvalidated by design (M9a: the renderer owns its payload shape), so junk is
 * reachable — and a thread must never fail to render because one message's
 * decoration could not be parsed.
 */
export function decodeWave(wave) {
  if (!isRenderableWave(wave)) return null;
  try {
    const raw = atob(wave.d);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out.length ? out : null;
  } catch {
    return null;
  }
}

function toBase64(bytes) {
  let s = '';
  // Chunked: String.fromCharCode(...bytes) blows the argument limit somewhere
  // around 65k, and MAX_BUCKETS is well under that today — but this is the kind
  // of ceiling that gets raised later by someone who does not know it is here.
  for (let i = 0; i < bytes.length; i += 4096) {
    s += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return btoa(s);
}

/**
 * Reduce the stored envelope to the bars actually drawn.
 *
 * ⚠ MAX PER GROUP, NOT MEAN. This is the step that puts an isolated spike on
 * screen, and it is what SoundCloud and Audacity do for the same reason:
 * averaging here would undo the peak-preservation the extraction just paid for.
 * At v2 resolution there are many buckets per bar — a 7-second note gives ~220
 * buckets across 28 bars — so this is a real reduction rather than a formality.
 *
 * @returns {number[]|null} heights in 0..1, or null when there is nothing to draw
 */
export function toDisplayWave(bytes, bars) {
  if (!bytes?.length || !(bars > 0)) return null;

  const out = new Array(bars);
  const per = bytes.length / bars;

  for (let i = 0; i < bars; i++) {
    const start = Math.floor(i * per);
    const end = Math.max(start + 1, Math.floor((i + 1) * per));
    let loudest = 0;
    for (let j = start; j < end && j < bytes.length; j++) {
      if (bytes[j] > loudest) loudest = bytes[j];
    }
    out[i] = Math.pow(loudest / WAVE_MAX, CONTRAST);
  }
  return out;
}

/**
 * Contrast applied at draw time.
 *
 * ⚠ GENTLER THAN v1's 2.1, DELIBERATELY. That exponent existed to manufacture
 * unevenness from an envelope that had already been averaged flat — it was
 * compensating for the extraction. v2's envelope carries the recording's own
 * dynamics, so the same curve would now double-count them and crush ordinary
 * speech into the floor: half the bars measured under 16% height on a signal
 * whose real envelope was nothing like that.
 *
 * 1.6 by sweep, not by taste. Measured on the same signal at 28 bars:
 *
 *   contrast   spread (sd)   distinct levels   bars on the floor
 *   1.0        0.216         22                 0
 *   1.6        0.244         21                 2
 *   2.1        0.252         18                11   ← v1's value
 *
 * The curve buys range by pushing bars DOWN, and past ~1.6 it is buying it by
 * dumping them on the 2px floor — eleven of twenty-eight at v1's setting, which
 * is precisely the "most of it looks like nothing" this redesign exists to end.
 * 1.6 keeps almost all of v1's spread while leaving two bars there instead of
 * eleven, and on a 30-second note it uses the most distinct levels of any value
 * tried.
 */
const CONTRAST = 1.6;
