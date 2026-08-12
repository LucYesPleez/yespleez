/**
 * THE INVITE, AS A SHEET — one slide-up, wherever an account is what's next.
 *
 * Owner, 2026-08-12: the heart's sheet is the reference, Industry matches it,
 * and My Scene slides up the same way. This is that presentation in ONE
 * place — the dock, the handle, the rise — so the surfaces cannot drift into
 * three subtly different sheets.
 *
 * ⚠ PORTALLED TO BODY. Ancestors carry transforms (the header, several
 * screens), and a transformed ancestor becomes the containing block for
 * `position: fixed` — the standing rule in this codebase, not a precaution.
 *
 * ⛔ IT DOCKS ABOVE THE NAV, via --yp-safe-bottom. Nothing renders over the
 * bottom nav, ever.
 *
 * ── DISMISSIBLE OR NOT, AND WHY IT MATTERS ───────────────────────────
 *
 * `onDismiss` is optional, and the difference is not cosmetic:
 *
 *   ACTION gate (the heart)      — the event is still there behind it, so it
 *                                  can be waved away. Scrim + "Not now", and
 *                                  it is a modal dialog.
 *   DESTINATION gate (My Scene)  — there is nothing behind it to return to.
 *                                  No scrim, no dismiss: a "Not now" that
 *                                  leaves someone on an empty screen is a
 *                                  dead end wearing a friendly label. The
 *                                  bottom nav is the way out, and it is
 *                                  always visible.
 */

import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import AccountInvite from './AccountInvite';
import s from './AccountInviteSheet.module.css';

/**
 * ⭐ ONE INVITE SHEET AT A TIME (owner, 2026-08-12: "when i press my scene or
 * messages a sheet shows, and when i click industry that sheet comes up
 * behind it").
 *
 * My Scene and Messages hold their invite up for as long as the visitor is
 * signed out — that is the screen's whole content. The Industry panel then
 * slides its own invite over the top, and the two stack: two handles, two
 * CREATE FREE ACCOUNT buttons, one behind the other.
 *
 * Shell publishes "another sheet owns the screen right now" here, and every
 * AccountInviteSheet stands down while it is true. ⚠ SUPPRESSED, NOT
 * UNMOUNTED-AND-FORGOTTEN: closing the panel brings the screen's own sheet
 * straight back, because the condition that made it necessary never changed.
 */
export const InviteSuppressCtx = createContext(false);

export default function AccountInviteSheet({
  title,
  body,
  onCreateAccount,
  onSignIn,
  onDismiss = null,
  dismissLabel = 'Not now',
}) {
  if (useContext(InviteSuppressCtx)) return null;

  return createPortal(
    <>
      {onDismiss && <div className={s.scrim} onClick={onDismiss} />}
      <div
        className={s.sheet}
        /* Only the dismissible one is a modal dialog. The destination sheet
           sits alongside the nav rather than trapping the visitor in it, so
           announcing it as modal would be a lie to a screen reader. */
        role={onDismiss ? 'dialog' : 'region'}
        aria-modal={onDismiss ? 'true' : undefined}
        aria-label={title}
      >
        <div className={s.handle} />
        <AccountInvite
          title={title}
          body={body}
          onCreateAccount={onCreateAccount}
          onSignIn={onSignIn}
          onDismiss={onDismiss}
          dismissLabel={dismissLabel}
        />
      </div>
    </>,
    document.body,
  );
}
