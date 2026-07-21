/**
 * THE HAND, AT ICON WEIGHT.
 *
 * `public/hand-logo.png` is the brand mark and stays exactly as it is — it is
 * the watermark behind the dock, the auth screen and the app background. It
 * cannot be this icon:
 *
 *   - it is line art at ~10% pixel coverage. Those strokes are a few pixels
 *     wide at 1122px, so inside a 46px button they fall below one pixel and
 *     alias into grey mush.
 *   - it is a PNG, so it cannot take `currentColor` — it could never go dark
 *     when the button turns into a gradient.
 *   - it is portrait (1122×1402), which sits badly in a round button.
 *
 * So: same mark, two weights. A solid silhouette drawn for 24px, inheriting
 * colour like every other icon in the composer. That is normal brand practice
 * rather than a compromise — a logo and an icon are different jobs.
 *
 * An open hand, raised: the gesture behind the name. Four fingers and a thumb,
 * solid fill, no interior detail, because interior detail is the thing that
 * disappears first at small sizes.
 */
export default function HandIcon({ size = 20, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={style}
    >
      {/* Palm and the base of the fingers, as one mass. */}
      <path d="M5.2 12.6V8.9a1.35 1.35 0 0 1 2.7 0v2.2h.6V5.2a1.35 1.35 0 0 1 2.7 0v5.9h.6V4.3a1.35 1.35 0 0 1 2.7 0v6.8h.6V6.6a1.35 1.35 0 0 1 2.7 0v7.7c0 4.2-2.5 7-6.3 7-2.2 0-3.8-.9-5-2.6L3 14.4a1.3 1.3 0 0 1 .4-1.9 1.4 1.4 0 0 1 1.8.4z" />
    </svg>
  );
}
