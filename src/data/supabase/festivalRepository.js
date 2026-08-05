import { supabase } from './client';
import { getFestivalContext } from './currentEvent';

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
  async getCurrent() {
    const { profile, current } = await getFestivalContext();

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
