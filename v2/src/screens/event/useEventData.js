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
      const [{ data: membersData }, { data: perfsData }] = await Promise.all([
        supabase.from('lineup_members').select('id, artist_id, artist_profile_id, artist_name, genre, sound, card_pills').eq('event_id', id).neq('status', 'removed'),
        supabase.from('performances').select('id, lineup_member_id, slot_id, status').eq('event_id', id),
      ]);
      const membersById = {};
      (membersData || []).forEach(m => { membersById[m.id] = m; });
      const map = {};
      (perfsData || []).forEach(p => {
        if (!p.slot_id) return;
        const member = membersById[p.lineup_member_id];
        if (!member) return;
        const status = p.status === 'accepted' ? 'confirmed'
          : p.status === 'declined' ? 'declined'
          : p.status === 'draft'    ? 'draft'
          : !member.artist_id ? 'confirmed'
          : 'offered';
        map[p.slot_id] = {
          id:         p.id,
          member_id:  member.id,
          slot_id:    p.slot_id,
          user_id:    member.artist_id || null,
          profile_id: member.artist_profile_id || null,
          name:       member.artist_name || null,
          genre:      member.genre || null,
          sound:      member.sound || null,
          card_pills: member.card_pills || null,
          status,
        };
      });
      // M5.1 (D1): socials resolve by the slot's own profile id — deterministic
      // for multi-profile owners (replaces undefined row-order behaviour);
      // legacy user_id join kept only for rows without a profile id.
      const claimList = Object.values(map);
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
      // Build member → performance map for the Lineup tab
      const memberPerfMap = {};
      (perfsData || []).forEach(p => { memberPerfMap[p.lineup_member_id] = p; });
      // M5.1 (D2): member profiles resolve by artist_profile_id (deterministic
      // for multi-profile owners), legacy artist_id join only for rows without
      // one. ⚠ Both the fetch and the key live in lineupProfiles.js and are
      // tested there — this used to require `artist_id` on both sides, which
      // silently dropped every profile the Gig Importer attaches. The map is
      // keyed by lineup_members.id.
      const memberCols = 'id, user_id, name, avatar, avatar_thumb, type, sound, genre_string, location, state';
      const { profileIds, userIds } = memberProfileKeys(membersData);
      const [mPid, mUid] = await Promise.all([
        profileIds.length ? supabase.from('profiles').select(memberCols).in('id', profileIds) : Promise.resolve({ data: [] }),
        userIds.length    ? supabase.from('profiles').select(memberCols).in('user_id', userIds) : Promise.resolve({ data: [] }),
      ]);
      const mProfById = {}; (mPid.data || []).forEach(p => { mProfById[p.id] = p; });
      const mProfByUid = {}; (mUid.data || []).forEach(p => { mProfByUid[p.user_id] = p; });
      const memberProfiles = indexMemberProfiles(membersData, mProfById, mProfByUid);
      return { event: ev, ownerProfile, venueProfile, claims: map, lineupMembers: membersData || [], memberPerfMap, memberProfiles };
    },
    enabled: !!id,
  });

  const event          = data?.event          || null;
  const ownerProfile   = data?.ownerProfile   || null;
  const venueProfile   = data?.venueProfile   || null;
  const claims         = data?.claims         || {};
  const lineupMembers  = data?.lineupMembers  || [];
  const memberPerfMap  = data?.memberPerfMap  || {};
  const memberProfiles = data?.memberProfiles || {};

  const cfg        = event?.config || {};
  const days       = cfg.days || [];
  const poster     = cfg.poster || null;
  const posterFull = cfg.poster_full || poster;
  const genres     = cfg.genres || '';

  const isLocked   = !!cfg.set_times_locked;
  const draftCount = Object.values(claims).filter(c => c?.status === 'draft').length;
  const showTimesPublicly = cfg.host_controls_config?.showTimesPublicly === true;

  const eventDateStr = cfg.endDate || cfg.date;
  const isPast = eventDateStr ? new Date(eventDateStr + 'T23:59:59') < new Date() : false;

  const totalSlots = days.reduce((n, d) => n + (d.slots?.length || 0), 0);
  const takenSlots = days.reduce((n, d) => n + (d.slots || []).filter(sl => claims[sl.id] && claims[sl.id].status !== 'declined').length, 0);
  const lineupPct  = totalSlots > 0 ? Math.round((takenSlots / totalSlots) * 100) : 0;

  return {
    loading, event, ownerProfile, venueProfile, claims, lineupMembers, memberPerfMap, memberProfiles,
    cfg, days, poster, posterFull, genres,
    isLocked, draftCount, showTimesPublicly, isPast,
    totalSlots, takenSlots, lineupPct,
  };
}
