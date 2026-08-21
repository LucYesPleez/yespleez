/**
 * SAVED QR CODES — the library, and the entities a generator may point at.
 *
 * ⛔ THE DESTINATION MODEL IS NOT HERE. `lib/qrDestinations.js` owns what a QR
 * can open and how its address is built, and it deliberately never touches the
 * database — so a scan resolves with no query and a deleted library row cannot
 * break a printed poster. This file is the two things that DO need the network:
 *
 *   · the saved library      (list, save, archive)
 *   · the entity pickers     (which events / profiles you may point at)
 *
 * ── ⭐ SAVING IS IDEMPOTENT, BY DESIGN ──────────────────────────────────
 *
 * "The same QR should be reusable. Do not force users to create a new one every
 * time." `saveQrCode` upserts onto the partial unique index QR1 creates, so
 * pressing SAVE twice on the same destination returns the SAME row rather than
 * filling the library with duplicates of one poster.
 *
 * ── ⚠ EVERY WRITE NAMES ITS PROFILE ────────────────────────────────────
 *
 * `owner_profile_id` is attribution stamped at write time, and RLS re-checks it
 * with `can_act_as()`. ⛔ Never infer it from the active profile (that is UX
 * state and a hint, identity v1.1 R2) — the caller passes the profile whose
 * dashboard the user is standing on.
 */

import { supabase } from './supabase';
import { DESTINATIONS, SUBJECT } from './qrDestinations';
import { ownedByFilter } from './eventOwnership';

/* ── the library ─────────────────────────────────────────────────────────── */

/**
 * Every saved QR for a set of profiles, newest first.
 *
 * @param {string[]} profileIds  the profiles whose dashboards this account holds
 * @param {object}   [opts]      { includeArchived }
 */
export async function listQrCodes(profileIds, { includeArchived = false, db = supabase } = {}) {
  if (!profileIds?.length) return [];
  let q = db.from('qr_codes')
    .select('id, owner_profile_id, destination_type, destination_id, label, status, created_at')
    .in('owner_profile_id', profileIds)
    .order('created_at', { ascending: false });
  if (!includeArchived) q = q.eq('status', 'active');

  const { data, error } = await q;
  if (error) {
    console.error('[qrCodes] list failed', error);
    return [];
  }
  return data ?? [];
}

/**
 * Save a destination to the library, or return the row that already holds it.
 *
 * @returns {{ok: true, row: object, reused: boolean} | {ok: false, error: string}}
 */
export async function saveQrCode({
  ownerProfileId, destinationType, destinationId, label, userId,
}, db = supabase) {
  if (!ownerProfileId) return { ok: false, error: 'No profile to save this under.' };
  if (!DESTINATIONS[destinationType]) return { ok: false, error: 'Unknown destination type.' };
  if (!destinationId) return { ok: false, error: 'No destination chosen.' };

  const existing = await db.from('qr_codes')
    .select('id, owner_profile_id, destination_type, destination_id, label, status, created_at')
    .eq('owner_profile_id', ownerProfileId)
    .eq('destination_type', destinationType)
    .eq('destination_id', destinationId)
    .eq('status', 'active')
    .maybeSingle();

  if (existing.data) {
    /* ⭐ Already saved. The label is refreshed because a venue may have been
       renamed since — but the ROW is the same one, so a user who saved this
       poster in June still has one entry for it in August. */
    if (label && label !== existing.data.label) {
      await db.from('qr_codes')
        .update({ label, updated_at: new Date().toISOString() })
        .eq('id', existing.data.id);
    }
    return { ok: true, row: { ...existing.data, label: label || existing.data.label }, reused: true };
  }

  const { data, error } = await db.from('qr_codes')
    .insert({
      owner_profile_id: ownerProfileId,
      created_by_user_id: userId ?? null,
      destination_type: destinationType,
      destination_id: destinationId,
      label: label ?? null,
    })
    .select('id, owner_profile_id, destination_type, destination_id, label, status, created_at')
    .single();

  if (error) {
    console.error('[qrCodes] save failed', error);
    return { ok: false, error: error.message };
  }
  return { ok: true, row: data, reused: false };
}

/**
 * Retire a saved QR.
 *
 * ⛔ ARCHIVE, NEVER DELETE, and the reason is physical: the code may be on a
 * hundred flyers. Removing the record does not un-print them, and the owner
 * still needs to know that artefact exists and where it points. Same choice
 * notification dismissal made, for the same reason.
 */
export async function archiveQrCode(id, db = supabase) {
  const { error } = await db.from('qr_codes')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error('[qrCodes] archive failed', error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Put an archived one back. */
export async function restoreQrCode(id, db = supabase) {
  const { error } = await db.from('qr_codes')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ── what you may point at ───────────────────────────────────────────────── */

/**
 * Events this account may make a QR for.
 *
 * ⭐⭐ THE SAME QUESTION THE EVENT PAGE AND THE HOST DASHBOARD ASK, through the
 * same filter. `ownedByFilter` carries BOTH arms — `owner_profile_id` and the
 * legacy `host_id` — because `host_id` is NULL on 82 of 92 events and an
 * owner-only filter would show a venue almost nothing while looking correct.
 * ⛔ Do not write a third version of this query.
 */
export async function selectableEvents({ userId, profileIds = [] }, db = supabase) {
  const arms = [];
  for (const pid of profileIds) arms.push(`owner_profile_id.eq.${pid}`);
  if (userId) arms.push(`host_id.eq.${userId}`);
  // The venue's own nights: events held AT a venue this account owns, which the
  // ownership filter alone does not cover for imported rows.
  for (const pid of profileIds) arms.push(`venue_profile_id.eq.${pid}`);
  if (!arms.length) return [];

  const { data, error } = await db.from('events')
    .select('id, name, config, status, owner_profile_id, host_id, venue_profile_id')
    .or(arms.join(','))
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[qrCodes] event lookup failed', error);
    return [];
  }
  return data ?? [];
}

/** Kept alongside `selectableEvents` so the two definitions cannot drift. */
export { ownedByFilter };

/**
 * Profiles this account may point a QR at, for one destination type.
 *
 *   venue / whats-on   profiles you own, of the types that destination accepts
 *   artist             your own performer profiles, PLUS every act booked onto
 *                      one of your events
 *
 * ⭐ The second arm is what makes an Artist QR useful to a venue: the poster for
 * Friday wants the act's profile on it. Booking somebody is a legitimate basis
 * for printing their PUBLIC address, and it is a narrower rule than "any
 * profile", which would turn the generator into a directory of strangers.
 */
export async function selectableProfiles(
  destinationType, { ownedProfiles = [], eventIds = [] }, db = supabase,
) {
  const dest = DESTINATIONS[destinationType];
  if (!dest || dest.subject !== SUBJECT.PROFILE) return [];

  const mine = ownedProfiles.filter(p => dest.profileTypes.includes(p.type));
  if (destinationType !== 'artist') return mine;

  if (!eventIds.length) return mine;

  const { data: members, error } = await db.from('lineup_members')
    .select('artist_profile_id')
    .in('event_id', eventIds)
    .not('artist_profile_id', 'is', null)
    .limit(500);

  if (error) {
    console.error('[qrCodes] booked artist lookup failed', error);
    return mine;
  }

  const ids = [...new Set(members.map(m => m.artist_profile_id))]
    .filter(id => !mine.some(p => p.id === id));
  if (!ids.length) return mine;

  const { data: profiles, error: pErr } = await db.from('profiles')
    .select('id, name, type')
    .in('id', ids)
    .in('type', dest.profileTypes);

  if (pErr) {
    console.error('[qrCodes] booked artist profiles failed', pErr);
    return mine;
  }
  return dedupeById([...mine, ...(profiles ?? [])]);
}

/**
 * ⛔ KEYED ON `profile.id`, NEVER `user_id`. A multi-profile account shares one
 * `user_id` across its profiles and 99 of 161 profiles have none at all, so
 * de-duplicating on it would collapse distinct acts into one row.
 */
function dedupeById(list) {
  const seen = new Set();
  return list.filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

/**
 * The display name for a saved row, live where possible and the cached label
 * otherwise.
 *
 * ⚠ RENDERING CONTRACT. Three states, three different answers, and ⛔ never a
 * blank: a destination that is gone says so, because the user may have it
 * printed and needs to know it is dead. An unresolved one is not claimed to be
 * missing — it is simply not loaded yet.
 */
export function qrDisplayName(row, resolved) {
  if (resolved === undefined) return { name: row.label || 'Loading', state: 'unknown' };
  if (resolved === null) return { name: row.label || 'Deleted destination', state: 'missing' };
  return { name: resolved.name || row.label || 'Untitled', state: 'live' };
}
