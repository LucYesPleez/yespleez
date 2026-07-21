/**
 * THE HAND — the real mark, tintable.
 *
 * The artwork IS the brand mark — never redrawn, never approximated. This
 * gesture is meant to become recognisable enough that the mark IS the brand,
 * so a lookalike in the one place people tap every day is exactly where that
 * breaks down. Two earlier versions of this file got it wrong: the first drew
 * a generic open palm from a rough trace, the second masked the OUTLINE
 * drawing rather than the solid mark. See the note in `index.css` — two
 * different files are both called hand-logo.png.
 *
 * ── WHY A MASK AND NOT AN <img> ──────────────────────────────────────
 *
 * A PNG cannot change colour, and this icon has to: it sits on a transparent
 * button when idle and must go dark when the button becomes the gradient.
 * `mask-image` uses the PNG's ALPHA as a stencil and fills it with
 * `currentColor`, so the shape is exactly the artwork while the colour is
 * inherited like every other icon in the composer.
 *
 * The mask lives in `index.css` because vendor prefixes and the `@supports`
 * fallback cannot be expressed inline. Without that fallback, a browser with
 * no mask support would paint a solid `currentColor` square.
 */
export default function HandIcon({ size = 20, style }) {
  return (
    <span
      className="yp-hand"
      aria-hidden="true"
      style={{ width: size, height: size, ...style }}
    />
  );
}
