/**
 * INTENT ACTIONS — what a consumed returnIntent is allowed to DO.
 *
 * ⭐⭐ THE AUTO-COMPLETE RULE (ratified 2026-08-12): an action auto-executes
 * after authentication ONLY if it is idempotent, reversible, and carries no
 * user-authored content. Saving and following qualify — a second tap undoes
 * them. ⛔ Sending a message and submitting an application NEVER qualify, and
 * their absence from AUTO_ACTIONS is deliberate and test-enforced
 * (intentActions.test.js): when those flows join the gate in a later stage,
 * their intents restore the ROUTE and reopen the UI, and a human presses
 * send. Adding either of them to this registry is an architecture change,
 * not a feature.
 *
 * ── VALIDATION IS RE-FETCHING ────────────────────────────────────────
 *
 * The stored context is ids only, so the executor re-reads the target
 * through the SAME anon/authenticated client the buttons use. That is the
 * "still valid after auth" check with no second mechanism: an event that is
 * gone (or no longer readable — RLS answers, not us) simply fails the fetch
 * and the intent completes as route-restore only. ⚠ Client intent is never a
 * security boundary; every write here lands under RLS exactly as a hand-typed
 * request would.
 *
 * ── FAILURE IS QUIET, RESTORATION IS NOT ─────────────────────────────
 *
 * Whatever execute() returns, the caller still puts the person back on
 * intent.route. The journey promise is "you end up where you were"; the save
 * completing is the bonus on top, and 23505 (already exists) counts as done —
 * the state the person asked for is the state they have.
 */

import { supabase } from './supabase';
import { saveEvent, followProfile } from './participation';
import { consumeIntent } from './returnIntent';
import { track, EVENTS } from './analytics';

export const AUTO_ACTIONS = Object.freeze({
  save_event: {
    async execute(session, ctx) {
      if (!ctx?.eventId) return { done: false, reason: 'bad-context' };
      const { data: ev } = await supabase.from('events')
        .select('id, name').eq('id', ctx.eventId).maybeSingle();
      if (!ev) return { done: false, reason: 'not-visible' };
      const { error } = await saveEvent(session.user.id, ev);
      if (error && error.code !== '23505') return { done: false, reason: error.code || 'error' };
      return { done: true };
    },
  },
  follow_profile: {
    async execute(session, ctx) {
      if (!ctx?.profileId) return { done: false, reason: 'bad-context' };
      const { data: p } = await supabase.from('profiles')
        .select('id, user_id, type, name').eq('id', ctx.profileId).maybeSingle();
      if (!p) return { done: false, reason: 'not-visible' };
      // The account that signed up mid-journey may BE this profile's owner
      // (a claimed artist signing back in) — never follow yourself.
      if (p.user_id === session.user.id) return { done: false, reason: 'self' };
      const { error } = await followProfile(session.user.id, p);
      if (error && error.code !== '23505') return { done: false, reason: error.code || 'error' };
      return { done: true };
    },
  },
});

/**
 * Consume the slot and, when the action is auto-safe, complete it.
 *
 * Returns null when there was no (valid) intent — the caller falls back to
 * its ordinary post-auth behaviour. Otherwise `{ intent, result }`, and the
 * caller navigates to intent.route regardless of result: an unknown or
 * failed action still deserves the return trip, it just doesn't get the act.
 */
export async function resumeIntent(session) {
  const intent = consumeIntent();
  if (!intent) return null;

  const handler = intent.action ? AUTO_ACTIONS[intent.action] : null;
  let result = null;
  if (handler && session?.user?.id) {
    try { result = await handler.execute(session, intent.context); }
    catch { result = { done: false, reason: 'error' }; }
  } else if (intent.action) {
    // Named but not auto-safe (or unknown): restore the route, execute
    // nothing. This branch is where message/apply intents will land when
    // later stages add them — reopening their UI is those screens' job.
    result = { done: false, reason: 'not-auto' };
  }
  // Tracked HERE, not at the call site, so a caller cannot forget it (the
  // sharing architecture's rule). The action name and outcome only — rule 3,
  // no ids.
  track(EVENTS.INTENT_RESUMED, { action: intent.action ?? null, done: result?.done ?? null });
  return { intent, result };
}
