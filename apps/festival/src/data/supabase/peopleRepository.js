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

  /**
   * Find a registered person to add.
   *
   * ⛔⛔ A FESTIVAL PARTICIPANT IS A REGISTERED YESPLEEZ USER — ratified by the
   * owner 2026-08-29. There is no name-only person, so this search is the ONLY
   * way into the roster besides an accepted application. Someone who is not
   * registered registers first.
   *
   * ⚠⚠ IT SELECTS NO `user_id`, DELIBERATELY. `profiles.user_id` is currently
   * readable by anon, which lets anyone correlate every identity behind one
   * account — reported 2026-08-29 and not yet closed. ⛔ Do not build on that
   * exposure: the account is resolved server-side by `add_event_participant`,
   * and this app never holds one.
   *
   * ⚠ An UNCLAIMED profile cannot be filtered out here for the same reason —
   * telling claimed from unclaimed needs `user_id`. So it can be offered and
   * then refused by name at the point of adding. ⭐ That is the honest order:
   * the refusal states what to do, rather than the row silently not appearing
   * and leaving the organiser hunting for a person they can see exists.
   */
  async search(query) {
    const q = (query ?? '').trim();
    // ⛔ An empty search is NOT "everyone". A roster search that lists the whole
    // platform by default invites adding the first plausible name.
    if (q.length < 2) return [];

    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, type, location')
      .ilike('name', `%${q}%`)
      .order('name')
      .limit(12);
    if (error) throw error;
    return (data ?? []).map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      location: r.location ?? null,
    }));
  },

  /**
   * ⭐ The organiser picks a PROFILE and a ROLE; the server resolves the
   * account. ⛔ Idempotent by (event, person, type) — adding twice must not
   * produce two rows, which is exactly how someone gets chased twice.
   */
  async add({ profileId, participantType }) {
    const { current } = await getFestivalContext();
    if (!current) throw new Error('No event selected');

    const { data, error } = await supabase.rpc('add_event_participant', {
      p_event_id: current.id,
      p_profile_id: profileId,
      p_participant_type: participantType,
    });
    if (error) throw error;
    return data;
  },
};
