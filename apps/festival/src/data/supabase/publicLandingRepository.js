import { supabase } from './client';

/**
 * THE PUBLIC LANDING PAGE'S READS — anonymous by design.
 *
 * ⭐ Everything here must work with NO session. The page is the festival's
 * front door: it is linked from posters and the festival's own website, and
 * the person arriving has no account yet. Every table below is anon-readable
 * under RLS (`festival_categories` / `festival_event_settings` /
 * `festival_departments` are `USING (true)`; `events` is live-only for anon;
 * `profiles` is readable by everyone).
 *
 * ⚠ THE HIDDEN PRECONDITION: anon sees an event only when `status = 'live'`.
 * The signed-in organiser sees their own drafts, so this page can look
 * perfect to the owner and 404 for the world. Verify signed OUT, always.
 *
 * ⛔ `profiles` is fully anon-readable, every column — so this file selects
 * EXPLICIT columns and must never grow a `select('*')`. A public surface that
 * pulls whole profile rows ships emails and phone numbers to every visitor.
 *
 * ⛔ `events.config` is selected but passed through OPAQUELY — this app does
 * not interpret the blob (see currentEvent.js). The landing screen hands it
 * to `@yespleez/event-presentation`, the one shared reader of media keys.
 *
 * ⛔ This repository WRITES NOTHING. Applying happens in Scene
 * (`festival_applications`, one table, one public apply surface — owner's
 * ruling 2026-08-06, upheld by the 2026-08-26 landing-page decision).
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const publicLandingRepository = {
  /**
   * Everything the landing page renders, in one call.
   *
   * @returns {Promise<
   *   | { found: false }
   *   | { found: true, event, profile, settings, categories, departments }
   * >} `found: false` covers all three honest misses the same way: no such
   *    event, an event anon cannot see (draft), and an event whose owner is
   *    not a festival. The page cannot tell them apart and must not guess.
   */
  async getLanding(eventId) {
    // The id is user input from the URL. A malformed one can only ever 400
    // (22P02) at PostgREST, so it is answered here without a network call.
    if (!eventId || !UUID_SHAPE.test(eventId)) return { found: false };

    // ⚠ .maybeSingle() + an error guard, not .single(): even a well-shaped id
    // that matches nothing is still "not found" to a visitor, never a crash.
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, name, applications_open, owner_profile_id, lat, lng, config')
      .eq('id', eventId)
      .maybeSingle();
    if (eventError || !event || !event.owner_profile_id) return { found: false };

    // The owner must BE a festival. Without this check any live event's id
    // renders wearing a festival landing page — a pub gig with an APPLY page
    // it never asked for.
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, name, tagline, bio, location, website, avatar, avatar_hero, avatar_thumb')
      .eq('id', event.owner_profile_id)
      .eq('type', 'festival')
      .maybeSingle();
    if (profileError || !profile) return { found: false };

    const [settingsRes, categoriesRes, departmentsRes] = await Promise.all([
      supabase
        .from('festival_event_settings')
        .select('starts_on, ends_on')
        .eq('event_id', event.id)
        .maybeSingle(),
      supabase
        .from('festival_categories')
        .select('key, state, opens_at, closes_at, intent')
        .eq('event_id', event.id)
        .eq('state', 'open'),
      supabase
        .from('festival_departments')
        .select('name')
        .eq('event_id', event.id)
        .eq('archived', false)
        .order('sort_order'),
    ]);

    return {
      found: true,
      event,
      profile,
      // Secondary reads degrade to empty rather than sinking the page: a
      // festival with no settings row simply has no dates yet, and that is a
      // state the page already renders honestly.
      settings: settingsRes.error ? null : settingsRes.data,
      categories: categoriesRes.error ? [] : (categoriesRes.data ?? []),
      departments: departmentsRes.error ? [] : (departmentsRes.data ?? []),
    };
  },
};
