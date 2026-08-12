/**
 * WHERE SOMEONE LANDS AFTER AUTHENTICATING — one decision, in one place.
 *
 * O3 (2026-08-12). Three outcomes, and the ORDER between them is the whole
 * point:
 *
 *   1. A returnIntent   → back to exactly where they were. ⭐⭐ THIS ALWAYS
 *                          WINS. Someone who signed up because they tapped a
 *                          heart on an event came here to save that event —
 *                          ⛔ they are NEVER interrupted by a questionnaire
 *                          (owner, ratified with O2's brief). Return them and
 *                          complete what they came to do.
 *   2. A fresh SIGNUP   → /start, the one skippable question.
 *   3. Anything else    → null: the caller falls back to history-back, which
 *                          is O1's behaviour and is right for a sign-in.
 *
 * ⚠ SIGN-IN NEVER GETS THE QUESTION. An existing account has either answered
 * it, skipped it, or predates it — and "what brings you to YesPleez?" asked of
 * someone on their fortieth visit is noise. The question belongs to the moment
 * the account is created and nowhere else, which is also why this needs no
 * "have I asked before?" record: signup happens once.
 *
 * Pure and side-effect free so the ordering above can be tested without a
 * browser, a session, or a router.
 */
export function postAuthDestination({ intentRoute = null, wasSignup = false } = {}) {
  if (intentRoute) return intentRoute;
  if (wasSignup)   return '/start';
  return null;
}
