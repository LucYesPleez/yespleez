/**
 * The heart's LOOK — styles and glyph, shared by HeartBtn (events) and
 * FollowHeartBtn (profiles).
 *
 * ⚠ THIS FILE EXISTS TO BREAK AN IMPORT CYCLE, not for tidiness. These lived
 * in HeartBtn.jsx, which imports `useSession` from '../App'. The moment
 * FollowHeartBtn also imported them, the graph became
 *
 *     App → MySceneScreen → FollowHeartBtn → HeartBtn → App
 *
 * and module evaluation order flipped: MySceneScreen's top-level
 * `const SPOTLIGHT_HEART = HEART_OVERLAY_STYLE` ran while HeartBtn was still
 * initialising, throwing "Cannot access 'HEART_OVERLAY_STYLE' before
 * initialization" and taking the whole screen down.
 *
 * ⚠ `npm run build` SUCCEEDED and all 698 tests PASSED with the app broken —
 * bundlers hoist and tests never evaluated the real module graph. Only loading
 * the page showed it. Keep this module free of any import that reaches App.
 */

export const HEART_OVERLAY_STYLE = {
  width: 30, height: 30, borderRadius: '50%',
  background: 'rgba(0,0,0,.55)',
  // ⚠ LONGHAND, not the `border` shorthand. The liked state sets `borderColor`,
  // and mixing the two means the shorthand wins — which is exactly how a saved
  // heart once failed to show its pink ring.
  borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(255,255,255,.3)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#fff', cursor: 'pointer', padding: 0,
};

/**
 * The same heart WITHOUT the ring — owner, 2026-08-01: keep the border on the
 * Spotlight and Featured heroes, drop it everywhere else.
 *
 * ⚠ The ring is not decoration, so this is a considered trade. Measured against
 * the surfaces the heart sits on since it moved to the bottom-right corner: the
 * `rgba(0,0,0,.55)` fill scores 1.06–1.10 contrast against the portrait card's
 * text panel and the list card's overlay — the disc itself is invisible there,
 * and the border (2.65–2.70) was the only thing drawing the control. Without it
 * these hearts lean entirely on the glyph. Cleaner on a busy grid, which is the
 * point. The heroes keep the ring because their heart sits over POSTER artwork,
 * where brightness is unpredictable and the disc has real work to do.
 *
 * ⚠ borderWidth 0, NOT borderStyle:'none' — the liked state sets `borderColor`
 * and the longhand rule above has to keep holding.
 */
export const HEART_BARE_STYLE = { ...HEART_OVERLAY_STYLE, borderWidth: 0 };

/**
 * THE heart glyph, drawn once. Owner, 2026-08-01: "it would be good to keep it
 * uniform." Two hand-copied SVGs would drift the moment either is touched, and
 * the point is that a heart means one thing to the reader wherever it appears:
 * this is in my scene. What differs behind it is the row written — an event
 * follow vs a profile follow — never the mark.
 */
export function HeartGlyph({ filled }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
      fill={filled ? 'var(--neon)' : 'none'} stroke={filled ? 'var(--neon)' : 'currentColor'}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  );
}
