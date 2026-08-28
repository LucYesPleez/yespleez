import { supabase } from './client';
import { getFestivalContext } from './currentEvent';

/**
 * PEOPLE — Supabase implementation.
 *
 * ⭐⭐ ONE RPC, NOT A QUERY. Everything else in this folder selects from a
 * table; this calls `festival_event_people` instead, and the reason is not
 * convenience:
 *
 *   ⛔ A VOLUNTEER'S PARTICIPATION ROW NAMES NOBODY. `profile_id` is NULL for
 *     a volunteer by design — they participate as the PERSON, not an identity.
 *     Resolving the name means going `user_id` → their `punter` profile, and
 *     that is a platform rule, not a join a screen may invent.
 *   ⛔ THE ORGANISER MAY NOT ENUMERATE PROFILES BY user_id. Nothing grants it
 *     and nothing should: a festival must not learn that its volunteer is also
 *     a band and a venue. The function returns one resolved name and no more.
 *
 * ⭐ ONE ROW PER PERSON, MANY ROLES. The aggregation happens in the database
 * because it is the same fact everywhere, and because a client that grouped
 * rows itself would be one refactor away from rendering a person twice — the
 * exact thing the ratified spec forbids, since two rows makes an organiser ask
 * "have I already dealt with this person?" and they get chased twice.
 *
 * ⛔ THIS READS FACTS ONLY. Readiness is derived per participant type and is
 * its own surface; nobody ever marks a person Ready.
 */
function toModel(row) {
  return {
    // ⭐ THE PERSON is the unit, and this key is the identity the list renders
    // by. ⚠ ⛔ NOT `user_id`: it is null on an erased record, and it is shared
    // by every profile on one account — the server already resolved both cases
    // into one stable key, and re-deriving one here would undo that.
    key: row.person_key,
    // ⛔ MAY BE NULL, and that is a real answer. An erased or unclaimed person
    // has no name to show; the screen states the absence rather than inventing
    // a placeholder that would read as a real person.
    name: row.display_name ?? null,
    location: row.location ?? null,
    roles: (row.roles ?? []).map(r => ({
      participationId: r.participationId,
      type: r.participantType,
      status: r.status,
      profileId: r.profileId ?? null,
      since: r.since ?? null,
    })),
  };
}

export const peopleRepository = {
  /**
   * The roster for the event in context.
   *
   * ⚠ No event selected yet is an EMPTY ROSTER, not an error — the same rule
   * every repository here follows, so a festival with no event renders an
   * empty room rather than a crash.
   */
  async list() {
    const { current } = await getFestivalContext();
    if (!current) return [];

    const { data, error } = await supabase.rpc('festival_event_people', {
      p_event_id: current.id,
    });
    if (error) throw error;
    return (data ?? []).map(toModel);
  },
};
