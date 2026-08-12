/**
 * THE FIVE ANSWER GLYPHS for /start.
 *
 * ⚠ DRAWN INLINE, NOT INSTALLED. The direction asked for "a small relevant
 * Lucide icon" and this app has no icon package — every glyph in it
 * (BottomNav, GlobalHeader, the dashboards) is an inline 24×24 stroke SVG in
 * exactly Lucide's idiom: `strokeWidth 2`, round caps and joins, no fill.
 * These follow that idiom to the letter, so adding a dependency for five
 * shapes would have introduced a second icon system to maintain rather than
 * matching the one already here.
 *
 * ⭐ `currentColor` throughout — the card sets the colour, so the pink/cyan
 * alternation lives in ONE place (the accent edge) instead of being baked
 * into five files.
 */

/**
 * ⭐ THE GRADIENT LIVES IN ONE `<defs>`, REFERENCED BY ID. An SVG stroke
 * cannot take a CSS gradient, so `background-clip` tricks do not apply here —
 * the paint has to be an SVG gradient the stroke points at. Declared once by
 * <StartIconDefs/> and referenced by every glyph, so changing the brand ramp
 * is one edit rather than five.
 */
export const ICON_GRADIENT_ID = 'yp-start-icon-gradient';

export const StartIconDefs = () => (
  <svg width="0" height="0" aria-hidden="true" focusable="false"
       style={{ position: 'absolute' }}>
    <defs>
      {/* ⭐ ONE SHIFT, PINK TO CYAN, DESATURATED (owner, 2026-08-12: "pull the
          saturation out"). Two stops only — the purple midpoint is gone, so
          the glyph reads as a single travel rather than three colours.
          ⚠ Mixed toward a neutral rather than replaced with hand-picked
          greys, so the hues stay tied to --neon / --neon2 and follow the
          brand if those tokens ever move. color-mix is already relied on in
          index.css, so this adds no new requirement. */}
      {/* ⚠⚠ `userSpaceOnUse`, AND IT IS LOAD-BEARING. A gradient defaults to
          objectBoundingBox units, which are computed per SHAPE — and a
          horizontal or vertical `<line>` has a bounding box of zero height or
          width, so the gradient degenerates and the line paints NOTHING.
          Measured 2026-08-12: the calendar rendered as a bare rounded square
          and the circle-minus as a bare circle, because every `<line>` in
          them had silently disappeared. It read as a design choice, not a
          rendering failure, which is what made it worth this comment.
          Pinning the gradient to the 24×24 viewBox instead makes every shape
          share one ramp regardless of its own box. */}
      <linearGradient
        id={ICON_GRADIENT_ID}
        gradientUnits="userSpaceOnUse"
        x1="0" y1="0" x2="24" y2="24"
      >
        <stop offset="0%"   stopColor="color-mix(in srgb, var(--neon) 58%, #93a0b8)" />
        <stop offset="100%" stopColor="color-mix(in srgb, var(--neon2) 58%, #93a0b8)" />
      </linearGradient>
    </defs>
  </svg>
);

const base = {
  xmlns: 'http://www.w3.org/2000/svg',
  // Larger, and standing on their own now that the tile behind them is gone.
  width: 27,
  height: 27,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: `url(#${ICON_GRADIENT_ID})`,
  // ⚠ Thinner as they grew. At 27px the old 2px stroke read as heavy, which
  // is half of what "too vibrant" was.
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

/**
 * ⭐ THE MY SCENE TAB'S OWN GLYPH (owner, 2026-08-12). Finding things and
 * MY SCENE are the same journey, so the card that starts it wears the mark of
 * the place it ends. ⚠ Copied shape-for-shape from BottomNav's MySceneIcon;
 * if that tab's icon changes, this must follow it.
 */
const Browse = () => (
  <svg {...base}>
    <path d="M16.051 12.616a1 1 0 0 1 1.909.024l.737 1.452a1 1 0 0 0 .737.535l1.634.256a1 1 0 0 1 .588 1.806l-1.172 1.168a1 1 0 0 0-.282.866l.259 1.613a1 1 0 0 1-1.541 1.134l-1.465-.75a1 1 0 0 0-.912 0l-1.465.75a1 1 0 0 1-1.539-1.133l.258-1.613a1 1 0 0 0-.282-.866l-1.156-1.153a1 1 0 0 1 .572-1.822l1.633-.256a1 1 0 0 0 .737-.535z" />
    <path d="M8 15H7a4 4 0 0 0-4 4v2" />
    <circle cx="10" cy="7" r="4" />
  </svg>
);

/** Mic: the performer. */
const Artist = () => (
  <svg {...base}>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="22" />
  </svg>
);

/** Calendar with a plus: the person who puts nights on. */
const Host = () => (
  <svg {...base}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="12" y1="14" x2="12" y2="18" />
    <line x1="10" y1="16" x2="14" y2="16" />
  </svg>
);

/**
 * ⭐ THE INDUSTRY TAB'S OWN GLYPH (owner, 2026-08-12) — a venue IS the
 * industry surface, so the answer wears the mark of where it leads.
 * ⚠ Copied shape-for-shape from BottomNav's IndustryIcon; if that tab's icon
 * changes, this must follow it.
 */
const Venue = () => (
  <svg {...base}>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

/**
 * ⛔ There is no `other` glyph. The "just looking around" answer was removed
 * (2026-08-12) because it did exactly what "Skip for now" does; its icon went
 * with it rather than sitting here unused.
 */
export const START_ICONS = {
  browse: Browse,
  artist: Artist,
  host:   Host,
  venue:  Venue,
};

/**
 * The directional affordance on every card. Shifts on hover; see the CSS.
 *
 * ⭐ THE HEADER'S BACK CHEVRON, MIRRORED (owner, 2026-08-12). GlobalHeader
 * draws `m15 18-6-6 6-6` at strokeWidth 2 with round caps; this is the same
 * mark pointing the other way, so "go back" and "go through" are one visual
 * idea in two directions rather than two unrelated arrows.
 * ⚠ If that button's glyph changes, this must follow it.
 *
 * ⚠ `currentColor`, NOT the gradient — this one takes its colour from the
 * card so it can sit muted at rest and brighten on hover. The gradient is for
 * the subject glyphs, which are the thing being named.
 */
export const ArrowGlyph = () => (
  <svg {...base} width="20" height="20" stroke="currentColor" strokeWidth={2}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);
