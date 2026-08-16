// EP-00c · the one place that knows how to load an event.
//
// Extracted verbatim from EventScreen.jsx so that the public view and the host
// view can be rendered independently without either owning the query. Every
// derived value here depends ONLY on the fetched row — anything that depends on
// host editor state (localDays, allMixSlots) deliberately stays with the state
// that drives it.
//
// Note the null-tolerance: EventScreen used to compute these after its
// `if (!event) return null` early return, so they never saw a null event. A
// hook cannot return early, so each one is written to hold its shipped value
// when the event exists and a harmless empty when it does not.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { memberProfileKeys, indexMemberProfiles } from './lineupProfiles';
import { PROFILE_CARD_META_COLUMNS } from '../../components/ProfileCard';
import { groupSlotsIntoDays, indexPerformances } from '../../lib/eventSlots';
import { tallySlots } from './slotTally';

export const EVENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useEventData(id, navigate) {
  const { data, isLoading: loading } = useQuery({
    queryKey: ['event', id],
    // The query's `enabled` is `!!id`, set at the end of this object. There used
    // to be a second `enabled: isRealEvent` here — a duplicate key, silently
    // overridden by the later one (11A). Removed to make the effective condition
    // obvious. Behaviour is unchanged: for a malformed non-UUID id the queryFn's
    // `.eq('id', id)` 400s, `if (!ev)` redirects home, and the `if (!isRealEvent)`
    // branch below shows the demo notice or redirects — same as shipped.
    queryFn: async () => {
      const { data: ev } = await supabase.from('events').select('*').eq('id', id).single();
      if (!ev) { navigate('/'); return null; }
      // N2: the event owner's canonical profiles row, for action-time
      // disclosure on APPLY TO PLAY. `ev` carries owner_profile_id (authority,
      // per Phase 16) but not the row, and claim state lives on the row —
      // isProfileUnclaimed must be given the real thing, never a synthetic
      // object. Read-only and additive: nothing gates on it, so an event whose
      // owner cannot be resolved behaves exactly as it does today.
      // EP-01: `bio` and the images joined the select when Presented By began
      // rendering this row as a card. Still read-only, still nothing gates on
      // it, so an event whose owner cannot be resolved behaves as before.
      const { data: ownerProfile } = ev.owner_profile_id
        ? await supabase.from('profiles').select('id, user_id, name, type, bio, avatar, avatar_thumb, location, state').eq('id', ev.owner_profile_id).maybeSingle()
        : { data: null };
      // EP-01 · THE VENUE PROFILE, which nothing read before this.
      // `venue_profile_id` is set on 46 of 50 events, and it is the only place
      // coordinates actually live — events.lat/lng/postcode are empty on ALL
      // 50 rows, so a map or a distance built from the event alone has nothing
      // to work with. The four rows without a link fall back to config.venue.
      const { data: venueProfile } = ev.venue_profile_id
        ? await supabase.from('profiles').select('id, user_id, name, type, bio, tagline, avatar, avatar_thumb, location, suburb, state, postcode, lat, lng, accessibility, capacity').eq('id', ev.venue_profile_id).maybeSingle()
        : { data: null };
      /**
       * CO-HOSTS — additional profiles billed alongside the owner.
       *
       * ⚠ ATTRIBUTION ONLY. `owner_profile_id` remains the sole authority:
       * nothing here touches who may edit, decide applications or receive
       * notifications, and `event_hosts` carries no policy that would let it.
       * A co-host is a name on the bill, and the RLS is what makes that true
       * rather than merely intended.
       *
       * Two queries rather than an embedded join: PostgREST's `profiles(...)`
       * embed would resolve through the FK, but `event_hosts` is read under a
       * policy that joins `events`, and an embed makes the failure mode of
       * that policy silent — an empty array reads identically to "no
       * co-hosts". Fetching the ids first means an unreadable row is visible
       * as a shorter list rather than as nothing at all.
       *
       * Ordered by `position` so the organiser's billing order survives; the
       * PK is (event_id, profile_id), which does not imply an order.
       */
      const { data: coHostRows } = await supabase
        .from('event_hosts').select('profile_id, position')
        .eq('event_id', id).order('position');
      const coHostIds = (coHostRows || [])
        .map(r => r.profile_id)
        // ⚠ The OWNER is never a co-host card. A row naming the owning profile
        // would draw the same entity twice side by side — the duplication that
        // got the venue fallback deleted from § 10. Dropped here, at the seam,
        // so no renderer has to remember it.
        .filter(pid => pid && pid !== ev.owner_profile_id);
      const { data: coHostRowsFull } = coHostIds.length
        ? await supabase.from('profiles')
            .select('id, user_id, name, type, bio, avatar, avatar_thumb, location, state')
            .in('id', coHostIds)
        : { data: [] };
      // Re-sorted into the co-host order: `.in()` returns rows in whatever
      // order the planner likes, which is not the billing order.
      const byId = Object.fromEntries((coHostRowsFull || []).map(p => [p.id, p]));
      const coHostProfiles = coHostIds.map(pid => byId[pid]).filter(Boolean);

      /**
       * L4 · SLOTS COME FROM `event_slots`, NOT FROM `config.days`.
       *
       * ⭐ The claim map and the day array are both built in `lib/eventSlots`
       * now — see that file for why one slot can hold several acts and why the
       * winner used to change between page loads.
       *
       * ⚠ `slot_uuid` is what keys everything from here on. `slot_id` is still
       * SELECTed only so a row can be traced back to the blob it came from; ⛔
       * nothing may key on it again.
       */
      const [{ data: membersData }, { data: perfsData }, { data: slotRows }] = await Promise.all([
        /* ⚠ BOTH STATUSES IN ONE READ so shortlist cards resolve profiles in the
           same pass. They are split immediately below — ⛔ nothing downstream may
           receive the mixed array. */
        supabase.from('lineup_members').select('id, artist_id, artist_profile_id, artist_name, genre, sound, card_pills, status').eq('event_id', id).in('status', ['on_bill', 'shortlisted']),
        supabase.from('performances').select('id, lineup_member_id, slot_id, slot_uuid, status').eq('event_id', id),
        supabase.from('event_slots').select('id, event_id, day_index, day_name, position, legacy_key, time, ampm, dur_mins, label, label_color, pinned')
          .eq('event_id', id).order('day_index').order('position'),
      ]);
      /* ⛔⛔ THE BILL IS `on_bill` ONLY. A shortlisted member is somebody you are
         CONSIDERING; they must never reach the lineup, the tally, the public page
         or the set-times grid. */
      const billMembers  = (membersData || []).filter(m => m.status === 'on_bill');
      const shortMembers = (membersData || []).filter(m => m.status === 'shortlisted');
      /* ⚠ KEYED ON THE BILL ONLY. `indexPerformances` turns rows into slot claims;
         a stray performance still pointing at a shortlisted member would otherwise
         surface as somebody playing a slot they are not booked for. */
      const membersById = {};
      billMembers.forEach(m => { membersById[m.id] = m; });
      const { bySlot: claimsBySlot, primary: map } = indexPerformances(perfsData, membersById);
      const slotDays = groupSlotsIntoDays(slotRows);
      // M5.1 (D1): socials resolve by the slot's own profile id — deterministic
      // for multi-profile owners (replaces undefined row-order behaviour);
      // legacy user_id join kept only for rows without a profile id.
      //
      // ⚠ EVERY act on a contested slot is enriched, not just the one the grid
      // happens to show. Enriching `map` alone would leave the second act on
      // `sat_1` with no avatar and no links the moment anything renders it.
      const claimList = Object.values(claimsBySlot).flat();
      const socialCols = 'id, user_id, mix_link, soundcloud, mixcloud, instagram, facebook, youtube, website, genre_string, sound';
      const pidClaims = claimList.filter(c => c.profile_id);
      const uidClaims = claimList.filter(c => !c.profile_id && c.user_id);
      const [pidSocials, uidSocials] = await Promise.all([
        pidClaims.length ? supabase.from('profiles').select(socialCols).in('id', pidClaims.map(c => c.profile_id)) : Promise.resolve({ data: [] }),
        uidClaims.length ? supabase.from('profiles').select(socialCols).in('user_id', uidClaims.map(c => c.user_id)) : Promise.resolve({ data: [] }),
      ]);
      const socialsById = {}; (pidSocials.data || []).forEach(p => { socialsById[p.id] = p; });
      const socialsByUid = {}; (uidSocials.data || []).forEach(p => { socialsByUid[p.user_id] = p; });
      claimList.forEach(slot => {
        const p = slot.profile_id ? socialsById[slot.profile_id] : socialsByUid[slot.user_id];
        if (!p) return;
        // M15: keep the resolved profiles row itself, not just fields lifted
        // off it. `slot.user_id` above is lineup_members.artist_id — a
        // different column with a different meaning — and FillSlotModal writes
        // that as prof.user_id, which is NULL for an unclaimed profile. A
        // claim-state test against it would therefore look correct on exactly
        // the case it gets wrong. isProfileUnclaimed takes this row instead.
        // Left undefined for a typed billing name with no profile behind it,
        // which is not an unclaimed profile. socialCols already selects
        // `id, user_id`, so no query change is needed.
        slot.profile = p;
        const link = [p.mix_link, p.soundcloud, p.mixcloud].find(v => v && v.trim() && v !== 'N/A');
        if (link && !slot.mix_link) slot.mix_link = link;
        if (p.soundcloud) slot.soundcloud = p.soundcloud;
        if (p.mixcloud)   slot.mixcloud   = p.mixcloud;
        if (p.instagram)  slot.instagram  = p.instagram;
        if (p.facebook)   slot.facebook   = p.facebook;
        if (p.youtube)    slot.youtube    = p.youtube;
        if (p.website)    slot.website    = p.website;
        if (!slot.genre && p.genre_string) slot.genre = p.genre_string;
        if (!slot.sound && p.sound)        slot.sound = p.sound;
      });
      /**
       * Member → EVERY performance they hold.
       *
       * ⛔ THIS REPLACED A `memberPerfMap` THAT KEPT ONLY THE LAST ROW per
       * member. That was survivable for a badge and wrong for an action: an act
       * playing two slots would have had one silently left behind by a "clear
       * set time" built on it, and the badge itself reported whichever row the
       * planner happened to return last. ⛔ Do not reintroduce a one-per-member
       * map — `memberState` and `lib/lineupActions` both take the array.
       */
      const perfsByMember = {};
      (perfsData || []).forEach(p => { (perfsByMember[p.lineup_member_id] ||= []).push(p); });
      // M5.1 (D2): member profiles resolve by artist_profile_id (deterministic
      // for multi-profile owners), legacy artist_id join only for rows without
      // one. ⚠ Both the fetch and the key live in lineupProfiles.js and are
      // tested there — this used to require `artist_id` on both sides, which
      // silently dropped every profile the Gig Importer attaches. The map is
      // keyed by lineup_members.id.
      /* ⚠ `card_pills` AND the completion columns are here because the LINEUP
         tab's cards now render the act's tags and readiness (ProfileCard's
         opt-in `tags`/`readiness`). ⛔ Fetching the profile without them does
         not hide the tags and leave readiness alone — it makes readiness WRONG,
         because every unfetched column scores as an unmet gap. The list is
         appended from PROFILE_CARD_META_COLUMNS rather than typed out, so a
         column added to the completion engine cannot leave this query behind. */
      const memberCols = ['id, user_id, name, avatar, avatar_thumb, type, sound, genre_string, location, state',
        ...PROFILE_CARD_META_COLUMNS].join(', ');
      const { profileIds, userIds } = memberProfileKeys(membersData);
      const [mPid, mUid] = await Promise.all([
        profileIds.length ? supabase.from('profiles').select(memberCols).in('id', profileIds) : Promise.resolve({ data: [] }),
        userIds.length    ? supabase.from('profiles').select(memberCols).in('user_id', userIds) : Promise.resolve({ data: [] }),
      ]);
      const mProfById = {}; (mPid.data || []).forEach(p => { mProfById[p.id] = p; });
      const mProfByUid = {}; (mUid.data || []).forEach(p => { mProfByUid[p.user_id] = p; });
      const memberProfiles = indexMemberProfiles(membersData, mProfById, mProfByUid);
      return {
        event: ev, ownerProfile, venueProfile, coHostProfiles,
        claims: map, claimsBySlot, slotDays,
        lineupMembers: billMembers, shortlistMembers: shortMembers, perfsByMember, memberProfiles,
      };
    },
    enabled: !!id,
  });

  const event          = data?.event          || null;
  const ownerProfile   = data?.ownerProfile   || null;
  const coHostProfiles = data?.coHostProfiles || [];
  const venueProfile   = data?.venueProfile   || null;
  const claims         = data?.claims         || {};
  const claimsBySlot   = data?.claimsBySlot   || {};
  const lineupMembers  = data?.lineupMembers  || [];
  const shortlistMembers = data?.shortlistMembers || [];
  const perfsByMember  = data?.perfsByMember  || {};
  const memberProfiles = data?.memberProfiles || {};

  const cfg        = event?.config || {};
  /**
   * ⚠ `days` NOW COMES FROM `event_slots`, ⛔ no longer from `cfg.days`.
   *
   * The shape is unchanged — `[{ name, slots }]` — so every renderer that took
   * it still does. What changed is that a slot's `id` is a UUID with a foreign
   * key behind it rather than a 6-character string with nothing behind it.
   *
   * ⛔ `cfg.days` is deliberately NOT consulted as a fallback. A fallback here
   * would mean an event silently rendering its pre-migration running order the
   * moment a slot query failed, and nobody could tell which one they were
   * looking at. An unreadable slot list is an empty one, and says so.
   */
  const days       = data?.slotDays || [];
  const poster     = cfg.poster || null;
  const posterFull = cfg.poster_full || poster;
  const genres     = cfg.genres || '';

  const isLocked   = !!cfg.set_times_locked;
  const draftCount = Object.values(claims).filter(c => c?.status === 'draft').length;
  const showTimesPublicly = cfg.host_controls_config?.showTimesPublicly === true;

  const eventDateStr = cfg.endDate || cfg.date;
  const isPast = eventDateStr ? new Date(eventDateStr + 'T23:59:59') < new Date() : false;

  // ⚠ `takenSlots` COUNTS ACCEPTANCES, NOT OFFERS — see lib note in slotTally.
  // It used to count anything that was not `declined`, which reported an
  // unanswered offer as a booked slot.
  const tally      = tallySlots(days, claims);
  const totalSlots = tally.total;
  const takenSlots = tally.filled;
  const lineupPct  = totalSlots > 0 ? Math.round((takenSlots / totalSlots) * 100) : 0;

  return {
    loading, event, ownerProfile, venueProfile, coHostProfiles, claims, claimsBySlot, lineupMembers, shortlistMembers, perfsByMember, memberProfiles,
    cfg, days, poster, posterFull, genres,
    isLocked, draftCount, showTimesPublicly, isPast,
    totalSlots, takenSlots, lineupPct,
    // The full breakdown, for the host's tally. A punter's claims map only ever
    // holds `accepted` rows, so their counts collapse to confirmed/empty on
    // their own — no branch needed here.
    tally,
  };
}
