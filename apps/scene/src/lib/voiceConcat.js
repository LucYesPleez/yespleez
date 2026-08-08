/**
 * SEGMENT STITCHING — many recording segments into one playable note.
 *
 * Resume Recording stores a Voicey as separate COMPRESSED segments: small on
 * the wire and at rest, which is what a festival's reception needs. But the
 * recipient must hear ONE seamless note. Rather than teach the player to swap
 * sources at segment boundaries — and reconcile scrubbing, speed and the
 * waveform across them — the segments are decoded and concatenated into a
 * single in-memory clip on first play. The existing single-source player then
 * treats it exactly like any other note: one duration, one scrubber, one speed,
 * one waveform, seamless seeking.
 *
 * ── WHY WAV, AND WHY THAT IS FINE HERE ───────────────────────────────
 *
 * The concatenated clip is uncompressed PCM in a WAV container. That is large,
 * but it never touches the network or storage — it exists only in this tab, for
 * this playback, and is revoked when the player unmounts. What crosses the wire
 * stays the compressed segments. Encoding WAV needs no codec, so there is no
 * WASM dependency and no real-time re-encode; decode + concat runs faster than
 * playback.
 *
 * A single segment never comes here — the player uses its url directly.
 */

/** 16-bit PCM WAV from mono float samples. No codec, no dependency. */
function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  str(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);         // PCM header size
  view.setUint16(20, 1, true);          // PCM format
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);          // block align
  view.setUint16(34, 16, true);         // bits per sample
  str(36, 'data');
  view.setUint32(40, n * 2, true);

  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Fetch every segment url, decode, concatenate the audio, and return one object
 * url for the whole note. Returns null on any failure — the caller falls back
 * to the first segment rather than showing a broken player.
 *
 * @param {string[]} urls  segment urls in order (signed, or local object urls)
 */
export async function concatToObjectUrl(urls, ContextClass) {
  const list = (urls || []).filter(Boolean);
  if (!list.length) return null;

  const Ctx = ContextClass
    ?? (typeof window !== 'undefined' && (window.AudioContext ?? window.webkitAudioContext));
  if (!Ctx) return null;

  let ctx;
  try {
    ctx = new Ctx();
    const channels = [];
    let rate = 0;
    for (const u of list) {
      const res = await fetch(u);
      const audio = await ctx.decodeAudioData(await res.arrayBuffer());
      channels.push(audio.getChannelData(0));
      rate = rate || audio.sampleRate;   // same mic, same session → same rate
    }
    const total = channels.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let off = 0;
    for (const c of channels) { merged.set(c, off); off += c.length; }
    return URL.createObjectURL(encodeWav(merged, rate));
  } catch {
    return null;
  } finally {
    try { await ctx?.close(); } catch { /* already closed */ }
  }
}
