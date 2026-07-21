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
export function isRenderablePeaks(peaks) {
  return Array.isArray(peaks)
    && peaks.length === PEAK_COUNT
    && peaks.every(p => Number.isFinite(p) && p >= 0 && p <= PEAK_MAX);
}
