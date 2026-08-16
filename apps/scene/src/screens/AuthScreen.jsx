import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import { resumeIntent } from '../lib/intentActions';
import { postAuthDestination } from '../lib/postAuthDestination';
import { track, EVENTS } from '../lib/analytics';
import s from './AuthScreen.module.css';

/**
 * /auth — a routed surface, not the application's front door.
 *
 * This screen is an INTERRUPTION in an existing journey (owner, 2026-08-12):
 * someone browsing taps SIGN IN, lands here, and goes back to exactly where
 * they were the moment a session exists. It therefore never renders above the
 * router (the old wall shape) and never owns the boot sequence.
 *
 * `leave()` is the whole return mechanism for O1: history back when this app
 * put an entry behind us, What's On when the visitor cold-loaded /auth
 * directly (`location.key === 'default'` is react-router's marker for the
 * first entry — there is nothing of ours behind it to go back to). O2 adds
 * returnIntent on top of this; route restoration already works without it
 * because navigation preserved the journey.
 *
 * The same effect covers both directions: arriving here already signed in
 * bounces straight off, and signing in/up here leaves as soon as
 * onAuthStateChange delivers the session.
 */
export default function AuthScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useSession() ?? {};
  // O2 · the ParticipationGate names which tab it is sending someone to —
  // CREATE FREE ACCOUNT should not land on a sign-in form.
  const [mode,        setMode]        = useState(() =>
    location.state?.mode === 'signup' ? 'signup' : 'signin');
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [confirm,     setConfirm]     = useState('');
  const [showPw,      setShowPw]      = useState(false);
  // Its own toggle, not a shared one. Someone reveals the confirm field to
  // check what they just typed a second time; unmasking the field above it at
  // the same moment is a different act, and one they did not ask for.
  const [showConfirm, setShowConfirm] = useState(false);
  const [name,        setName]        = useState('');
  const [error,       setError]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [forgotMode,  setForgotMode]  = useState(false);
  const [resetSent,   setResetSent]   = useState(false);

  function leave() {
    if (location.key !== 'default') navigate(-1);
    else navigate('/', { replace: true });
  }

  /**
   * O2 · leaving now goes through the returnIntent slot first. With an
   * intent: complete the auto-safe act (lib/intentActions — save/follow
   * only, ⛔ never a send or a submit) and put the person back on the exact
   * route the gate captured. Without one: the O1 behaviour, history back.
   *
   * ⚠ THE REF IS THE DOUBLE-RUN GUARD. StrictMode double-invokes effects and
   * consumeIntent is destructive — the second invocation would find an empty
   * slot and fall through to leave(), queueing a second navigation. One
   * flag, one departure.
   */
  const handledRef = useRef(false);
  /**
   * O3 · WAS THIS A SIGNUP? Recorded at submit rather than read from `mode`,
   * because someone can switch tabs while the request is in flight — and the
   * question belongs to the act that created the account, not to whichever
   * tab happens to be showing when the session lands.
   */
  const signedUpRef = useRef(false);
  useEffect(() => {
    if (!session || handledRef.current) return;
    handledRef.current = true;
    (async () => {
      const resumed = await resumeIntent(session);
      // ⭐⭐ INTENT FIRST, ALWAYS — an event-origin signup goes back to its
      // event with the save done, and never meets the question.
      const dest = postAuthDestination({
        intentRoute: resumed?.intent?.route ?? null,
        wasSignup:   signedUpRef.current,
      });
      if (dest) navigate(dest, { replace: true });
      else leave();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  function switchMode(m) {
    setMode(m); setError(''); setForgotMode(false); setResetSent(false);
    setConfirm(''); setShowConfirm(false);
  }

  /**
   * ⚠ CLEARING THE PASSWORD CLEARS THE CONFIRMATION WITH IT. The confirm field
   * only renders once a password has been typed, so emptying the password
   * unmounts it — and a retained value would come back the moment the next
   * character is typed, silently pre-filled with the OLD password. That reads
   * as "already confirmed" and is wrong exactly when someone is starting over.
   */
  function onPasswordChange(v) {
    setPassword(v);
    if (!v) { setConfirm(''); setShowConfirm(false); }
  }

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
        // O3 · an account was just created on this device — the one moment
        // the "what brings you here?" question is asked. Set only after the
        // call succeeded, so a rejected signup never sends anyone to /start.
        signedUpRef.current = true;
        // A1 · signed_up only, never signed_in. Returning visits are already
        // counted by opened_app; a second event on every sign-in would make
        // "new users" and "sessions" measure the same thing.
        //
        // No email, no name — rule 3. This row says an account was created on
        // this device, which is the entire question.
        track(EVENTS.SIGNED_UP);
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
      <p className={s.sub}>Sign in or create your account</p>

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
          {/* ⭐ THE PLACEHOLDER IS THE INSTRUCTION (owner, 2026-08-16). This is
              the ACCOUNT holder, a person, and people were filling it with
              their act or band name because nothing here said otherwise. An
              act gets its own profile later; this field never does that job,
              so it asks the question in the words a person answers it in.
              "You can change this later" moved to the hint below rather than
              being deleted: it lowers the stakes, but it was doing that in the
              one slot that could have prevented the mistake. */}
          {mode === 'signup' && (
            <div className={s.field}>
              <label>Name</label>
              <input type="text" placeholder="How your friends know you" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
              <p className={s.hint}>Not your act or band name. You can change this later.</p>
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
                onChange={e => onPasswordChange(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
              />
              <EyeToggle shown={showPw} onToggle={() => setShowPw(p => !p)} />
            </div>
          </div>

          {/* ⭐ THE SECOND FIELD DOES NOT EXIST UNTIL THERE IS SOMETHING TO
              CONFIRM (owner, 2026-08-16). Asking someone to re-enter a
              password they have not chosen yet is two empty boxes and one
              decision; the form now poses that decision once, and only asks
              for the check after it has been made.

              ⚠ The gate is `password` itself, NOT a "has been touched" flag.
              Clearing the field takes the confirmation away again, which is
              what onPasswordChange is for. */}
          {mode === 'signup' && password.length > 0 && (
            <div className={s.field}>
              <label>Confirm Password</label>
              <div className={s.pwWrap}>
                <input
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Re-enter password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <EyeToggle shown={showConfirm} onToggle={() => setShowConfirm(p => !p)} />
              </div>
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

      {/* The exit. Browsing is the default state, so this is not "guest
          entry" — the scene was never locked. It reuses the old guest-entry
          styles because the visual slot is the same; only the meaning
          changed: leave the interruption, keep browsing. */}
      <div className={s.artistEntry}>
        <p>Just browsing? The scene is open. No account needed.</p>
        <button className={s.btnEntry} data-testid="keep-browsing-btn" onClick={leave}>
          ← KEEP BROWSING
        </button>
      </div>
    </div>
    </>
  );
}

/**
 * The reveal control for a masked field.
 *
 * Extracted the moment there were two of them. The password and confirm
 * fields must offer the SAME affordance — two eyes drawn differently, or one
 * field having one and the other not, is the shape that made people distrust
 * what they had typed in the first place.
 *
 * `tabIndex={-1}` keeps it out of the tab order: tabbing from password should
 * reach the next field, not a display toggle. `aria-label` is what a screen
 * reader gets instead, and it names the ACTION rather than the state.
 */
function EyeToggle({ shown, onToggle }) {
  return (
    <button
      type="button"
      className={s.eyeBtn}
      onClick={onToggle}
      tabIndex={-1}
      aria-label={shown ? 'Hide password' : 'Show password'}
    >
      {shown ? (
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
  );
}
