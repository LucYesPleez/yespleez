/**
 * THE HAND — the real mark, tintable.
 *
 * `public/hand-logo.png` IS the brand mark: it is the watermark behind the
 * dock, the auth screen and the app background. An approximation drawn beside
 * it is worse than useless — this gesture is meant to become recognisable
 * enough that the mark IS the brand, and a lookalike in the one place people
 * tap every day is exactly where that breaks down. An earlier version of this
 * file drew a generic open palm and did not match.
 *
 * ── WHY A MASK AND NOT AN <img> ──────────────────────────────────────
 *
 * A PNG cannot change colour, and this icon has to: it sits on a transparent
 * button when idle and must go dark when the button becomes the gradient.
 * `mask-image` uses the PNG's ALPHA as a stencil and fills it with
 * `currentColor`, so the shape is exactly the artwork while the colour is
 * inherited like every other icon in the composer.
 *
 * ── THE HONEST LIMITATION ────────────────────────────────────────────
 *
 * The mark is line art at roughly 10% pixel coverage. Those strokes are a few
 * pixels wide at 1122px, so the smaller this renders the thinner they get.
 * It holds up at conversational size; on a 46px button it is close to the
 * limit. If it reads as fuzz rather than a hand, the answer is an icon-weight
 * SOURCE — a solid version of the same gesture — not a different gesture.
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
