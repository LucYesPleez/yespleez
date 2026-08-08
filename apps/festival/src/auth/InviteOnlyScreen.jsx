import Button from '../design-system/Button';
import s from './SignInScreen.module.css';

/**
 * A signed-in account that is not on the beta allowlist.
 *
 * ⭐ Says what is true and no more: the portal exists, it is invite-only, and
 * this account is not invited. No "coming soon", no waitlist form, no apology
 * paragraph — anything warmer would invite replies there is nobody to answer.
 *
 * Shows WHICH account, because the commonest reason to land here honestly is
 * signing in with the wrong one — and without the email on screen that is
 * indistinguishable from not being invited at all.
 */
export default function InviteOnlyScreen({ email, onSignOut }) {
  return (
    <div className={s.wrap}>
      <div className={s.card}>
        <h1 className={s.brand}>YESPLEEZ FESTIVAL</h1>
        <span className={s.sub}>
          The festival portal is invite-only while it is in beta.
          {email ? <> You are signed in as <strong>{email}</strong>.</> : null}
        </span>
        <Button variant="secondary" block onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
