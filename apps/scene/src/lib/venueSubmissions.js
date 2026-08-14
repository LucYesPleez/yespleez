import { supabase } from './supabase';

/**
 * VENUE SUBMISSIONS — asking for a place to become a canonical YesPleez venue.
 *
 * Same one-write-path discipline as profileClaimRequest.js and sendMessage:
 * CreateEventScreen calls `submitVenueRequest`; MyVenueSubmissions calls
 * `listMyVenueSubmissions`; nothing else touches `venue_submissions`.
 *
 * ── WHY THIS IS A TABLE AND NOT A FLAG ───────────────────────────────
 *
 * The request itself already lives on the event as `config.venueRequest`, and
 * that is the ORGANISER'S OWN RECORD — Studio never writes it. But a moderation
 * RESULT cannot live there: `eventEditorModel.toConfig()` rebuilds
 * `venueRequest` from the form on every save, so a decision written into
 * `config` would be silently erased the next time the organiser edited their
 * own event. A submission needs a lifecycle the organiser's keystrokes cannot
 * overwrite, so it gets a row.
 *
 * That split is the whole model, and each part answers a different question:
 *
 *   config.venue / suburb / state    WHERE the night actually is (organiser's)
 *   venue_submissions                may this place join the CATALOGUE?
 *   events.venue_profile_id          the canonical link, set only on confirm
 *
 * ⛔ A DECLINE CHANGES NOTHING ABOUT THE EVENT. The night keeps its own
 * location and stays valid; all that was refused is catalogue membership.
 *
 * ── WHAT SUBMITTING DOES NOT DO ──────────────────────────────────────
 *
 * It does not create a venue. It cannot: `profiles`' only INSERT policy is
 * `WITH CHECK (auth.uid() = user_id)` and a claimable venue is unclaimed
 * (`user_id NULL`), so the check evaluates to NULL and rejects. Confirmation
 * runs through `confirm_venue_submission` / `confirm_venue_submission_new`,
 * whose EXECUTE is revoked from anon and authenticated — Studio calls them
 * under the service role. This module keeps that true by construction.
 *
 * ⚠ THE INSERT USES .select(), like profileClaimRequest and unlike analytics:
 * the table HAS a select-own policy precisely so the submitter can read their
 * own status back (INSERT ... RETURNING is governed by the SELECT policy — the
 * beta_feedback lesson). If this starts failing with an RLS error, check that
 * policy before touching this code.
 */

export const SUBMISSION_STATUSES = ['pending', 'confirmed', 'declined'];

/** What the organiser sees for each state. ⛔ Never invent a fourth. */
export const STATUS_LABELS = {
  pending:   'Pending review',
  confirmed: 'Confirmed',
  declined:  'Declined',
};

function clean(v) {
  const s = String(v == null ? '' : v).trim();
  return s === '' ? null : s;
}

/**
 * Pull the venue a saved event is asking about, straight out of the config the
 * editor just wrote. Returns null when the event is not asking for anything.
 *
 * ⚠ Reads the SAME keys `toConfig` writes — `venue` for the name and the flat
 * `suburb` / `state` / `postcode` that eventViewModel's locality ladder reads.
 * ⛔ Do not read `venueTown` here; that is the form's field name, not the
 * stored one, and it is empty on every event in the database.
 */
export function venueRequestFromConfig(config) {
  const c = config || {};
  if (c.venueRequest !== true) return null;
  const name = clean(c.venue);
  if (!name) return null;                      // nothing to review
  return {
    name,
    address:  clean(c.address),
    suburb:   clean(c.suburb),
    state:    clean(c.state),
    postcode: clean(c.postcode),
  };
}

/**
 * Record the request, once, for an event that is asking for one.
 *
 * ⚠ NON-FATAL BY CONTRACT, and the caller must keep it that way. The event is
 * already saved by the time this runs; a failure here costs a line in a review
 * queue, not the organiser's night's work. Same discipline as the buffered
 * co-host insert in CreateEventScreen.
 *
 * Idempotent against the partial unique index
 * (`venue_submissions_one_pending_per_event WHERE status = 'pending'`): saving
 * an event five times must not queue it five times. A duplicate is a 23505 and
 * is reported as `already`, not as a failure — the row it collided with is the
 * request, still pending, which is the desired end state either way.
 *
 * ⛔ Deliberately does NOT resubmit after a decision. Once a submission is
 * confirmed or declined the partial index no longer blocks a new row, but
 * re-asking on every subsequent save would put a declined venue back in the
 * queue forever and make the decline meaningless. Asking again is a decision
 * the organiser makes, not a side effect of editing a poster.
 */
export async function submitVenueRequest({ eventId, userId, venue }) {
  if (!eventId || !userId || !venue?.name) return { ok: false, reason: 'incomplete' };

  const { data: seen, error: readErr } = await supabase
    .from('venue_submissions')
    .select('id,status')
    .eq('event_id', eventId)
    .limit(1);
  // A failed read must not become a duplicate submission — the index would
  // catch it, but reporting `failed` here is honest and costs nothing.
  if (readErr) return { ok: false, reason: 'failed' };
  if (seen && seen.length) return { ok: true, reason: 'already', status: seen[0].status };

  const { data, error } = await supabase
    .from('venue_submissions')
    .insert({
      event_id: eventId,
      submitted_by: userId,
      name: venue.name,
      address: venue.address,
      suburb: venue.suburb,
      state: venue.state,
      postcode: venue.postcode,
    })
    .select('id,status')
    .single();

  if (error) {
    if (error.code === '23505') return { ok: true, reason: 'already' };
    return { ok: false, reason: 'failed', message: error.message };
  }
  return { ok: true, reason: 'submitted', id: data.id, status: data.status };
}

/**
 * The organiser's own submissions, newest first.
 *
 * ⚠ NO user filter in the query, ON PURPOSE. The select-own RLS policy
 * (`submitted_by = auth.uid()`) is the boundary; adding `.eq('submitted_by',…)`
 * on top would read as though the client were enforcing it, and a reader would
 * not know which of the two was load-bearing. Signed out, this returns nothing
 * rather than erroring.
 *
 * The joined event name is what makes the list legible — "Hoey Moey" alone
 * does not tell an organiser which night they asked from.
 */
export async function listMyVenueSubmissions() {
  const { data, error } = await supabase
    .from('venue_submissions')
    .select('id,created_at,status,name,suburb,state,decided_at,decision_note,venue_profile_id,event_id')
    .order('created_at', { ascending: false });
  if (error) return { ok: false, rows: [], message: error.message };
  return { ok: true, rows: data || [] };
}
