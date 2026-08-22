/**
 * THE RECOVERY LINK ARRIVES IN THE HASH, AND SO DOES OUR ROUTER.
 *
 * Supabase's password-reset email lands on
 * `https://yespleez.com/#access_token=…&refresh_token=…&type=recovery`.
 * This app uses HashRouter, so react-router reads that same hash as the ROUTE,
 * matches nothing, and renders an empty shell — which, signed out, is the
 * login page. Owner relayed it 2026-08-22 from a beta tester: "I just tried to
 * reset my password … it just redirects me to the normal login page." He was
 * describing the code working exactly as written.
 *
 * ⛔ DO NOT LEAVE THIS TO `detectSessionInUrl`. The client reads
 * `window.location.href` inside its own async `initialize()`, so whether the
 * token is still there depends on a race with the router. We take the tokens
 * OURSELVES, synchronously, before anything else runs, and hand them to
 * ResetPasswordScreen to apply with `setSession`. The hash is then rewritten
 * to a real route, so by the time the client looks there is nothing to detect
 * and nothing to race over.
 *
 * ⚠ THIS MODULE MUST BE THE FIRST IMPORT IN main.jsx. ES imports evaluate in
 * order, before the importing module's body — that ordering is the mechanism,
 * not a coincidence. Moving it down the list breaks the reset silently, and a
 * silent break here looks identical to the bug it fixed.
 *
 * ⛔ It reads the URL only. It creates no client, touches no storage, and
 * signs nobody in — see feedback_never_create_a_second_supabase_client.
 */

export const RESET_ROUTE = '/reset-password';

/**
 * What we found in the URL, decided once at load:
 *
 *   { tokens: { access_token, refresh_token } }  a live recovery link
 *   { error: 'human sentence' }                  an expired or refused link
 *   null                                         an ordinary page load
 *
 * ⭐ The EXPIRED case is a real answer, not an absence. GoTrue redirects a dead
 * link with `error=access_denied&error_code=otp_expired`, and a person who
 * clicked a stale email deserves to be told that rather than being dropped at
 * a login form to guess.
 */
function captureRecovery() {
  if (typeof window === 'undefined') return null;

  const raw = window.location.hash || '';
  if (!raw.startsWith('#') || raw.startsWith('#/')) return null;

  let params;
  try {
    params = new URLSearchParams(raw.slice(1));
  } catch {
    return null;
  }

  const type         = params.get('type');
  const accessToken  = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const errorCode    = params.get('error_code') || params.get('error');

  const isRecovery = type === 'recovery' || (errorCode && params.has('error_description'));
  if (!isRecovery) return null;

  // The token is out of the URL either way. It is a credential; it does not
  // belong in the address bar, in history, or in a screenshot of either.
  window.location.replace(`${window.location.pathname}${window.location.search}#${RESET_ROUTE}`);

  if (accessToken && refreshToken) {
    return { tokens: { access_token: accessToken, refresh_token: refreshToken } };
  }

  return {
    error: errorCode === 'otp_expired'
      ? 'That reset link has expired. Reset links last one hour, so ask for a new one.'
      : 'That reset link is no longer valid. Ask for a new one and use the newest email.',
  };
}

export const recoveryFromUrl = captureRecovery();
