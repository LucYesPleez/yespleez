import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import PortraitCard from '../../components/PortraitCard';
import s from './LineupSheet.module.css';

/**
 * THE FULL BILL, FULL SCREEN.
 *
 * ⭐⭐ WHY THIS REPLACED AN IN-PLACE EXPAND (owner, 2026-08-28).
 *
 * SEE ALL used to grow the lineup section itself. On a phone that worked: the
 * section is in normal flow and the page simply got longer. On desktop it did
 * not, and could not — `EventPageLayout.bandMatched > .secondary > *` places
 * that column ABSOLUTELY, `inset: 0`, precisely so a thirty-card bill cannot
 * drag the band's height. Out of flow, an expanded grid pushes nothing: it ran
 * 2,424px past the bottom of its own section and painted straight down over
 * Set Times, the venue band and the poster.
 *
 * ⛔ The fix is NOT a taller column. The owner's ask names the right shape: the
 * whole screen, full of portraits. A bill is a thing you scan across, so it
 * wants the full width of the display rather than one narrow lane of it.
 *
 * ── ⛔⛔ THE BOTTOM NAV IS SACRED ──────────────────────────────────────
 *
 * This sheet sits at z-index 9000, UNDER the nav's 9999, and the grid reserves
 * `--yp-safe-bottom` at its foot. Covering the nav would make the full lineup
 * the one screen in the app you cannot navigate away from, and the nav is
 * permanent by law. ⛔ Do not raise this above 9999 to "fix" the overlap; the
 * reservation is the fix.
 *
 * ⚠ PORTALED TO <body>, and that is load bearing. `position: fixed` is trapped
 * by any ancestor carrying a `transform`, and the event page has several — so
 * rendered in place, `inset: 0` would mean some card halfway down the page.
 */
export default function LineupSheet({ artists = [], onOpenArtist = null, onClose }) {
  /**
   * ⚠ ESCAPE CLOSES IT, and the listener is on `window` rather than the sheet:
   * nothing inside has focus when it opens, so a listener on the element would
   * never hear the key.
   */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * ⭐ The page behind must not scroll under the sheet. Restored to whatever it
   * was, ⛔ never hard-coded back to `''`, in case something else is also
   * holding it (a sheet opened from a sheet).
   */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return createPortal(
    <div className={s.scrim} role="dialog" aria-modal="true" aria-label="Full lineup">
      <div className={s.head}>
        <h2 className={s.title}>LINEUP</h2>
        <span className={s.count}>{artists.length}</span>
        <button className={s.close} onClick={onClose}>CLOSE</button>
      </div>

      <div className={s.scroll}>
        <div className={s.grid}>
          {artists.map(a => (
            <PortraitCard
              key={a.id ?? a.name}
              profile={{ type: 'artist', ...a }}
              /* width 100%: the GRID decides how many fit across, and the card
                 fills whatever cell it lands in. `height: auto` keeps the 3:4
                 ratio PortraitCard derives from its own width. */
              width="100%"
              height="auto"
              showType={false}
              onClick={onOpenArtist ? () => onOpenArtist(a) : undefined}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
