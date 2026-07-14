// Shared colour-contrast helper. A filled badge/pill/chip needs to know
// whether to render dark or light text on top of its own accent colour —
// this was previously a hand-maintained boolean duplicated per profile type
// (PortraitCard's old PILL_STYLES.dark), which could itself drift out of
// sync with the colour it described. Deriving it from the colour instead
// means there's nothing left to duplicate.

/**
 * Returns a dark or light text colour with good contrast against `hex`.
 * @param {string} hex - a "#rrggbb" colour
 * @returns {string} '#0a0a0f' (dark) or '#fff' (light)
 */
export function getContrastText(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Perceptual luma (ITU-R BT.601) — simple and fast, good enough for a
  // binary dark/light text decision against a solid accent colour.
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.5 ? '#0a0a0f' : '#fff';
}
