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
 * ── NORMALISED TO A PERCENTILE, NOT TO THE LOUDEST BUCKET ────────────
 *
 * It used to divide by the maximum, which meant ONE moment set the scale for the
 * whole note. A door slam, a laugh, a bump on the mic — and every word in the
 * recording was drawn as a fraction of that, collapsing toward the 2px floor.
 * The owner reported it as "most of the chat looks like nothing" (2026-07-22),
 * and asked for consistent dynamics with the outlier simply clipped.
 *
 * So the reference is the 90th percentile of the buckets. Ordinary speech then
 * fills the wave at roughly the same height in every note — which is what makes
 * two Voiceys comparable at a glance — and anything above the reference CLIPS at
 * PEAK_MAX rather than dragging the rest down. Clipping loses only the fact that
 * one bucket was louder than another already-loud bucket, which is not
 * information anybody reads off a 6px-wide bar.
 *
 * ⚠ WHY NOT AN ABSOLUTE FIXED SCALE. That was the more literal reading of the
 * request and it would break Android. §6.1's amendment gave iOS Apple's gain
 * control, but `C20` still deliberately disables it everywhere else, so absolute
 * level there swings with the room — and a fixed scale renders a quiet recording
 * as a flat line, which is the exact fault the old normalisation existed to
 * prevent. A percentile keeps that protection: it still adapts to the note's own
 * level, it just stops one sample defining it.
 *
 * ⚠ THE FLOOR MATTERS. On a note that is mostly silence the 90th percentile can
 * land inside the silence, making the reference near-zero and clipping the
 * speech into a solid block. `REFERENCE_FLOOR` keeps the reference at a sensible
 * fraction of the maximum, so the worst case degrades to something close to the
 * old behaviour instead of to a rectangle.
 *
 * ⚠ THIS CHANGES NEW RECORDINGS ONLY. Peaks are computed once at record time and
 * frozen into the payload, so every existing Voicey keeps the waveform it was
 * stored with. Nothing here retrofits them, and there is no marker distinguishing
 * the two encodings — a note simply looks like whatever build recorded it.
 *
 * Exported for tests: this is pure and deterministic, while `computePeaks` is
 * neither.
 */

/**
 * Full height is the MEDIAN OF THE LOUDEST FEW BUCKETS.
 *
 * Read as: "how loud is this note when someone is actually talking". Everything
 * is drawn against that, and anything above it clips.
 *
 * ── WHY A MEDIAN OF A FEW, AND NOT SOMETHING SIMPLER ─────────────────
 *
 * Three candidates were tried and two are wrong in ways worth recording, since
 * both look correct until a specific note breaks them:
 *
 *   · THE MAXIMUM — the original. One door slam sets the scale for every word.
 *     This is the reported fault.
 *   · A PERCENTILE FLOORED AT A FRACTION OF THE MAXIMUM — my first attempt.
 *     The floor puts the maximum back into the answer, so a LOUDER slam raises
 *     the floor and silently redraws the speech around it. Caught by a test
 *     asserting the same words render the same way whatever else is in the note.
 *   · A PERCENTILE ALONE — correct for ordinary speech, but on a note that is
 *     mostly silence the 90th percentile lands INSIDE the silence, the reference
 *     goes to near zero, and the whole wave clips into a solid block.
 *
 * Taking the median of the loudest `TOP_FRACTION` survives all three. The slam
 * is one member of that set and a median ignores it. On a sparse note the set is
 * dominated by the few loud buckets, so the reference lands on speech rather
 * than on the silence around it.
 */
const TOP_FRACTION = 0.09;      // 5 of 56 buckets

/** Never fewer than this, or the "median of a few" is a median of one. */
const TOP_MIN = 3;
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

  // ⚠ SORTED ON A COPY. `rms` is positional — sorting it in place would draw the
  // note's buckets in ascending order, a smooth ramp that looks plausible enough
  // to ship unnoticed.
  const sorted = [...rms].sort((a, b) => a - b);
  const top = sorted.slice(-Math.max(TOP_MIN, Math.round(sorted.length * TOP_FRACTION)));
  const mid = Math.floor(top.length / 2);
  const reference = top.length % 2
    ? top[mid]
    : (top[mid - 1] + top[mid]) / 2;

  // `reference` comes from a set whose largest member is `loudest`, so it can
  // only be zero if the loudest bucket is — which returned null above.
  return rms.map(v => Math.min(PEAK_MAX, Math.round((v / reference) * PEAK_MAX)));
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
 * The stored envelope is far finer than this — v2 samples every ~32ms, so a
 * seven-second note holds ~220 buckets. This is the reduction to what the player
 * has room for, and  takes the MAX of each group so an isolated
 * spike survives the trip rather than being averaged out of it.
 *
 * ── ONE COUNT, EVERY VIEWPORT ────────────────────────────────────────
 *
 * This was 42 on desktop and 28 on phones for one day, and the split is gone —
 * the owner asked for desktop to match the phone, which they had approved.
 *
 * The number is chosen in PIXELS PER BAR, which is what decides whether a wave
 * reads as audio or as a comb. Measured across the two players:
 *
 *              wave width    42 bars    28 bars
 *   phone         207px       3.5px      5.9px
 *   desktop       199px       3.3px      5.7px
 *
 * 56 bars at under 2px was tried during M9f and failed outright — thin enough
 * that varying heights stopped being visible, which is the real reason the
 * waveform once looked uniform. 28 puts both players at 5.7-5.9px, so a Voicey
 * has the same character on a phone and a laptop.
 *
 * ⚠ DISPLAY ONLY. Both formats are downsampled to this from a frozen payload, so
 * nothing stored changes and this can be retuned freely — unlike PEAK_COUNT,
 * which is written into every v1 row ever created.
 */
export const DISPLAY_BARS = 32;

/**
 * How much audio one drawn bar represents.
 *
 * ⚠ A SHORT NOTE IS NOT STRETCHED TO FILL THE PLAYER. Every note used to draw
 * DISPLAY_BARS whatever its length, so a bar meant 107ms in a three-second note
 * and 1.07s in a thirty-second one — the same picture width for wildly different
 * amounts of speech, which is what made a short Voicey look artificially wide.
 *
 * Bars are a fixed width and a fixed slice of time, so the wave simply STOPS
 * when the audio does. A three-second note is a short wave; a seven-second one
 * fills the player. That is the same principle v2 applied to storage, finally
 * applied to the drawing as well.
 *
 * ── TWO PHASES, LIKE A TEXT BUBBLE ──────────────────────────────────
 *
 * GROWTH, 0 to GROWTH_MS: the bubble gets longer with the recording and the
 * density never changes. This is the phase that makes duration legible without
 * reading the clock — an 8-second note is visibly shorter than an 18-second one.
 *
 * COMPRESSION, past GROWTH_MS: the bubble stops at the same 76% ceiling a text
 * bubble grows into, and further audio is fitted into the same bars. A 45-second
 * note compresses mildly, three minutes more heavily, six minutes more again —
 * same width, denser wave. Nothing has to switch modes for that to happen: the
 * bar count is simply clamped, and the downsample does the rest.
 *
 * ⚠ THERE IS NO TRANSITION TO ANIMATE, and it was suggested. A sent Voicey is
 * rendered once at its final density — the growth-to-compression change happens
 * BETWEEN notes, not within one, so there is no moment where a user watches a
 * wave resample. That idea belongs to the live recording meter, which is a
 * different component.
 */
export const GROWTH_MS = 20_000;

/** Derived, so the two can never disagree about when the bubble stops growing. */
export const MS_PER_BAR = GROWTH_MS / DISPLAY_BARS;

/**
 * Fewer than this and the wave stops reading as a wave.
 *
 * A one-second note would otherwise draw four bars, which looks like a rendering
 * failure rather than a short recording. Below the floor a note is drawn slightly
 * stretched — accepted deliberately, because "too short to be a picture" is a
 * worse failure than "not quite to scale".
 */
export const MIN_DISPLAY_BARS = 8;

/**
 * How many bars this note draws.
 *
 * Falls back to the full count when the duration is unknown, which is the honest
 * default: a payload with no `duration_ms` predates that field, and drawing it
 * short would assert a length nothing measured.
 */
export function barsForDuration(durationMs) {
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms <= 0) return DISPLAY_BARS;
  return Math.max(MIN_DISPLAY_BARS, Math.min(DISPLAY_BARS, Math.round(ms / MS_PER_BAR)));
}

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
