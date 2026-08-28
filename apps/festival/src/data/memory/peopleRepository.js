import { settle } from './latency';

/**
 * PEOPLE — in-memory implementation.
 *
 * ⚠⚠ THE FIXTURE'S JOB IS TO BE AWKWARD, NOT TIDY. The applications table's
 * in-memory repository is what hid four broken columns for months, because it
 * invented a convenient shape instead of the one the database actually
 * returns. So this one carries, on purpose, every case that has already gone
 * wrong or plausibly can:
 *
 *   · a person holding TWO roles — the reason People is one row per person
 *   · a volunteer whose `profileId` is NULL, which is the normal case, not an
 *     edge case
 *   · a person with NO NAME, standing for an erased or unclaimed account, so
 *     the screen's honest-absence rendering is exercised rather than assumed
 *   · a withdrawal, which must read as ordinary rather than as a failure
 *
 * ⭐ Shape parity with the Supabase implementation is the whole contract: the
 * screen must not be able to tell which one it is talking to.
 */
const PEOPLE = [
  {
    key: 'u:00000000-0000-0000-0000-000000000001',
    name: 'Lucious',
    location: 'Bellingen',
    roles: [
      { participationId: 'p1', type: 'artist',    status: 'accepted',  profileId: 'pr1', since: '2026-08-28T11:58:00Z' },
      { participationId: 'p2', type: 'volunteer', status: 'confirmed', profileId: null,  since: '2026-08-28T12:03:00Z' },
    ],
  },
  {
    key: 'u:00000000-0000-0000-0000-000000000002',
    name: 'Marla Dunn',
    location: null,
    roles: [
      { participationId: 'p3', type: 'volunteer', status: 'withdrawn', profileId: null, since: '2026-08-20T09:00:00Z' },
    ],
  },
  {
    // ⛔ NAMELESS ON PURPOSE. An erased account severs the person from the
    // record without deleting it, and the roster must still be readable.
    key: 'p:00000000-0000-0000-0000-000000000003',
    name: null,
    location: null,
    roles: [
      { participationId: 'p4', type: 'volunteer', status: 'accepted', profileId: null, since: '2026-08-19T09:00:00Z' },
    ],
  },
];

/**
 * ⚠ THE SEARCHABLE SET INCLUDES AN UNCLAIMED PROFILE, on purpose. `Zeganjah`
 * has no account behind it, and the Supabase implementation cannot filter those
 * out — telling claimed from unclaimed needs `user_id`, which this app
 * deliberately never reads. So the refusal happens at ADD time, and the fixture
 * must be able to produce it or that path is never exercised.
 */
const SEARCHABLE = [
  { id: 'pr1', name: 'Lucious',  type: 'artist', location: 'Bellingen', claimed: true },
  { id: 'pr9', name: 'Luc',      type: 'punter', location: null,        claimed: true },
  { id: 'pr7', name: 'Zeganjah', type: 'artist', location: null,        claimed: false },
];

export const peopleRepository = {
  async list() {
    return settle(PEOPLE);
  },

  async search(query) {
    const q = (query ?? '').trim().toLowerCase();
    // ⛔ An empty search is not "everyone" — same rule as the real one.
    if (q.length < 2) return settle([]);
    return settle(
      SEARCHABLE
        .filter(p => p.name.toLowerCase().includes(q))
        // eslint-disable-next-line no-unused-vars -- `claimed` is stripped on purpose: the real search cannot see it either
        .map(({ claimed: _claimed, ...rest }) => rest),
    );
  },

  async add({ profileId }) {
    const profile = SEARCHABLE.find(p => p.id === profileId);
    // ⭐ The SAME sentence the database raises. A fixture that fails with
    // different words trains the UI against an error it will never see.
    if (profile && !profile.claimed) {
      throw new Error('add_event_participant: that profile is not claimed by a registered account yet');
    }
    return settle('new-participation-id');
  },
};
