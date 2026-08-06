import { supabase } from './client';
import { getFestivalContext, resetEventCache } from './currentEvent';

/**
 * FESTIVAL — Supabase implementation.
 *
 * ⭐ A festival is a PROFILE (`profiles.type = 'festival'`), not a row in a
 * festival-only table. That is what makes it followable, messageable and
 * claimable for free, and it is why there is no `festivals` table to read.
 *
 * ⭐ The round it is running is an EVENT — the platform's own `events` row,
 * owned by the festival profile. Identity outlives any one year of it.
 */
export const festivalRepository = {
  /**
   * Whether this account owns a festival at all — the onboarding question.
   * Returns null rather than throwing: a brand-new organiser is a state, and
   * the gate that calls this renders "create your festival" in answer.
   */
  async getProfileOrNull() {
    const { profile } = await getFestivalContext();
    return profile;
  },

  /**
   * ⭐ THE FRONT DOOR. Creates the festival profile for a signed-in account —
   * the step that was SQL-only, which meant no organiser on earth could start
   * without someone hand-inserting a row for them.
   *
   * Same evidence rule as updateProfile: the returned row is the proof. An
   * INSERT no policy permits errors, but belt and braces costs one check.
   */
  async createProfile({ name, location }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in');
    const { data, error } = await supabase
      .from('profiles')
      .insert({ user_id: user.id, type: 'festival', name, location: location || null, is_live: true })
      .select('id')
      .single();
    if (error) {
      // The one constraint a person can hit honestly: one festival per account.
      if (error.code === '23505') {
        throw new Error('This account already has a festival profile.');
      }
      throw error;
    }
    resetEventCache();
    return data.id;
  },

  async getCurrent() {
    const { profile, current } = await getFestivalContext();
    if (!profile) return null;

    // ⭐ A festival with no events yet is real and renders — eventId null,
    // applications closed. Every event-scoped card checks eventId already.
    if (!current) {
      return {
        id: profile.id,
        eventId: null,
        name: profile.name,
        tagline: profile.tagline ?? null,
        description: profile.bio ?? null,
        startsOn: null,
        endsOn: null,
        location: profile.location ?? null,
        website: profile.website ?? null,
        applicationsOpen: false,
      };
    }

    // applicationsOpen is DERIVED from the categories, not from the event's own
    // flag: a festival is open because something is actually accepting people.
    // `events.applications_open` stays the organiser's master switch, and both
    // must be true for anyone to apply.
    const { count, error } = await supabase
      .from('festival_categories')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', current.id)
      .eq('state', 'open');
    if (error) throw error;

    return {
      id: profile.id,
      eventId: current.id,
      name: profile.name,
      tagline: profile.tagline ?? null,
      description: profile.bio ?? null,
      startsOn: null,
      endsOn: null,
      location: profile.location ?? null,
      website: profile.website ?? null,
      applicationsOpen: Boolean(current.applications_open) && (count ?? 0) > 0,
    };
  },

  /**
   * Edit the festival's own identity.
   *
   * ⭐ Writes `profiles` — the SHARED profile system, not a portal-local copy.
   * A festival is a profile like any other, so its name and bio live where
   * every other identity's do.
   *
   * ⚠ `.select()` and a row check, deliberately. An UPDATE that no RLS policy
   * permits does not error — it reports success having matched zero rows, and
   * the form says "Saved" over a database that changed nothing. Requiring a
   * returned row makes the success the evidence.
   */
  async updateProfile(patch) {
    const { profile } = await getFestivalContext();
    if (!profile) throw new Error('Create your festival profile first.');
    const { data, error } = await supabase
      .from('profiles')
      .update({
        name: patch.name,
        tagline: patch.tagline || null,
        bio: patch.bio || null,
        location: patch.location || null,
        website: patch.website || null,
      })
      .eq('id', profile.id)
      .select('id');
    if (error) throw error;
    if (!data?.length) {
      throw new Error('Not saved: this account is not permitted to edit the festival profile.');
    }
    // The cached context holds the old name — drop it so the topbar and the
    // apply page pick the new one up rather than disagreeing until reload.
    resetEventCache();
  },

  /**
   * Every round this festival has run. One today; the UI reveals the switcher
   * only at the second.
   */
  async listEvents() {
    const { events } = await getFestivalContext();
    return events.map(e => ({
      id: e.id,
      name: e.name,
      status: e.status,
      applicationsOpen: Boolean(e.applications_open),
    }));
  },
};
