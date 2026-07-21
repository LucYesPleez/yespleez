/**
 * WAVEFORM PEAKS — computed once, at record time, and stored with the message.
 *
 * §6.4: "Peaks are computed at record time on the client and stored as a small
 * fixed-length array with the message. The list can then render every waveform
 * instantly without fetching a single audio file. Computing waveforms at
 * playback time is the common implementation and it is why most apps show a
 * fake or delayed waveform."
 *
 * ── WHY THIS IS ARCHITECTURE AND NOT DECORATION ──────────────────────
 *
 * The alternative — decode the audio to draw the picture — forces a download of
 * every voice note in a thread on scroll, which destroys the property M9d was
 * built for: nothing is fetched until someone presses play. A waveform drawn
 * that way costs thirty round-trips to show thirty pictures.
 *
 * It is also the decision with the worst asymmetry on the whole roadmap. Peaks
 * CANNOT be retrofitted without downloading and re-decoding every note ever
 * recorded and rewriting every row. Every Voicey recorded before this shipped
 * is permanently peak-less — which is a fact the renderer must handle rather
 * than a migration to write.
 *
 * ── THE ENCODING ─────────────────────────────────────────────────────
 *
 * A fixed-length array of small integers, 0–PEAK_MAX. Fixed length because the
 * bar count is a visual constant, not a function of duration: a 4-second note
 * and a 90-second note both render as PEAK_COUNT bars, and resolving duration
 * is the timestamp's job, not the waveform's.
 *
 * Small ints because this lives in `payload` on every row and travels with
 * every message read. At 56 buckets of at most two digits it is roughly 200
 * bytes of JSON — small enough that no thread notices, and detailed enough that
 * speech reads as speech rather than as a rectangle.
 */

/** Bars in a rendered waveform. Visual constant — never derived from duration. */
export const PEAK_COUNT = 56;

/** Peaks are integers in [0, PEAK_MAX]. Keeps the payload compact. */
export const PEAK_MAX = 31;

/**
 * Compute peaks from recorded audio.
 *
 * Returns null rather than throwing on ANY failure. A voice note whose waveform
 * could not be computed is still a perfectly good voice note, and refusing to
 * send it — or worse, failing after the upload already succeeded — would let a
 * decorative feature break a communication one. Every caller treats null as
 * "no waveform", which is the same state every pre-M9f note is in permanently.
 *
 * @param {Blob} blob            the recording
 * @param {typeof AudioContext} [ContextClass] injectable for tests
 * @returns {Promise<number[]|null>}
 */
export async function computePeaks(blob, ContextClass) {
  const Ctx = ContextClass
    ?? (typeof window !== 'undefined' && (window.AudioContext ?? window.webkitAudioContext));
  if (!Ctx || !blob?.size) return null;

  let ctx;
  try {
    const buffer = await blob.arrayBuffer();
    ctx = new Ctx();
    // decodeAudioData rejects on a format this browser cannot decode — which is
    // possible even for audio it just RECORDED, and is a reason to degrade
    // rather than to fail the send.
    const audio = await ctx.decodeAudioData(buffer);
    return peaksFromChannel(audio.getChannelData(0));
  } catch {
    return null;
  } finally {
    // AudioContexts are a limited resource; leaking one per recording
    // eventually refuses to create any more.
    try { await ctx?.close(); } catch { /* already closed */ }
  }
}

/**
 * Reduce raw samples to PEAK_COUNT integers.
 *
 * Uses RMS per bucket, not peak amplitude. A single click or a stray transient
 * sets the maximum for its whole bucket, and a waveform drawn from maxima reads
 * as a flat wall with occasional spikes; RMS follows perceived loudness, so
 * speech looks like speech.
 *
 * Then normalises against the loudest bucket. Without `C20`'s auto gain control
 * the absolute level varies enormously between a quiet room and a loud venue,
 * and an un-normalised waveform would render a quiet recording as a flat line —
 * punishing exactly the recordings the DSP decision was made to protect.
 *
 * Exported for tests: this is pure and deterministic, while `computePeaks` is
 * neither.
 */
export function peaksFromChannel(samples) {
  if (!samples?.length) return null;

  const bucketSize = Math.floor(samples.length / PEAK_COUNT);
  if (bucketSize < 1) return null;   // shorter than one sample per bar

  const rms = new Array(PEAK_COUNT);
  for (let i = 0; i < PEAK_COUNT; i++) {
    let sum = 0;
    const start = i * bucketSize;
    for (let j = start; j < start + bucketSize; j++) sum += samples[j] * samples[j];
    rms[i] = Math.sqrt(sum / bucketSize);
  }

  const loudest = Math.max(...rms);
  // Digital silence. Returning a zero array would render an invisible waveform
  // that looks like a bug; null means "no waveform" and the player shows its
  // plain progress bar, which is honest about there being nothing to draw.
  if (!(loudest > 0)) return null;

  return rms.map(v => Math.round((v / loudest) * PEAK_MAX));
}

/**
 * Is this a peak array this build can draw?
 *
 * Payloads are unvalidated by design (M9a: "the renderer owns its payload
 * shape"), so this is where that ownership is exercised. A note from a future
 * build with a different PEAK_COUNT is not corrupt — it is just not drawable
 * here, and falls back to the plain bar rather than rendering a distorted
 * waveform or throwing inside a thread.
 */
/**
 * BARS ACTUALLY DRAWN, which is not the same as bars stored.
 *
 * PEAK_COUNT is 56 because that is what makes a good stored summary. Drawing 56
 * bars inside a ~190px player leaves each one under two pixels wide, and a row
 * of two-pixel bars reads as a comb rather than as audio — which is the real
 * reason the waveform looked uniform. The heights varied; they were just too
 * thin to see varying.
 *
 * 36 bars at ~3px with a 2px gap fills the same space and looks like something
 * recorded. This is a DISPLAY choice and changes no stored data, so it can be
 * retuned freely — unlike PEAK_COUNT, which is frozen into every payload ever
 * written.
 *
 * ── 36 → 42 (M9u) ────────────────────────────────────────────────────
 *
 * Finer, for a more organic read. Held well short of the comb: at the player's
 * ~193px this is about 2.6px a bar against 3.05 at 36, where 56 gave under 2
 * and failed. The lesson from that failure is the constraint here — "thinner"
 * has a floor, and it is nearer than it looks.
 */
export const DISPLAY_BARS = 42;

/**
 * Contrast curve applied to the drawn heights.
 *
 * Stored peaks are RMS, which is the right measure for a summary and a slightly
 * flat one to look at: RMS averages transients away, so speech arrives as a
 * gentle mound. An exponent above 1 pushes quiet buckets down harder than loud
 * ones, restoring the valleys between words that make a waveform read as speech
 * rather than as noise.
 *
 * Applied at DRAW time, never at record time. Baking it into the payload would
 * throw away the real measurement, and the curve is exactly the kind of thing
 * that gets retuned later.
 *
 * ── 1.7 → 2.1 (M9u) ──────────────────────────────────────────────────
 *
 * The waveform still read as "generated", and evenness was why: RMS plus a
 * gentle curve produces a row of similar mounds, which is what a synthesised
 * waveform looks like. A steeper exponent widens the gap between the loud parts
 * of a word and the gaps between words, so the shape becomes uneven in the way
 * real speech is.
 *
 * It cannot go much further. The curve only redistributes what RMS preserved;
 * push it hard and quiet passages collapse to the 2px floor, which turns
 * genuine speech into a flat line and loses more than it gains.
 */
const CONTRAST = 2.1;

/**
 * Turn stored peaks into the heights to draw: 0..1, one per bar.
 *
 * Downsamples by MAXIMUM rather than average. Averaging a second time after RMS
 * flattens what little dynamic range survived; taking the loudest bucket in
 * each group keeps the peaks where they actually were. Safe here precisely
 * because the stored values are already RMS — a single click cannot spike a bar,
 * because it was averaged out before it was ever stored.
 *
 * Returns null for anything unrenderable, so the caller falls back to the plain
 * bar exactly as before.
 */
export function toDisplayPeaks(peaks, bars = DISPLAY_BARS) {
  if (!isRenderablePeaks(peaks)) return null;

  const per = peaks.length / bars;
  const out = new Array(bars);

  for (let i = 0; i < bars; i++) {
    const start = Math.floor(i * per);
    const end   = Math.max(start + 1, Math.floor((i + 1) * per));
    let loudest = 0;
    for (let j = start; j < end && j < peaks.length; j++) {
      if (peaks[j] > loudest) loudest = peaks[j];
    }
    out[i] = Math.pow(loudest / PEAK_MAX, CONTRAST);
  }
  return out;
}

export function isRenderablePeaks(peaks) {
  return Array.isArray(peaks)
    && peaks.length === PEAK_COUNT
    && peaks.every(p => Number.isFinite(p) && p >= 0 && p <= PEAK_MAX);
}
