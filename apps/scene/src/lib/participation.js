/**
 * THE PARTICIPATION WRITES — save-an-event and follow-a-profile, in ONE place.
 *
 * Extracted from HeartBtn / FollowHeartBtn (O2, 2026-08-12) because the
 * returnIntent executor must perform the SAME act the buttons perform, and a
 * second copy of these rows is exactly how this table has been burned before:
 * `follows_entity_type_check` silently rejecting every event row for months,
 * and one follow owning TWO rows across the entity_id/target_profile_id
 * keyspaces. Both lessons are encoded here once; the buttons and the intent
 * executor now cannot drift apart.
 *
 * ⚠ SUPABASE RETURNS ERRORS, IT DOES NOT THROW THEM. Every function returns
 * `{ error }` and the caller decides what the UI may claim. On success the
 * session cache (likedEvents / followedProfiles) is updated HERE, so any
 * heart that mounts afterwards reads the truth without a round trip.
 *
 * ⚠ THE ROW SHAPES ARE LOAD-BEARING — see FollowHeartBtn's docblock for the
 * two-keyspace history. entity_id carries the LEGACY join key
 * (user_id ?? profile id), target_profile_id the canonical one (M5.1 D6),
 * from_profile_id the follower's personal profile (M6 R6.1). Deletes span
 * BOTH keyspaces or a legacy row survives and refills the heart on mount.
 */

import { supabase } from './supabase';
import { getPersonalProfileId } from './actingProfile';
import { track, EVENTS } from './analytics';
import { likedEvents } from './likedEvents';
import { followedProfiles } from './followedProfiles';

/** Save an event to the visitor's scene. `event` needs `{ id, name }`. */
export async function saveEvent(userId, event) {
  // M6 (R6.1): stamp attribution at write time — personal act (§A6/§A9).
  const fromProfileId = await getPersonalProfileId(userId);
  const { error } = await supabase.from('follows').insert({
    user_id: userId, from_profile_id: fromProfileId,
    entity_id: event.id, entity_type: 'event', entity_name: event.name,
  });
  if (!error) {
    track(EVENTS.FOLLOWED, { entity_type: 'event' });
    likedEvents.add(event.id);
  }
  return { error };
}

export async function unsaveEvent(userId, eventId) {
  const { error } = await supabase.from('follows').delete()
    .eq('user_id', userId).eq('entity_id', eventId);
  if (!error) likedEvents.delete(eventId);
  return { error };
}

/** Follow a profile. `profile` needs `{ id, user_id, type, name }`. */
export async function followProfile(userId, profile) {
  const fromProfileId = await getPersonalProfileId(userId);
  const { error } = await supabase.from('follows').insert({
    user_id: userId, from_profile_id: fromProfileId,
    entity_id: profile.user_id ?? profile.id,
    entity_type: profile.type, entity_name: profile.name,
    target_profile_id: profile.id,
  });
  if (!error) {
    track(EVENTS.FOLLOWED, { entity_type: profile.type });
    followedProfiles.add(profile.id);
  }
  return { error };
}

export async function unfollowProfile(userId, profile) {
  const legacyId = profile.user_id ?? profile.id;
  // Both keyspaces, for the same reason the heart's read spans both.
  const { error } = await supabase.from('follows').delete()
    .eq('user_id', userId)
    .or(`target_profile_id.eq.${profile.id},entity_id.eq.${legacyId}`);
  if (!error) followedProfiles.delete(profile.id);
  return { error };
}
