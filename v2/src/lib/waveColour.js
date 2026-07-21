/**
 * THE WAVEFORM'S COLOUR — the one saturated thing in a Voicey.
 *
 * The bubble is black glass with purple LIGHTING; the surface itself is very
 * nearly neutral. All of the brand's colour has moved here, because a waveform
 * is the only element in the component wide enough to show a gradient and the
 * only one that means something while it changes.
 *
 * Extracted from `VoiceMessage` for the reason the recorder's transition table
 * and the live waveform's alignment were: components cannot be exercised by
 * this project's test setup, and a boundary error in a piecewise interpolation
 * shows up as a slightly wrong colour — which nobody spots by looking.
 */

/**
 * THREE STOPS, NOT TWO.
 *
 * The brand's own cyan→violet across the first stretch, then violet→magenta for
 * the tail. A straight cyan-to-magenta line passes through a washed-out pink in
 * the middle and never actually shows the violet the brand is built on.
 *
 * `at` values must be ascending and span 0..1.
 */
const WAVE_HUES = [
  { at: 0,    c: { r: 0,   g: 229, b: 255 } },   // cyan
  { at: 0.58, c: { r: 191, g: 95,  b: 255 } },   // violet — the brand's centre
  { at: 1,    c: { r: 255, g: 79,  b: 216 } },   // magenta
];

/**
 * ONE KNOB FOR HOW BRIGHT THE PLAYED WAVE IS.
 *
 * The brand hues at full strength were too hot against a near-black bubble —
 * the wave stopped being the hero and became a strip light. Scaling all three
 * channels by the same factor dims them while leaving the HUE untouched, which
 * is what distinguishes this from lowering alpha: alpha would blend the wave
 * toward whatever is behind it and change its colour as the wallpaper scrolled.
 *
 * Raise toward 1 for more heat, lower for more restraint. Nothing else needs
 * to change with it — the stops, the tests and the gradient all derive.
 */
export const WAVE_BRIGHTNESS = 0.78;

/** The brand gradient at the current brightness. */
export const WAVE_STOPS = WAVE_HUES.map(s => ({
  at: s.at,
  c: {
    r: Math.round(s.c.r * WAVE_BRIGHTNESS),
    g: Math.round(s.c.g * WAVE_BRIGHTNESS),
    b: Math.round(s.c.b * WAVE_BRIGHTNESS),
  },
}));

/**
 * The played colour at position `u` along the wave.
 *
 * @param {number} u 0 at the first bar, 1 at the last
 * @returns {{r:number,g:number,b:number,a:number}}
 *
 * Clamps rather than extrapolating. Out of range means a caller computed a
 * position wrongly, and extrapolating a gradient past its ends produces
 * channel values outside 0–255 — an invalid colour that renders as nothing at
 * all, so the bar would silently vanish instead of looking wrong.
 */
export function playedAt(u) {
  const x = Number.isFinite(u) ? Math.max(0, Math.min(1, u)) : 0;

  let lo = WAVE_STOPS[0];
  let hi = WAVE_STOPS[WAVE_STOPS.length - 1];
  for (let i = 0; i < WAVE_STOPS.length - 1; i++) {
    if (x >= WAVE_STOPS[i].at && x <= WAVE_STOPS[i + 1].at) {
      lo = WAVE_STOPS[i];
      hi = WAVE_STOPS[i + 1];
      break;
    }
  }

  const span = hi.at - lo.at;
  const t = span > 0 ? (x - lo.at) / span : 0;
  return {
    r: lo.c.r + (hi.c.r - lo.c.r) * t,
    g: lo.c.g + (hi.c.g - lo.c.g) * t,
    b: lo.c.b + (hi.c.b - lo.c.b) * t,
    a: 1,
  };
}
