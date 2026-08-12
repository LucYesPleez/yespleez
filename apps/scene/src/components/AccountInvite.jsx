/**
 * THE ACCOUNT INVITE — one look for every "an account is what does this".
 *
 * Extracted from ParticipationGate (owner, 2026-08-12: make Industry, My
 * Scene and Messages match the sheet that comes up on the heart). The gate
 * had the right voice and the right controls; the three tab surfaces each had
 * their own improvised version, and Messages had none at all.
 *
 * ⚠ CONTENT ONLY — no background, no border, no positioning. The PARENT owns
 * the surface, which is what lets the identical block sit inside a slide-up
 * sheet (ParticipationGate, IndustryPanel) and inside a plain screen (My
 * Scene, Messages) without either one pretending to be the other. A card
 * drawn here would nest a card inside the sheet.
 *
 * ⛔ NEVER "Sign in required." Every use names what the account ENABLES —
 * the rule the gate was built on and the reason these three surfaces were
 * worth unifying rather than merely restyling.
 *
 * `onDismiss` is optional and deliberately so: an ACTION gate can be waved
 * away because the content is still there behind it, but a DESTINATION gate
 * has nothing behind it to return to, and a "Not now" that leaves someone on
 * an empty screen is a dead end wearing a friendly label.
 */

import s from './AccountInvite.module.css';

export default function AccountInvite({
  title,
  /** A string, or a node where a surface needs its own line break. */
  body,
  onCreateAccount,
  onSignIn,
  onDismiss = null,
  dismissLabel = 'Not now',
}) {
  return (
    <div className={s.invite}>
      <h2 className={s.title}>{title}</h2>
      <p className={s.body}>{body}</p>
      <button type="button" className={s.primary} onClick={onCreateAccount}>
        CREATE FREE ACCOUNT
      </button>
      {/* ⛔ NO EM DASH (owner rule, 2026-08-12). A question mark carries the
          same two-part sense and reads faster in a button. */}
      <button type="button" className={s.secondary} onClick={onSignIn}>
        ALREADY HAVE ONE? SIGN IN
      </button>
      {onDismiss && (
        <button type="button" className={s.dismiss} onClick={onDismiss}>
          {dismissLabel}
        </button>
      )}
    </div>
  );
}
