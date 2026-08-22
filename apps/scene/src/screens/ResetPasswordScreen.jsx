import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { recoveryFromUrl } from '../lib/passwordRecovery';
import { EyeToggle } from './AuthScreen';
import s from './AuthScreen.module.css';

/**
 * /reset-password — where a reset link finishes.
 *
 * ⭐⭐ THIS SCREEN IS THE MISSING HALF. Before 2026-08-22 the app SENT reset
 * emails and had nowhere for them to land: no route, no `updateUser` call,
 * nothing reading the token. Every reset link in existence dropped its owner
 * on the login page, which is what a beta tester reported. Sending the email
 * was never the feature; changing the password is.
 *
 * The token was already taken out of the URL by lib/passwordRecovery, which
 * runs before the router. This screen applies it and asks the one question.
 *
 * ⛔ IT DOES NOT SIGN ANYONE OUT ON THE WAY IN. A recovery session replaces
 * whatever session is on the device, which is correct and is GoTrue's own
 * behaviour — but calling signOut first would strand a person whose link then
 * turned out to be expired, having cost them the session they arrived with.
 */
export default function ResetPasswordScreen() {
  const navigate = useNavigate();

  const [ready,    setReady]    = useState(false);
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [done,     setDone]     = useState(false);
  /* The link's own verdict arrives before this component does: an expired
     link is an ANSWER, so it is the opening state, not an error we discover. */
  const [error,    setError]    = useState(recoveryFromUrl?.error || '');

  /**
   * ⚠ ONE APPLICATION OF THE TOKEN, EVER. `recoveryFromUrl` is a module
   * constant, so React's double-invoked effects in StrictMode would otherwise
   * call setSession twice with the same single-use pair — the second call
   * fails, and the failure would read as "your link is expired" on a link that
   * had just worked.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!recoveryFromUrl?.tokens) {
        // No token in the URL. A live session still means a real person is
        // standing here — someone who arrived through the link a moment ago
        // and reloaded — so ask for the password rather than refusing.
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data?.session) { setReady(true); return; }
        if (!recoveryFromUrl?.error) {
          setError('Open the reset link from your email to set a new password.');
        }
        return;
      }
      const { error: sessionError } = await supabase.auth.setSession(recoveryFromUrl.tokens);
      if (cancelled) return;
      if (sessionError) {
        setError('That reset link is no longer valid. Ask for a new one and use the newest email.');
        return;
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 6)  { setError('Use at least 6 characters'); return; }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={s.screen}>
      <div className={s.logoTag}>YESPLEEZ</div>
      <h1 className={s.title}>NEW<br />PASSWORD.</h1>

      {done ? (
        <form className={s.form} onSubmit={e => { e.preventDefault(); navigate('/', { replace: true }); }}>
          {/* ⭐ The password change ALREADY SIGNED THEM IN — updateUser ran on a
              live session. Sending them back to a sign-in form to type the
              password they just chose is the app forgetting what it just did. */}
          <p className={s.resetMsg}>Password changed. You are signed in.</p>
          <button className={s.btnPrimary} type="submit">CONTINUE</button>
        </form>
      ) : ready ? (
        <form className={s.form} onSubmit={handleSubmit}>
          <p className={s.forgotDesc}>Choose a new password for your account.</p>

          <div className={s.field}>
            <label>New password</label>
            <div className={s.pwWrap}>
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="At least 6 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <EyeToggle shown={showPw} onToggle={() => setShowPw(p => !p)} />
            </div>
          </div>

          <div className={s.field}>
            <label>Confirm new password</label>
            <div className={s.pwWrap}>
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="Type it again"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          {error && <p className={s.error}>{error}</p>}
          <button className={s.btnPrimary} type="submit" disabled={loading}>
            {loading ? '…' : 'SAVE NEW PASSWORD'}
          </button>
        </form>
      ) : (
        <form className={s.form} onSubmit={e => { e.preventDefault(); navigate('/auth', { replace: true }); }}>
          {/* ⛔ NO SPINNER-AS-DEAD-END. Until the token resolves there is
              nothing to say, but once it fails the way forward is a fresh
              link, and the button that gets one is right here. */}
          {error
            ? <p className={s.error}>{error}</p>
            : <p className={s.forgotDesc}>Checking your reset link…</p>}
          {error && <button className={s.btnPrimary} type="submit">GET A NEW LINK</button>}
        </form>
      )}
    </div>
  );
}
