import { useState } from 'react';
import { supabase } from '../lib/supabase';
import s from './AuthScreen.module.css';

export default function AuthScreen({ onGuest }) {
  const [mode,        setMode]        = useState('signin');
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [confirm,     setConfirm]     = useState('');
  const [showPw,      setShowPw]      = useState(false);
  const [name,        setName]        = useState('');
  const [error,       setError]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [forgotMode,  setForgotMode]  = useState(false);
  const [resetSent,   setResetSent]   = useState(false);

  function switchMode(m) { setMode(m); setError(''); setForgotMode(false); setResetSent(false); setConfirm(''); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (mode === 'signup' && password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
        if (error) throw error;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      setResetSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    <div className={s.screen}>
      <div className={s.logoTag}>YESPLEEZ</div>
      <h1 className={s.title}>ARTISTS.<br />LINEUPS.<br />SORTED.</h1>
      <p className={s.sub}>Sign in or create an account to continue</p>

      {/* Tabs */}
      <div className={s.tabs}>
        <button className={mode === 'signin' ? s.tabActive : s.tab} onClick={() => switchMode('signin')}>Sign In</button>
        <button className={mode === 'signup' ? s.tabActive : s.tab} onClick={() => switchMode('signup')}>Create Account</button>
      </div>

      {/* Forgot password form */}
      {forgotMode ? (
        <form className={s.form} onSubmit={handleReset}>
          {resetSent ? (
            <p className={s.resetMsg}>Check your email for a reset link.</p>
          ) : (
            <>
              <p className={s.forgotDesc}>Enter your email and we'll send you a link to reset your password.</p>
              <div className={s.field}>
                <label>Email</label>
                <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
              </div>
              {error && <p className={s.error}>{error}</p>}
              <button className={s.btnPrimary} type="submit" disabled={loading}>{loading ? '…' : 'SEND RESET LINK'}</button>
            </>
          )}
          <p style={{ textAlign: 'center', marginTop: 10 }}>
            <span className={s.authLink} onClick={() => setForgotMode(false)}>← Back to sign in</span>
          </p>
        </form>
      ) : (
        /* Sign in / Sign up form */
        <form className={s.form} onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div className={s.field}>
              <label>Name</label>
              <input type="text" placeholder="You can change this later" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
            </div>
          )}

          <div className={s.field}>
            <label>Email</label>
            <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
          </div>

          <div className={s.field}>
            <label>Password</label>
            <div className={s.pwWrap}>
              <input
                type={showPw ? 'text' : 'password'}
                placeholder={mode === 'signin' ? '••••••••' : 'Min 6 characters'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
              />
              <button type="button" className={s.eyeBtn} onClick={() => setShowPw(p => !p)} tabIndex={-1}>
                {showPw ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {mode === 'signup' && (
            <div className={s.field}>
              <label>Confirm Password</label>
              <input
                type="password"
                placeholder="Re-enter password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          )}

          {error && <p className={s.error}>{error}</p>}

          <button className={s.btnPrimary} type="submit" disabled={loading} style={{ marginTop: 8 }}>
            {loading ? '…' : mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}
          </button>

          {mode === 'signin' && (
            <p style={{ textAlign: 'center', marginTop: 8 }}>
              <span className={s.authLink} onClick={() => setForgotMode(true)}>Forgot password?</span>
            </p>
          )}

          {mode === 'signup' && (
            <p style={{ textAlign: 'center', marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
              Create your free account and get started.
            </p>
          )}
        </form>
      )}

      {/* Guest entry — matches v1 .artist-entry section */}
      <div className={s.artistEntry}>
        <p>No account? Jump straight in.</p>
        <button className={s.btnEntry} data-testid="guest-btn" onClick={onGuest}>
          ENTER AS GUEST →
        </button>
      </div>
    </div>
    </>
  );
}
