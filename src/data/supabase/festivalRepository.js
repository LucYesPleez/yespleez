import { supabase } from './client';
import { getFestivalContext } from './currentEdition';

/**
 * FESTIVAL — Supabase implementation.
 *
 * ⭐ A festival is a PROFILE (`profiles.type = 'festival'`), not a row in a
 * festival-only table. That is what makes it followable, messageable and
 * claimable for free, and it is why there is no `festivals` table to read.
 *
 * Dates live on the EDITION, not the profile: a festival's identity outlives
 * any one year of it.
 */
export const festivalRepository = {
  async getCurrent() {
    const { profile, current } = await getFestivalContext();

    // applicationsOpen is DERIVED — a festival is open because a category is,
    // never because a flag somewhere says so. One place to be wrong is better
    // than two places to disagree.
    const { count, error } = await supabase
      .from('festival_categories')
      .select('id', { count: 'exact', head: true })
      .eq('edition_id', current.id)
      .eq('state', 'open');
    if (error) throw error;

    return {
      id: profile.id,
      name: profile.name,
      tagline: profile.tagline ?? null,
      description: profile.bio ?? null,
      startsOn: current.starts_on ?? null,
      endsOn: current.ends_on ?? null,
      location: current.location ?? profile.location ?? null,
      website: profile.website ?? null,
      applicationsOpen: (count ?? 0) > 0,
    };
  },

  async listEditions() {
    const { editions } = await getFestivalContext();
    return editions.map(e => ({
      id: e.id,
      name: e.name,
      year: e.year,
      status: e.status,
    }));
  },
};
