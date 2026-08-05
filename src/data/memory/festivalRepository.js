import { FESTIVAL } from '../../config/navigation';
import { settle } from './latency';

/**
 * FESTIVAL — in-memory implementation.
 *
 * ⚠ When this becomes real, a festival is a PROFILE (`profiles.type =
 * 'festival'`) in the shared profile system, not a row in a festival-only
 * table. That is ratified, and it is what makes a festival followable,
 * messageable and claimable for free.
 *
 * So this repository will eventually read the profile system, and the fact
 * that it currently reads a constant must not tempt anyone into inventing a
 * `festivals` table with its own name and avatar columns.
 */
export const festivalRepository = {
  async getCurrent() {
    return settle({
      id: FESTIVAL.id,
      name: FESTIVAL.name,
      tagline: null,
      description: null,
      startsOn: '2027-01-16',
      endsOn: '2027-01-19',
      location: FESTIVAL.location,
      website: null,
      applicationsOpen: FESTIVAL.applicationsOpen,
    });
  },

  /** Editions exist from day one; the UI only reveals them at the second. */
  async listEditions() {
    return settle([
      { id: 'ed_2027', name: 'Northern Skies Festival 2027', year: 2027, status: 'open' },
    ]);
  },
};
