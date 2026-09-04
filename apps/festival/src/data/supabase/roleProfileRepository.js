import { supabase } from './client';
import { VOLUNTEER_ROLE_KEY } from '../../lib/volunteerRoleProfile';

/**
 * A PERSON'S OWN LAYERS — the two tables that belong to the human rather than
 * to the festival.
 *
 * ⭐ Everything else in `data/supabase/` reads the ORGANISER's world: this
 * festival, this event, these applications. This module is the exception, and
 * the exception is the point — a role profile is written by the person it
 * describes, is reused at every festival they ever apply to, and no organiser
 * may edit it.
 *
 * ⛔⛔ NO USER ID IS EVER ACCEPTED AS AN ARGUMENT. `person_private` is keyed by
 * `auth.users.id`, and a function taking one would invite a caller to pass
 * somebody else's — a request RLS would refuse, but only after the UI had
 * already been written as though it would work. The session is read here, once,
 * and never handed in.
 */

/** The signed-in account, or null. */
async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

export const roleProfileRepository = {
  /**
   * ⭐⭐ WHICH PROFILE IS "THE PERSON"? The `punter` one.
   *
   * An account holds several profiles — the owner's holds seven — so
   * `user_id` alone cannot name a human ([[project_user_id_is_not_an_identity]]).
   * Registration creates exactly one punter and it is inalienable, which makes
   * it the one profile that always means "me".
   *
   * ⛔ IT IS NEVER CREATED HERE. A punter profile is system-generated; an app
   * that manufactures a missing one would be minting identity to get past an
   * empty screen. Returning null is the honest answer, and the editor says so.
   *
   * ⚠ Ordered and limited rather than `.maybeSingle()`. If an account somehow
   * holds two, single() throws and the screen dies; taking the oldest settles
   * on one deterministically and keeps the profile editable.
   */
  async getPersonProfile() {
    const userId = await currentUserId();
    if (!userId) return null;
    const { data, error } = await supabase
      .from('profiles')
      // ⚠ Named columns, never `select('*')`. Anon and column grants have been
      // narrowed on this table more than once, and a star select ERRORS rather
      // than degrading when a column goes away.
      .select('id, name, avatar, location, state, contact_email, emergency_name, emergency_phone, age')
      .eq('user_id', userId)
      .eq('type', 'punter')
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) throw error;
    return data?.[0] ?? null;
  },

  /**
   * The private person layer for the signed-in account.
   *
   * Returns an empty shape rather than null when there is no row: "nobody has
   * filled this in yet" and "this account has no private record" are the same
   * state to every caller, and two shapes would mean every caller branching.
   */
  async getPersonPrivate() {
    const userId = await currentUserId();
    if (!userId) return null;
    const { data, error } = await supabase
      .from('person_private')
      .select('user_id, dob, street_address')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ?? { user_id: userId, dob: null, street_address: null };
  },

  /**
   * ⚠ AN EMPTY FIELD IS WRITTEN AS NULL, not skipped. Clearing a date of birth
   * has to be possible — somebody who typed the wrong one must be able to take
   * it back out, and a save that only ever adds would leave them stuck with it.
   */
  async savePersonPrivate({ dob, streetAddress } = {}) {
    const userId = await currentUserId();
    if (!userId) throw new Error('Sign in to save your details.');
    const { error } = await supabase
      .from('person_private')
      .upsert({
        user_id: userId,
        dob: dob || null,
        street_address: (streetAddress || '').trim() || null,
      }, { onConflict: 'user_id' });
    if (error) throw error;
  },

  /**
   * A role profile for one profile id.
   *
   * ⭐ `.maybeSingle()` is safe here, and that is a fact about the DATABASE
   * rather than an assumption: `festival_role_profiles_one_per_role` is a
   * UNIQUE constraint on `(profile_id, role_key)` (verified against the live
   * catalogue, 2026-09-04). Two rows cannot exist, so there is nothing to
   * disambiguate and no reason to order-and-take-first.
   */
  async getRoleProfile(profileId, roleKey = VOLUNTEER_ROLE_KEY) {
    if (!profileId) return null;
    const { data, error } = await supabase
      .from('festival_role_profiles')
      .select('id, profile_id, role_key, data, updated_at')
      .eq('profile_id', profileId)
      .eq('role_key', roleKey)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },

  /**
   * ⭐ ONE ROUND TRIP, and the conflict target is a constraint that provably
   * exists. A read-then-write has a window in which two saves both see no row
   * and both insert; the second would fail on the unique constraint and lose
   * the person's edit with an error they cannot act on.
   *
   * ⛔ `updated_at` IS NOT SENT. `festival_role_profiles_updated_at` is a
   * BEFORE UPDATE trigger running `touch_updated_at()`, so a client value would
   * be overwritten anyway — and a client clock deciding a database timestamp is
   * how two rows end up disagreeing about which is newer.
   */
  async saveRoleProfile(profileId, data, roleKey = VOLUNTEER_ROLE_KEY) {
    if (!profileId) throw new Error('No personal profile to attach this to.');
    const { error } = await supabase
      .from('festival_role_profiles')
      .upsert(
        { profile_id: profileId, role_key: roleKey, data },
        { onConflict: 'profile_id,role_key' },
      );
    if (error) throw error;
  },
};
