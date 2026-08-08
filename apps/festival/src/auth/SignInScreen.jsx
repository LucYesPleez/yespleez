import { useState } from 'react';
import { supabase } from '../data/supabase/client';
import { TextInput } from '../design-system/Form';
import Button from '../design-system/Button';
import s from './SignInScreen.module.css';

/**
 * SIGN IN.
 *
 * ⛔ Sign-in only — no sign-up, no password reset. A festival organiser
 * already has a YesPleez account; this portal is a workspace for an identity
 * that exists, not a place to create one. Account creation lives in the Scene
 * app and must not fork.
 *
 * Email + password matches Scene's AuthScreen, so the same credentials work.
 */
export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    // On success the auth listener swaps this screen out, so there is nothing
    // to do here — and clearing `busy` would briefly re-enable a button on a
    // screen that is about to unmount.
    if (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className={s.wrap}>
      <form className={s.card} onSubmit={submit}>
        <h1 className={s.brand}>YESPLEEZ FESTIVAL</h1>
        <span className={s.sub}>Sign in with your YesPleez account.</span>

        <div className={s.fields}>
          <TextInput
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <TextInput
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </div>

        <div className={s.error} role="alert">{error}</div>

        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
