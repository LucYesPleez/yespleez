import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { getPersonalProfileId, getPerformerProfiles } from '../lib/actingProfile';
import { writeNotification, writeNotifications } from '../lib/writeNotification';
import { track, EVENTS } from '../lib/analytics';
import { useSession, usePlayer } from '../App';
import { formatDateRange } from '../lib/dates';
import { useShareTarget, shareUrl } from '../lib/shareTarget';
import Skeleton from '../components/Skeleton';
import ApplicationCard from '../components/ApplicationCard';
import ProfileCard from '../components/ProfileCard';
import FillSlotModal from '../components/FillSlotModal';
import EventTabBar from '../components/EventTabBar';
import s from './EventScreen.module.css';
import { likedEvents } from '../lib/likedEvents';
import { resolveProfileId } from '../lib/resolveProfileId';
import { getDemoEventById } from '../lib/demoEvents';
import DemoEventNotice from '../components/DemoEventNotice';
import UnclaimedBadge from '../components/UnclaimedBadge';
import UnclaimedNotice from '../components/UnclaimedNotice';
import { socialProfileUrl, ensureHttps } from '../lib/socialLinks';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';


export default function EventScreen() {
  const { id }      = useParams();
  const navigate    = useNavigate();
  const { session, isGuest } = useSession();

  const [liked,        setLiked]        = useState(() => likedEvents.has(id));
  const [likedBusy,    setLikedBusy]    = useState(false);
  const [showManage,   setShowManage]   = useState(false);
  const [appCounts,    setAppCounts]    = useState({ total: 0, shortlisted: 0 });
  const [appsOpen,     setAppsOpen]     = useState(null);
  const [eventTab,     setEventTab]     = useState('LINEUP');
  const [showEditor,   setShowEditor]   = useState(false);
  const [allApps,      setAllApps]      = useState([]);
  const [appProfiles,  setAppProfiles]  = useState({});
  const [editingSlot,  setEditingSlot]  = useState(null);
  const [fillSlot,     setFillSlot]     = useState(null);
  const [assigningApp, setAssigningApp] = useState(null);
  const [localDays,    setLocalDays]    = useState(null);
  const [viewAsPunter, setViewAsPunter] = useState(false);
  const [goLiveConfirm, setGoLiveConfirm] = useState(false);
  const [sendingOffers, setSendingOffers] = useState(false);
  const [confirmUnlock,  setConfirmUnlock] = useState(false);
  const queryClient = useQueryClient();
  const [activeSlotId, setActiveSlotId] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const isRealEvent = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

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
      const { data: ownerProfile } = ev.owner_profile_id
        ? await supabase.from('profiles').select('id, user_id, name, type').eq('id', ev.owner_profile_id).maybeSingle()
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
      // for multi-profile owners), legacy artist_id join for rows without one.
      // The map stays keyed by artist_id — the renderer's lookup key.
      const memberCols = 'id, user_id, name, avatar, avatar_thumb, type, sound, genre_string, location, state';
      const pidMembers = (membersData || []).filter(m => m.artist_id && m.artist_profile_id);
      const uidMembers = (membersData || []).filter(m => m.artist_id && !m.artist_profile_id);
      let memberProfiles = {};
      const [mPid, mUid] = await Promise.all([
        pidMembers.length ? supabase.from('profiles').select(memberCols).in('id', pidMembers.map(m => m.artist_profile_id)) : Promise.resolve({ data: [] }),
        uidMembers.length ? supabase.from('profiles').select(memberCols).in('user_id', uidMembers.map(m => m.artist_id)) : Promise.resolve({ data: [] }),
      ]);
      const mProfById = {}; (mPid.data || []).forEach(p => { mProfById[p.id] = p; });
      const mProfByUid = {}; (mUid.data || []).forEach(p => { mProfByUid[p.user_id] = p; });
      (membersData || []).forEach(m => {
        if (!m.artist_id) return;
        const p = m.artist_profile_id ? mProfById[m.artist_profile_id] : mProfByUid[m.artist_id];
        if (p) memberProfiles[m.artist_id] = p;
      });
      return { event: ev, ownerProfile, claims: map, lineupMembers: membersData || [], memberPerfMap, memberProfiles };
    },
    enabled: !!id,
  });

  const event         = data?.event         || null;

  // Resource-driven share (navigation & sharing architecture). This screen
  // declares its own canonical payload; the header's Share button stays
  // generic and needs no knowledge of events. The URL is built from the
  // event id rather than window.location.href, so the link is canonical
  // regardless of how the visitor arrived.
  useShareTarget(event ? {
    type:    'event',
    title:   event.name,
    url:     shareUrl(`/event/${event.id ?? id}`),
    preview: event.blurb || event.description || undefined,
    access:  'public',
  } : null);
  const claims        = data?.claims        || {};
  const lineupMembers  = data?.lineupMembers  || [];
  const memberPerfMap  = data?.memberPerfMap  || {};
  const memberProfiles = data?.memberProfiles || {};
  const isLocked   = !!(data?.event?.config?.set_times_locked);
  const draftCount = Object.values(claims).filter(c => c?.status === 'draft').length;
  const allMixSlots = (localDays ?? data?.event?.config?.days ?? []).flatMap(d => (d.slots || [])
    .filter(sl => claims[sl.id]?.mix_link && claims[sl.id]?.status === 'confirmed')
    .map(sl => ({ url: claims[sl.id].mix_link, artistName: claims[sl.id].name }))
  );

  // Load like state once event is fetched
  useEffect(() => {
    if (!event || !session?.user?.id || !isRealEvent) return;
    if (likedEvents.has(id)) return; // already confirmed this session
    supabase.from('follows').select('id').eq('user_id', session.user.id).eq('entity_id', id).maybeSingle()
      .then(({ data: fol }) => {
        if (fol) { likedEvents.add(id); setLiked(true); }
      });
  }, [event?.id, session?.user?.id, isRealEvent]);

  // Load applications + profiles for host
  useEffect(() => {
    if (!id || !session?.user?.id || !isRealEvent) return;
    let cancelled = false;
    async function loadApps() {
      const { data: apps } = await supabase
        .from('applications')
        .select('*')
        .eq('event_id', id)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      const rows = apps || [];
      setAppCounts({ total: rows.length, shortlisted: rows.filter(a => a.status === 'tentative').length });
      setAllApps(rows);
      const artistIds = [...new Set(rows.map(a => a.artist_id).filter(Boolean))];
      if (artistIds.length) {
        const { data: profs } = await supabase.from('profiles')
          .select('user_id, name, avatar, type, sound, genre_string, location, bio, mix_link, card_pills, vibe_tags')
          .in('user_id', artistIds);
        if (!cancelled) {
          const map = {};
          (profs || []).forEach(p => { map[p.user_id] = p; });
          setAppProfiles(map);
        }
      }
    }
    loadApps();
    return () => { cancelled = true; };
  }, [id, session?.user?.id]);

  // Demo ids (e.g. from a bookmarked What's On card) have no Supabase record —
  // explain that instead of the query silently redirecting home. Once real
  // event data uses this same id space (UUIDs), isRealEvent is true and this
  // never fires. An unrecognised non-UUID id (neither real nor a known demo
  // event) still falls back to home, same as before.
  if (!isRealEvent) {
    const demoEvent = getDemoEventById(id);
    if (!demoEvent) { navigate('/'); return null; }
    return <DemoEventNotice event={demoEvent} onClose={() => navigate('/')} />;
  }

  if (loading) return (
    <div className={s.screen} style={{ padding: '72px 16px 80px', maxWidth: 680, margin: '0 auto', boxSizing: 'border-box' }}>
      <Skeleton height={280} radius={12} style={{ marginBottom: 16 }} />
      <Skeleton width="70%" height={32} style={{ marginBottom: 10 }} />
      <Skeleton width="45%" height={14} style={{ marginBottom: 24 }} />
      <Skeleton height={14} style={{ marginBottom: 8 }} />
      <Skeleton width="80%" height={14} style={{ marginBottom: 8 }} />
      <Skeleton width="60%" height={14} />
    </div>
  );
  if (!event)  return null;

  const cfg    = event.config || {};
  const isHost = session?.user?.id === event.host_id;
  const effectiveIsHost = isHost && !viewAsPunter;
  const showTimesPublicly = cfg.host_controls_config?.showTimesPublicly === true;

  const eventDateStr = cfg.endDate || cfg.date;
  const isPast = eventDateStr ? new Date(eventDateStr + 'T23:59:59') < new Date() : false;

  async function toggleLike() {
    if (!session?.user?.id || likedBusy || !isRealEvent) return;
    setLikedBusy(true);
    if (liked) {
      const { error } = await supabase.from('follows').delete().eq('user_id', session.user.id).eq('entity_id', id);
      if (!error) { likedEvents.delete(id); setLiked(false); }
      else console.error('unfollow error:', error);
    } else {
      // M6 (R6.1): stamp attribution at write time — a follow is a
      // personal act, so it comes from the Personal profile (§A6/§A9).
      const fromProfileId = await getPersonalProfileId(session.user.id);
      const { error } = await supabase.from('follows').insert({ user_id: session.user.id, from_profile_id: fromProfileId, entity_id: id, entity_type: 'event', entity_name: event.name });
      if (!error) { likedEvents.add(id); setLiked(true); track(EVENTS.FOLLOWED, { entity_type: 'event' }); }
      else console.error('follow error:', error.message, error.code, error.details, error.hint);
    }
    setLikedBusy(false);
  }

  function reorderSlot(dayIdx, fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    const baseDays = localDays ?? (event.config?.days || []);
    const newDays = baseDays.map((day, di) => {
      if (di !== dayIdx) return day;
      const slots = [...(day.slots || [])];
      const [moved] = slots.splice(fromIdx, 1);
      slots.splice(toIdx, 0, moved);
      return { ...day, slots };
    });
    setLocalDays(newDays);
    supabase.from('events').update({ config: { ...event.config, days: newDays } }).eq('id', id);
  }

  async function removeArtist(slotId) {
    const claim = claims[slotId];
    if (!claim) return;
    await supabase.from('performances').delete().eq('id', claim.id);
    if (claim?.user_id) {
      await Promise.all([
        // §A7: about = the event's owner, whose lineup decision this is.
        writeNotification({
          toUserId:       claim.user_id,
          toProfileId:    (await resolvePerformerProfileId(claim.user_id)).profileId ?? null,
          aboutProfileId: event.owner_profile_id ?? null,
          type:    'slot_removed',
          message: `You have been removed from a slot at ${event.name}.`,
          data:    { event_id: id, event_name: event.name },
        }),
        supabase.from('applications')
          .update({ status: 'tentative' })
          .eq('event_id', id)
          .eq('artist_id', claim.user_id)
          .in('status', ['offered', 'accepted']),
      ]);
      setAllApps(prev => prev.map(a =>
        a.artist_id === claim.user_id && (a.status === 'offered' || a.status === 'accepted')
          ? { ...a, status: 'tentative' }
          : a
      ));
    }
    queryClient.invalidateQueries({ queryKey: ['event', id] });
  }

  async function publishSetTimes() {
    if (sendingOffers) return;
    setSendingOffers(true);
    const { data: drafts } = await supabase
      .from('performances')
      .select('id, slot_id, lineup_members(artist_id, artist_name)')
      .eq('event_id', id)
      .eq('status', 'draft');
    if (drafts?.length) {
      await supabase.from('performances').update({ status: 'offered' }).eq('event_id', id).eq('status', 'draft');
      const withArtist = (drafts || []).filter(d => d.lineup_members?.artist_id);
      if (withArtist.length) {
        // Batch: one insert, as before. writeNotifications exists so this
        // stays a single round trip rather than N sequential writes.
        // §A7 on the batch path too. toProfileId is resolved per recipient
        // BEFORE the insert so this stays one round trip — mapping it to N
        // sequential writes would trade the batch for attribution.
        const batchRows = await Promise.all(withArtist.map(async d => ({
          toUserId:       d.lineup_members.artist_id,
          toProfileId:    (await resolvePerformerProfileId(d.lineup_members.artist_id)).profileId ?? null,
          aboutProfileId: event.owner_profile_id ?? null,
          type:    'slot_offer',
          message: `You've been offered a slot at ${event.name}.`,
          data:    { performance_id: d.id, event_id: id, event_name: event.name, slot_id: d.slot_id },
        })));
        await writeNotifications(batchRows);
        await Promise.all([...new Set(withArtist.map(d => d.lineup_members.artist_id))].map(artistId =>
          supabase.from('applications').update({ status: 'offered' })
            .eq('event_id', id).eq('artist_id', artistId).in('status', ['pending', 'tentative'])
        ));
      }
    }
    await supabase.from('events').update({
      config: { ...(event.config || {}), set_times_locked: true },
    }).eq('id', id);
    setSendingOffers(false);
    queryClient.invalidateQueries({ queryKey: ['event', id] });
  }

  async function unlockSetTimes() {
    await supabase.from('performances').update({ status: 'draft' })
      .eq('event_id', id).eq('status', 'offered');
    await supabase.from('events').update({
      config: { ...(event.config || {}), set_times_locked: false },
    }).eq('id', id);
    setConfirmUnlock(false);
    queryClient.invalidateQueries({ queryKey: ['event', id] });
  }

  async function saveSlot(dayIdx, slotIdx, updated) {
    const baseDays = localDays ?? (event.config?.days || []);
    const newDays = baseDays.map((day, di) =>
      di !== dayIdx ? day : {
        ...day,
        slots: day.slots.map((sl, si) => si !== slotIdx ? sl : { ...sl, ...updated }),
      }
    );
    await supabase.from('events').update({ config: { ...event.config, days: newDays } }).eq('id', id);
    setLocalDays(newDays);
    setEditingSlot(null);
  }

  async function togglePin(dayIdx, slotIdx) {
    const baseDays = localDays ?? (event.config?.days || []);
    const slot = baseDays[dayIdx]?.slots?.[slotIdx];
    if (!slot) return;
    const newDays = baseDays.map((day, di) =>
      di !== dayIdx ? day : {
        ...day,
        slots: day.slots.map((sl, si) => si !== slotIdx ? sl : { ...sl, pinned: !sl.pinned }),
      }
    );
    await supabase.from('events').update({ config: { ...event.config, days: newDays } }).eq('id', id);
    setLocalDays(newDays);
  }

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: event.name, url }); } catch (_) {}
    } else {
      try { await navigator.clipboard.writeText(url); } catch (_) {}
    }
  }

  const shortList  = allApps.filter(a => a.status === 'tentative');
  const pipeline   = allApps.filter(a => a.status === 'pending');

  async function respondApp(appId, status, artistId, evtName) {
    await supabase.from('applications').update({ status }).eq('id', appId);
    setAllApps(prev => prev.map(a => a.id === appId ? { ...a, status } : a));
    setAppCounts(prev => ({
      total: prev.total,
      shortlisted: status === 'tentative' ? prev.shortlisted + 1 : status === 'rejected' ? Math.max(0, prev.shortlisted - 1) : prev.shortlisted,
    }));
    if (status === 'tentative') {
      try {
        await writeNotification({
          toUserId:       artistId,
          toProfileId:    (await resolvePerformerProfileId(artistId)).profileId ?? null,
          aboutProfileId: event.owner_profile_id ?? null,
          type:    'shortlisted',
          message: `You've been shortlisted for ${evtName}.`,
          data:    { event_id: id },
        });
      } catch (_) {}
    }
  }

  const poster     = cfg.poster || null;
  const posterFull = cfg.poster_full || poster;
  const genres = cfg.genres || '';
  const days   = cfg.days || [];

  const totalSlots   = days.reduce((n, d) => n + (d.slots?.length || 0), 0);
  const takenSlots   = days.reduce((n, d) => n + (d.slots || []).filter(sl => claims[sl.id] && claims[sl.id].status !== 'declined').length, 0);
  const lineupPct    = totalSlots > 0 ? Math.round((takenSlots / totalSlots) * 100) : 0;

  async function doAssign(slot) {
    if (!assigningApp) return;
    const { app: aApp, prof: aProf } = assigningApp;
    const artistName = aProf?.name || aApp.artist_name || '—';
    const slotTime = [slot.time, slot.ampm].filter(Boolean).join(' ');
    // Upsert lineup_member for this artist
    let { data: memberData } = await supabase.from('lineup_members').select('id').eq('event_id', id).eq('artist_id', aApp.artist_id).maybeSingle();
    if (!memberData) {
      const artistProfileId = await resolveProfileId(aApp.artist_id, 'artist');
      const { data: nm } = await supabase.from('lineup_members').insert({
        event_id: id, artist_id: aApp.artist_id, artist_profile_id: artistProfileId,
        artist_name: aProf?.name || aApp.artist_name,
        sound: aProf?.sound || null, genre: aProf?.genre_string || null, status: 'on_bill',
      }).select('id').single();
      memberData = nm;
    }
    // Replace any existing performance for this slot, then create the new one
    await supabase.from('performances').delete().eq('slot_id', slot.id).eq('event_id', id);
    const { data: perf } = await supabase.from('performances').insert({
      lineup_member_id: memberData.id, event_id: id, slot_id: slot.id, status: 'offered',
    }).select('id').single();
    await Promise.all([
      supabase.from('applications').update({ status: 'offered' }).eq('id', aApp.id),
      writeNotification({
        toUserId:       aApp.artist_id,
        toProfileId:    (await resolvePerformerProfileId(aApp.artist_id)).profileId ?? null,
        aboutProfileId: event.owner_profile_id ?? null,
        type:    'slot_offer',
        message: `You've been offered a slot${slotTime ? ` at ${slotTime}` : ''} at ${event.name}.`,
        data:    { performance_id: perf?.id, event_id: id, event_name: event.name, slot_id: slot.id, slot_time: slotTime, artist_name: artistName, host_id: session?.user?.id },
      }),
    ]);
    setAllApps(prev => prev.map(a => a.id === aApp.id ? { ...a, status: 'offered' } : a));
    queryClient.invalidateQueries({ queryKey: ['event', id] });
    setAssigningApp(null);
  }

  async function persistClaimSwap(sourceSlotId, targetSlotId, sourceClaim, targetClaim) {
    // Swap slot_ids on the two performances — no unique constraint so both updates are safe
    await supabase.from('performances').update({ slot_id: targetSlotId }).eq('id', sourceClaim.id);
    await supabase.from('performances').update({ slot_id: sourceSlotId }).eq('id', targetClaim.id);
    queryClient.invalidateQueries({ queryKey: ['event', id] });
  }

  async function toggleAppsOpen() {
    const next = !appsOpen;
    setAppsOpen(next);
    await supabase.from('events').update({ applications_open: next }).eq('id', id);
  }

  return (
    <div className={s.screen}>
      {poster && <div className={s.heroBg} style={{ backgroundImage: `url(${posterFull})` }} />}
      <div className={s.heroBgDark} />
      <div className={s.heroBgFade} />

      <div className={s.content}>
        {/* Poster */}
        {poster && (
          <div className={s.posterWrap}>
            <img className={s.poster} src={posterFull} alt={event.name} />
          </div>
        )}

        {/* Header */}
        <header className={s.header}>
          <h1 className={s.eventTitle}>{event.name}</h1>
          {(cfg.date || cfg.venue) && (
            <div className={s.eventMeta}>
              {cfg.date && formatDateRange(cfg.date, cfg.endDate)}
              {cfg.date && cfg.venue && '  ·  '}
              {cfg.venue}
            </div>
          )}
          {genres && <div className={s.eventGenres}>{genres}</div>}
        </header>

        {/* Sync bar */}
        <div className={s.syncBar}>
          <div className={s.syncDot + (!isPast && event.status === 'live' ? ' ' + s.syncDotLive : '')} />
          <span>{isPast ? 'PAST EVENT' : event.status === 'live' ? 'LIVE NOW' : 'NOT LIVE'}</span>
        </div>

        {/* Apply bar — non-host, applications open */}
        {!effectiveIsHost && !isGuest && event.applications_open && (
          <ApplyButton eventId={id} userId={session?.user?.id} ownerProfile={data?.ownerProfile} />
        )}

        {/* Punter preview banner */}
        {isHost && viewAsPunter && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,184,48,.1)', border: '1px solid rgba(255,184,48,.3)', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FFB830" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5, color: '#FFB830' }}>PUNTER VIEW — this is how the event looks to the public</span>
            </div>
            <button onClick={() => setViewAsPunter(false)} style={{ background: 'none', border: 'none', color: '#FFB830', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0 }}>×</button>
          </div>
        )}

        {/* Manage Event panel — owner only */}
        {effectiveIsHost && (
          <div className={s.managePanel}>
            {/* Title row */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
              <div className={s.managePanelStats} style={{ flex: 1, marginBottom: 0 }}>
                <div className={s.manageStat}>
                  <span className={s.manageStatNum}>{appCounts.total}</span>
                  <span className={s.manageStatLabel}>Applications</span>
                </div>
                <div className={s.manageStatDivider} />
                <div className={s.manageStat}>
                  <span className={s.manageStatNum}>{appCounts.shortlisted}</span>
                  <span className={s.manageStatLabel}>Shortlisted</span>
                </div>
                <div className={s.manageStatDivider} />
                <div className={s.manageStat}>
                  <span className={s.manageStatNum}>{totalSlots > 0 ? `${lineupPct}%` : '—'}</span>
                  <span className={s.manageStatLabel}>Lineup</span>
                </div>
              </div>

              {/* Draft/Live toggle — width matched to EDITOR OFF + eye group below */}
              <div style={{ display: 'flex', flexShrink: 0, width: 128, justifyContent: 'center' }}>
                <div style={{
                  display: 'flex', borderRadius: 8, padding: 3, gap: 2,
                  border: '1px solid transparent',
                  background: event.status === 'live'
                    ? 'linear-gradient(#0f0f1a,#0f0f1a) padding-box, linear-gradient(135deg,#00E5A0,#00E5FF) border-box'
                    : 'linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)) padding-box, linear-gradient(rgba(255,255,255,.1),rgba(255,255,255,.1)) border-box',
                }}>
                  <button
                    onClick={async () => {
                      if (event.status === 'draft') return;
                      await supabase.from('events').update({ status: 'draft' }).eq('id', id);
                      queryClient.invalidateQueries({ queryKey: ['event', id] });
                    }}
                    style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, padding: '5px 12px', borderRadius: 6, border: 'none', cursor: event.status === 'draft' ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, transition: 'background .15s, color .15s',
                      background: event.status === 'draft' ? 'rgba(255,255,255,.12)' : 'none',
                      color: event.status === 'draft' ? '#fff' : 'rgba(255,255,255,.4)',
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    DRAFT
                  </button>
                  <button
                    onClick={() => { if (event.status === 'live') return; setGoLiveConfirm(true); }}
                    style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, padding: '5px 12px', borderRadius: 6, border: 'none', cursor: event.status === 'live' ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, transition: 'background .15s, color .15s',
                      background: event.status === 'live' ? '#00E5A0' : 'none',
                      color: event.status === 'live' ? '#0a0a14' : 'rgba(255,255,255,.4)',
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4"/><path d="M12 2a10 10 0 0 1 0 20A10 10 0 0 1 12 2" opacity=".25"/></svg>
                    LIVE
                  </button>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className={s.manageBtn} style={{ flex: 1 }} onClick={() => navigate(`/create-event?edit=${id}`)}>MANAGE EVENT ›</button>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0, width: 128 }}>
              <button
                onClick={() => setShowEditor(v => !v)}
                style={{
                  fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5,
                  padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                  whiteSpace: 'nowrap', border: '1px solid transparent',
                  background: showEditor
                    ? 'linear-gradient(135deg,#00E5A0,#00B4D8)'
                    : 'linear-gradient(#0f0f1a,#0f0f1a) padding-box, linear-gradient(135deg,#00E5A0,#00B4D8) border-box',
                }}
              >
                <span style={showEditor
                  ? { color: '#0f0f1a' }
                  : { background: 'linear-gradient(135deg,#00E5A0,#00B4D8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', display: 'inline-block' }
                }>
                  {showEditor ? 'EDITOR ON' : 'EDITOR OFF'}
                </span>
              </button>
              {/* View as Punter */}
              <button
                onClick={() => { setViewAsPunter(true); setShowEditor(false); }}
                title="View as punter"
                style={{
                  flexShrink: 0, width: 36, height: 36, borderRadius: 8, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.05)',
                  transition: 'background .15s, border-color .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,184,48,.15)'; e.currentTarget.style.borderColor = 'rgba(255,184,48,.4)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)'; }}
              >
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.6)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
              </div>
            </div>

          </div>
        )}

        {/* Sub-tabs — host only, editor mode */}
        {effectiveIsHost && showEditor && (
          <EventTabBar
            active={eventTab}
            onChange={setEventTab}
            tabs={[
              { key: 'LINEUP',    label: `LINEUP${lineupMembers.length ? ` (${lineupMembers.length})` : ''}` },
              { key: 'SET_TIMES', label: 'SET TIMES' },
              { key: 'SHORTLIST', label: `SHORT LIST${shortList.length ? ` (${shortList.length})` : ''}` },
              { key: 'PIPELINE',  label: `PIPELINE${pipeline.length ? ` (${pipeline.length})` : ''}` },
            ]}
          />
        )}

        <div style={{ minHeight: (effectiveIsHost && showEditor && eventTab !== 'SET_TIMES') ? '60vh' : 0 }}>

        {/* Set times toggle — SET_TIMES tab, editor mode */}
        {effectiveIsHost && showEditor && eventTab === 'SET_TIMES' && (
          <button
            onClick={async () => {
              const next = !showTimesPublicly;
              await supabase.from('events').update({
                config: { ...event.config, host_controls_config: { ...cfg.host_controls_config, showTimesPublicly: next } }
              }).eq('id', id);
              queryClient.invalidateQueries({ queryKey: ['event', id] });
            }}
            style={{
              width: '100%', marginBottom: 16, padding: '10px 14px',
              borderRadius: 10, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5,
              border: `1px solid ${showTimesPublicly ? 'rgba(0,229,160,.3)' : 'rgba(255,255,255,.1)'}`,
              background: showTimesPublicly ? 'rgba(0,229,160,.12)' : 'rgba(255,255,255,.04)',
            }}
          >
            <span style={{ color: showTimesPublicly ? '#00E5A0' : 'rgba(255,255,255,.4)' }}>
              {showTimesPublicly ? '● SET TIMES PUBLIC' : '○ SET TIMES HIDDEN'}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', letterSpacing: 1 }}>
              {showTimesPublicly ? 'TAP TO HIDE' : 'TAP TO ANNOUNCE'}
            </span>
          </button>
        )}

        {/* Unlock confirm popup */}
        {confirmUnlock && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.78)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div style={{ background: '#181825', borderRadius: 16, padding: 24, maxWidth: 340, width: '100%', border: '1px solid rgba(255,255,255,.1)' }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 2, marginBottom: 10 }}>EDIT SET TIMES?</div>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', marginBottom: 20, lineHeight: 1.6, margin: '0 0 20px' }}>
                This will unlock set times and move pending offers back to draft. Artists won't be notified again until you republish.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setConfirmUnlock(false)} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.6)', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, cursor: 'pointer' }}>CANCEL</button>
                <button onClick={unlockSetTimes} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: '#FF8C42', color: '#fff', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, cursor: 'pointer' }}>YES, UNLOCK</button>
              </div>
            </div>
          </div>
        )}

        {/* SET TIMES locked banner */}
        {effectiveIsHost && showEditor && eventTab === 'SET_TIMES' && isLocked && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(0,229,160,.07)', border: '1px solid rgba(0,229,160,.28)' }}>
            <span style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5, color: '#00E5A0' }}>● SET TIMES PUBLISHED</span>
            <button onClick={() => setConfirmUnlock(true)} style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.18)', background: 'none', color: 'rgba(255,255,255,.45)', cursor: 'pointer' }}>EDIT SET TIMES</button>
          </div>
        )}

        {/* Publish Set Times — unlocked, draft slots exist */}
        {effectiveIsHost && showEditor && eventTab === 'SET_TIMES' && !isLocked && draftCount > 0 && (
          <button
            onClick={publishSetTimes}
            disabled={sendingOffers}
            style={{
              width: '100%', marginBottom: 12, padding: '11px 14px',
              borderRadius: 10, cursor: sendingOffers ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5,
              border: '1px solid rgba(191,95,255,.45)',
              background: sendingOffers ? 'rgba(191,95,255,.08)' : 'rgba(191,95,255,.15)',
              opacity: sendingOffers ? 0.7 : 1, transition: 'all .15s',
            }}
          >
            <span style={{ color: '#BF5FFF' }}>
              {sendingOffers ? '● PUBLISHING…' : '● PUBLISH SET TIMES'}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(191,95,255,.6)', letterSpacing: 1 }}>
              NOTIFY {draftCount} ARTIST{draftCount !== 1 ? 'S' : ''}
            </span>
          </button>
        )}

        {/* LINEUP tab */}
        {effectiveIsHost && showEditor && eventTab === 'LINEUP' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lineupMembers.length === 0
              ? (
                <div style={{ textAlign: 'center', padding: '48px 16px' }}>
                  <div style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 3, color: 'rgba(255,255,255,.18)', marginBottom: 8 }}>NO ONE ON THE BILL YET</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,.13)' }}>Shortlist artists and assign them a slot to build your lineup.</div>
                </div>
              )
              : lineupMembers.map(member => {
                const prof = member.artist_id ? memberProfiles[member.artist_id] : null;
                const perf = memberPerfMap[member.id];
                let badge, badgeColor;
                if (!perf)                       { badge = 'ON BILL';   badgeColor = 'rgba(255,255,255,.35)'; }
                else if (perf.status === 'draft')    { badge = 'DRAFT';     badgeColor = 'rgba(255,255,255,.35)'; }
                else if (perf.status === 'offered')  { badge = 'AWAITING';  badgeColor = '#FF8C42'; }
                else if (perf.status === 'accepted') { badge = 'CONFIRMED'; badgeColor = '#00E5A0'; }
                else if (perf.status === 'declined') { badge = 'DECLINED';  badgeColor = '#FF3399'; }
                const cardItem = {
                  user_id:      member.artist_id || null,
                  name:         prof?.name         || member.artist_name,
                  type:         prof?.type         || 'artist',
                  avatar:       prof?.avatar        || null,
                  avatar_thumb: prof?.avatar_thumb  || null,
                  sound:        prof?.sound         || member.sound || null,
                  genre_string: prof?.genre_string  || member.genre || null,
                  location:     prof?.location      || null,
                  state:        prof?.state         || null,
                };
                return (
                  <ProfileCard key={member.id} item={cardItem} badge={badge} badgeColor={badgeColor}
                    actions={
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <button onClick={async () => {
                          await supabase.from('performances').delete().eq('lineup_member_id', member.id);
                          await supabase.from('lineup_members').delete().eq('id', member.id);
                          if (member.artist_id) await supabase.from('applications').update({ status: 'tentative' }).eq('event_id', id).eq('artist_id', member.artist_id).neq('status', 'declined');
                          queryClient.invalidateQueries({ queryKey: ['event', id] });
                        }} style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,140,66,.4)', background: 'rgba(255,140,66,.08)', color: '#FF8C42', cursor: 'pointer', whiteSpace: 'nowrap' }}>UNASSIGN</button>
                        <button onClick={async () => {
                          await supabase.from('performances').delete().eq('lineup_member_id', member.id);
                          await supabase.from('lineup_members').delete().eq('id', member.id);
                          if (member.artist_id) await supabase.from('applications').update({ status: 'declined' }).eq('event_id', id).eq('artist_id', member.artist_id);
                          queryClient.invalidateQueries({ queryKey: ['event', id] });
                        }} style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,51,51,.3)', background: 'rgba(255,51,51,.06)', color: 'rgba(255,80,80,.8)', cursor: 'pointer', whiteSpace: 'nowrap' }}>DISCARD</button>
                      </div>
                    }
                  />
                );
              })
            }
          </div>
        )}

        {/* SHORT LIST tab */}
        {effectiveIsHost && showEditor && eventTab === 'SHORTLIST' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shortList.length === 0
              ? <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '32px 0' }}>No artists shortlisted yet.</p>
              : shortList.map(app => {
                const prof = appProfiles[app.artist_id] || {};
                const cardItem = { user_id: app.artist_id, name: prof.name || app.artist_name, type: prof.type || 'artist', avatar: prof.avatar || null, avatar_thumb: prof.avatar_thumb || null, sound: prof.sound || null, genre_string: prof.genre_string || null, location: prof.location || null, state: prof.state || null };
                return (
                  <ProfileCard key={app.id} item={cardItem} badge="SHORTLISTED" badgeColor="var(--neon2)"
                    actions={
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <button onClick={() => setAssigningApp({ app, prof })} style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(0,229,255,.4)', background: 'rgba(0,229,255,.08)', color: 'var(--neon2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>ASSIGN SLOT</button>
                        <button onClick={() => { supabase.from('applications').update({ status: 'declined' }).eq('id', app.id); setAllApps(prev => prev.map(a => a.id === app.id ? { ...a, status: 'declined' } : a)); }} style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,51,51,.3)', background: 'rgba(255,51,51,.06)', color: 'rgba(255,80,80,.8)', cursor: 'pointer', whiteSpace: 'nowrap' }}>DROP</button>
                      </div>
                    }
                  />
                );
              })
            }
          </div>
        )}

        {/* PIPELINE tab */}
        {effectiveIsHost && showEditor && eventTab === 'PIPELINE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pipeline.length === 0
              ? <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '32px 0' }}>No pending applications.</p>
              : pipeline.map(app => {
                const prof = appProfiles[app.artist_id] || {};
                const cardItem = { user_id: app.artist_id, name: prof.name || app.artist_name, type: prof.type || 'artist', avatar: prof.avatar || null, avatar_thumb: prof.avatar_thumb || null, sound: prof.sound || null, genre_string: prof.genre_string || null, location: prof.location || null, state: prof.state || null };
                return (
                  <ProfileCard key={app.id} item={cardItem}
                    actions={
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <button onClick={() => { supabase.from('applications').update({ status: 'tentative' }).eq('id', app.id); setAllApps(prev => prev.map(a => a.id === app.id ? { ...a, status: 'tentative' } : a)); }} style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(0,229,255,.4)', background: 'rgba(0,229,255,.08)', color: 'var(--neon2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>SHORTLIST</button>
                        <button onClick={() => { supabase.from('applications').update({ status: 'declined' }).eq('id', app.id); setAllApps(prev => prev.map(a => a.id === app.id ? { ...a, status: 'declined' } : a)); }} style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,51,51,.3)', background: 'rgba(255,51,51,.06)', color: 'rgba(255,80,80,.8)', cursor: 'pointer', whiteSpace: 'nowrap' }}>DECLINE</button>
                      </div>
                    }
                  />
                );
              })
            }
          </div>
        )}

        </div>{/* end tab content minHeight wrapper */}

        {/* Manage Event sheet */}
        {showManage && (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.82)', zIndex:10000, display:'flex', alignItems:'flex-end', justifyContent:'center' }}
               onClick={() => setShowManage(false)}>
            <div style={{ background:'#13131f', borderRadius:'20px 20px 0 0', width:'100%', maxWidth:480, maxHeight:'80vh', overflowY:'auto', paddingBottom:'calc(env(safe-area-inset-bottom, 0px) + 16px)', boxShadow:'0 -4px 40px rgba(0,0,0,0.6)', border:'1px solid rgba(255,255,255,0.07)', borderBottom:'none' }}
                 onClick={e => e.stopPropagation()}>
              {/* drag handle */}
              <div style={{ display:'flex', justifyContent:'center', padding:'12px 0 4px' }}>
                <div style={{ width:36, height:4, borderRadius:2, background:'rgba(255,255,255,0.15)' }} />
              </div>
              <div style={{ padding:'10px 20px 14px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                <p style={{ margin:0, fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:'0.1em', background:'linear-gradient(135deg,#00E5FF,#BF5FFF)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>MANAGE EVENT</p>
                <p style={{ margin:'2px 0 0', fontSize:12, color:'var(--muted)', letterSpacing:'0.02em' }}>{event.name}</p>
              </div>
              <ManageSection label="Event">
                <ManageItem icon={<EditIcon />} label="Edit Event Details" onClick={() => { setShowManage(false); navigate(`/create-event?edit=${id}`); }} />
              </ManageSection>
              <ManageSection label="Applications">
                <ManageItem icon={<InboxIcon />} label="View Applications" onClick={() => { setShowManage(false); navigate(`/event/${id}/applications`); }} />
                <ManageItem icon={appsOpen ? <LockIcon /> : <UnlockIcon />} label={appsOpen ? 'Close Applications' : 'Open Applications'} onClick={() => { toggleAppsOpen(); setShowManage(false); }} />
              </ManageSection>
              <ManageSection label="Management">
                <ManageItem icon={<CopyIcon />} label="Duplicate Event" onClick={() => setShowManage(false)} muted />
                <ManageItem icon={<TrashIcon />} label="Delete Event" onClick={() => setShowManage(false)} danger />
              </ManageSection>
            </div>
          </div>
        )}

        {cfg.ticketLink && (
          <a href={cfg.ticketLink} target="_blank" rel="noopener noreferrer" className={s.ticketBtn}>
            🎟 BUY TICKETS
          </a>
        )}

        {/* Coming soon — punter view, set times enabled but not yet announced */}
        {!effectiveIsHost && !showTimesPublicly && totalSlots > 0 && (
          <div style={{ textAlign: 'center', padding: '48px 16px' }}>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: 3, color: 'rgba(255,255,255,.28)', marginBottom: 8 }}>SET TIMES COMING SOON</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.2)' }}>Stay tuned for the lineup.</div>
          </div>
        )}

        {/* Days + slots — SET_TIMES tab (or non-host when times are public) */}
        {(effectiveIsHost || showTimesPublicly) && (!effectiveIsHost || !showEditor || eventTab === 'SET_TIMES') && (localDays ?? days).map((day, di) => {
          const slots = day.slots || [];
          const sortableIds = slots.map(sl => sl.id);
          const activeSlot = activeSlotId ? slots.find(sl => sl.id === activeSlotId) : null;

          function handleDragEnd({ active, over }) {
            setActiveSlotId(null);
            if (!over || active.id === over.id) return;
            const sourceClaim = claims[active.id];
            if (!sourceClaim) return;
            if (slots.find(sl => sl.id === over.id)?.pinned) return;
            const targetClaim = claims[over.id];
            const isFilled = c => c && c.status !== 'declined';

            // Optimistic update — swap claims in the React Query cache immediately
            const currentData = queryClient.getQueryData(['event', id]);
            if (currentData) {
              const newClaims = { ...currentData.claims };
              if (isFilled(targetClaim)) {
                newClaims[over.id]    = sourceClaim;
                newClaims[active.id]  = targetClaim;
              } else {
                newClaims[over.id] = sourceClaim;
                delete newClaims[active.id];
              }
              queryClient.setQueryData(['event', id], { ...currentData, claims: newClaims });
            }

            // Persist to DB
            if (!isFilled(targetClaim)) {
              supabase.from('performances')
                .update({ slot_id: over.id })
                .eq('id', sourceClaim.id)
                .then(() => queryClient.invalidateQueries({ queryKey: ['event', id] }));
            } else {
              persistClaimSwap(active.id, over.id, sourceClaim, targetClaim);
            }
          }

          return (
            <div key={di} className={s.daySection}>
              {day.name && (
                <div className={s.dayDivider}>
                  <span className={s.dayName}>{day.name}</span>
                  <div className={s.dayLine} />
                </div>
              )}
              {effectiveIsHost && showEditor ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter}
                  onDragStart={({ active }) => setActiveSlotId(active.id)}
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => setActiveSlotId(null)}
                >
                  <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                    {slots.map((slot, si) => (
                      <SlotCard key={slot.id} slot={slot} claim={claims[slot.id]}
                        isHost={effectiveIsHost}
                        locked={isLocked}
                        isSortable={!isLocked && !slot.pinned && !!claims[slot.id] && claims[slot.id].status !== 'declined'}
                        isActiveSort={slot.id === activeSlotId}
                        onFill={!isLocked ? () => setFillSlot({ slot }) : null}
                        onEdit={!isLocked ? () => setEditingSlot({ dayIdx: di, slotIdx: si, slot }) : null}
                        onRemove={!isLocked ? () => removeArtist(slot.id) : null}
                        onPin={!isLocked ? () => togglePin(di, si) : null}
                        allMixSlots={allMixSlots}
                      />
                    ))}
                  </SortableContext>
                  <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
                    {activeSlot ? (
                      <SlotCard slot={activeSlot} claim={claims[activeSlot.id]}
                        isHost={effectiveIsHost} isDragOverlay />
                    ) : null}
                  </DragOverlay>
                </DndContext>
              ) : (
                slots.map((slot, si) => (
                  <SlotCard key={slot.id} slot={slot} claim={claims[slot.id]}
                    isHost={effectiveIsHost}
                    locked={isLocked}
                    onFill={effectiveIsHost && !isLocked ? () => setFillSlot({ slot }) : null}
                    onEdit={effectiveIsHost && !isLocked ? () => setEditingSlot({ dayIdx: di, slotIdx: si, slot }) : null}
                    onRemove={effectiveIsHost && !isLocked ? () => removeArtist(slot.id) : null}
                    onPin={effectiveIsHost && !isLocked ? () => togglePin(di, si) : null}
                    allMixSlots={allMixSlots}
                  />
                ))
              )}
            </div>
          );
        })}

        {(!effectiveIsHost || !showEditor || eventTab === 'SET_TIMES') && <>
        {/* Tally — only visible when set times are public or host is viewing */}
        {(effectiveIsHost || showTimesPublicly) && totalSlots > 0 && (
          <div className={s.tally}>
            <strong>{takenSlots}</strong> of <strong>{totalSlots}</strong> slots filled
          </div>
        )}

        {/* About */}
        {cfg.bio && (
          <div className={s.infoCard}>
            <div className={s.infoLabel}>ABOUT</div>
            <div className={s.infoText}>{cfg.bio}</div>
          </div>
        )}

        {/* Location */}
        {cfg.location && (
          <div className={s.infoCard}>
            <div className={s.infoLabel}>LOCATION</div>
            <div className={s.infoText}>{cfg.location}</div>
          </div>
        )}
        </>}
      </div>

      {editingSlot && (
        <SlotEditModal
          slot={editingSlot.slot}
          onSave={updated => saveSlot(editingSlot.dayIdx, editingSlot.slotIdx, updated)}
          onClose={() => setEditingSlot(null)}
        />
      )}

      {/* Go Live confirmation sheet */}
      {goLiveConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 3000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 'var(--yp-safe-bottom)' }}
          onClick={e => e.target === e.currentTarget && setGoLiveConfirm(false)}>
          <div style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: '28px 24px 40px', border: '1px solid rgba(255,255,255,.08)', borderBottom: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(0,229,160,.15)', border: '1px solid rgba(0,229,160,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="#00E5A0"><circle cx="12" cy="12" r="4"/><path d="M2 12C2 6.5 6.5 2 12 2s10 4.5 10 10-4.5 10-10 10S2 17.5 2 12z" opacity=".25"/></svg>
              </div>
              <div>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: '#fff' }}>Go live and make this event public?</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,.45)', marginTop: 3 }}>Anyone will be able to discover and apply.</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button onClick={() => setGoLiveConfirm(false)}
                style={{ flex: 1, padding: '13px 0', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.55)', cursor: 'pointer' }}>
                CANCEL
              </button>
              <button onClick={async () => {
                const { error } = await supabase.from('events').update({ status: 'live' }).eq('id', id);
                // A1 · the OTHER way an event gets published — a draft taken
                // live later. Without this the published count would only ever
                // include events that went live straight off the create form.
                if (!error) track(EVENTS.PUBLISHED_EVENT, { from: 'draft' });
                queryClient.invalidateQueries({ queryKey: ['event', id] });
                setGoLiveConfirm(false);
              }}
                style={{ flex: 1, padding: '13px 0', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, borderRadius: 10, border: 'none', background: '#00E5A0', color: '#0a0a14', cursor: 'pointer' }}>
                GO LIVE
              </button>
            </div>
          </div>
        </div>
      )}

      {fillSlot && (
        <FillSlotModal
          slot={fillSlot.slot}
          eventId={id}
          eventName={data?.event?.name || ''}
          hostId={session?.user?.id}
          acceptedArtists={allApps.filter(a => a.status === 'tentative')}
          acceptedProfiles={appProfiles}
          onFilled={() => { setFillSlot(null); queryClient.invalidateQueries({ queryKey: ['event', id] }); }}
          onClose={() => setFillSlot(null)}
        />
      )}

      {assigningApp && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', zIndex: 2000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 'var(--yp-safe-bottom)' }}
          onClick={() => setAssigningApp(null)}>
          <div style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 -4px 40px rgba(0,0,0,.6)', border: '1px solid rgba(255,255,255,.07)', borderBottom: 'none' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 2 }}>ASSIGN SLOT</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>Pick a slot for {assigningApp.prof?.name || assigningApp.app.artist_name || '—'}</div>
              </div>
              <button onClick={() => setAssigningApp(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 24, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '12px 20px 32px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(localDays ?? days).flatMap(d => d.slots || []).length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>No slots yet — add slots in the LINEUP editor first.</p>
              )}
              {(localDays ?? days).flatMap(d => d.slots || []).map(slot => {
                const existing = claims[slot.id];
                const isFilled = existing && existing.status !== 'declined';
                const timeLabel = [slot.time, slot.ampm].filter(Boolean).join(' ');
                const durLabel  = slot.dur ? (slot.dur >= 60 ? `${slot.dur / 60}hr` : `${slot.dur}m`) : '';
                return (
                  <button key={slot.id} onClick={() => doAssign(slot)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 16px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                      border: `1px solid ${isFilled ? 'rgba(255,255,255,.08)' : 'rgba(0,229,160,.25)'}`,
                      background: isFilled ? 'rgba(255,255,255,.03)' : 'rgba(0,229,160,.06)',
                    }}>
                    <div>
                      <div style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1, color: isFilled ? 'rgba(255,255,255,.5)' : '#fff' }}>
                        {timeLabel}{durLabel ? ` — ${durLabel}` : ''}{slot.label ? ` · ${slot.label}` : ''}
                      </div>
                      {isFilled && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginTop: 2 }}>Currently: {existing.name}</div>}
                    </div>
                    <span style={{ fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1, color: isFilled ? 'rgba(255,255,255,.3)' : '#00E5A0', flexShrink: 0, marginLeft: 12 }}>
                      {isFilled ? 'REASSIGN' : 'OPEN →'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SlotEditModal({ slot, onSave, onClose }) {
  const [time,       setTime]       = useState(slot.time  || '');
  const [ampm,       setAmpm]       = useState(slot.ampm  || 'PM');
  const [dur,        setDur]        = useState(String(slot.dur ?? slot.duration ?? ''));
  const [label,      setLabel]      = useState(stripEmoji(slot.label || ''));
  const [labelCol,   setLabelCol]   = useState(slot.labelColor || '');
  const [saving,     setSaving]     = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave({ time, ampm, dur: dur ? Number(dur) : null, label, labelColor: labelCol });
    setSaving(false);
  }

  const field = { width: '100%', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontFamily: 'inherit', fontSize: 14, boxSizing: 'border-box' };
  const lbl   = { fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, color: 'var(--muted)', display: 'block', marginBottom: 5 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, padding: '24px 20px 28px', width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2 }}>EDIT SLOT</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <span style={lbl}>TIME</span>
            <input style={field} value={time} onChange={e => setTime(e.target.value)} placeholder="9:00" />
          </div>
          <div>
            <span style={lbl}>AM/PM</span>
            <select style={{ ...field, padding: '10px 8px' }} value={ampm} onChange={e => setAmpm(e.target.value)}>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
          <div>
            <span style={lbl}>DURATION (mins)</span>
            <input style={field} type="number" value={dur} onChange={e => setDur(e.target.value)} placeholder="90" />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <span style={lbl}>LABEL (optional)</span>
          <div style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, overflow: 'hidden' }}>
            <input style={{ ...field, border: 'none', borderBottom: '1px solid rgba(255,255,255,.08)', borderRadius: 0 }} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. SUNSET SET" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'rgba(255,255,255,.03)' }}>
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 9, letterSpacing: 1.5, color: 'var(--muted)', flexShrink: 0 }}>COLOUR</span>
              {['', ...LABEL_PALETTE].map((col, i) => (
                <button key={i} onClick={() => setLabelCol(col)}
                  style={{
                    width: 16, height: 16, borderRadius: 4, cursor: 'pointer', flexShrink: 0,
                    background: col || 'rgba(255,255,255,.15)',
                    border: labelCol === col ? `2px solid #fff` : '2px solid transparent',
                    boxSizing: 'border-box', padding: 0,
                    transition: 'border-color .1s',
                  }} />
              ))}
            </div>
          </div>
        </div>

        <button onClick={handleSave} disabled={saving}
          style={{ width: '100%', padding: 13, borderRadius: 12, border: 'none', cursor: saving ? 'default' : 'pointer', fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: 2, background: saving ? 'rgba(255,255,255,.08)' : 'var(--neon2)', color: saving ? 'var(--muted)' : '#0a0a0f' }}
        >{saving ? 'SAVING…' : 'SAVE SLOT'}</button>
      </div>
    </div>
  );
}

function ApplyButton({ eventId, userId, ownerProfile }) {
  const [status,        setStatus]        = useState(null);
  const [note,          setNote]          = useState('');
  const [open,          setOpen]          = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [checked,       setChecked]       = useState(false);
  const [performers,    setPerformers]    = useState([]);
  const [actingId,      setActingId]      = useState(null);

  useEffect(() => {
    if (!userId || !eventId) { setChecked(true); return; }
    supabase.from('applications').select('status').eq('event_id', eventId).eq('artist_id', userId).maybeSingle()
      .then(({ data }) => { setStatus(data?.status || null); setChecked(true); });
  }, [eventId, userId]);

  useEffect(() => {
    if (!userId) return;
    // M6: the acting profile comes from the one seam (actingProfile.js).
    // Auto-select ONLY when there is exactly one eligible profile; with
    // several the user chooses, because guessing the sender is precisely
    // what B2 cost us on every pre-M6 application row.
    getPerformerProfiles(userId).then(list => {
      setPerformers(list);
      setActingId(list.length === 1 ? list[0].id : null);
    });
  }, [userId]);

  if (!checked) return null;
  if (!userId)  return null;

  if (status) {
    const col = { accepted: 'var(--green)', pending: 'var(--gold)', rejected: 'var(--muted)' }[status] || 'var(--muted)';
    return (
      <div style={{ marginBottom: 16 }}>
        <p style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, color: col }}>
          APPLICATION {status.toUpperCase()}
        </p>
      </div>
    );
  }

  async function submit() {
    // R6.1: never write an application that cannot name its sender.
    if (!actingId) return;
    setLoading(true);
    const { error } = await supabase.from('applications').insert({
      event_id: eventId,
      artist_id: userId,
      from_profile_id: actingId,
      status: 'pending',
      note,
    });
    setLoading(false);
    if (!error) {
      setStatus('pending'); setOpen(false);
      // A1 · a genuine application. Accepting a slot OFFER (ArtistDashboard,
      // notifActions) also inserts into `applications`, but that is the host
      // asking and the artist agreeing — a different act, deliberately not
      // counted here.
      track(EVENTS.APPLIED, { has_note: !!(note && note.trim()) });
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {!open ? (
        <button className={s.applyBtn} onClick={() => setOpen(true)}>APPLY TO PLAY</button>
      ) : (
        <div className={s.applyForm}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 2, marginBottom: 8 }}>YOUR APPLICATION</p>
          {/* M6 · acting profile. One eligible profile is stated; several
              are chosen from. Nothing is pre-selected when it is ambiguous —
              a default here would be a guess wearing a confirmation. */}
          {performers.length === 1 && (
            <p style={{ fontSize: 12, color: 'var(--neon2)', marginBottom: 8, fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>
              APPLYING AS: {performers[0].name} · {performers[0].sound || performers[0].genre_string || ''}
            </p>
          )}
          {performers.length > 1 && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>APPLYING AS</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {performers.map(p => {
                  const on = p.id === actingId;
                  return (
                    <button key={p.id} type="button" onClick={() => setActingId(p.id)}
                      style={{
                        padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                        fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1,
                        border: `1px solid ${on ? 'var(--neon2)' : 'var(--border)'}`,
                        background: on ? 'rgba(0,229,255,.12)' : 'none',
                        color: on ? 'var(--neon2)' : 'var(--muted)',
                      }}>
                      {p.name || '(unnamed)'}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {performers.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              You need an artist, band or comedy profile before you can apply.
            </p>
          )}
          <textarea value={note} onChange={e => setNote(e.target.value)}
            placeholder="Add a note for the host (optional)…" rows={3}
            style={{ width: '100%', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '10px 12px', fontSize: 13, outline: 'none', resize: 'none', marginBottom: 10 }} />
          {/* N2 · immediately above SEND, the last thing read before acting.
              APPLY TO PLAY is gated on `!isHost && !isGuest && applications_open`
              and never on the owner's claim state, so an event imported for an
              organiser who has never joined is applyable — and said nothing. */}
          <UnclaimedNotice profile={ownerProfile} context="apply" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setOpen(false)}
              style={{ flex: 1, background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, padding: 10, borderRadius: 8 }}>CANCEL</button>
            <button onClick={submit} disabled={loading || !actingId} className={s.applyBtn}
              style={{ flex: 2, opacity: actingId ? 1 : .5 }}>
              {loading ? '…' : performers.length > 1 && !actingId ? 'CHOOSE A PROFILE' : 'SEND APPLICATION'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function parseDurMins(raw) {
  if (!raw) return 0;
  const n = Number(raw);
  if (n > 0) return n;
  const s = String(raw);
  const hr = s.match(/^([\d.]+)\s*hrs?$/i);
  if (hr) return Math.round(parseFloat(hr[1]) * 60);
  const mn = s.match(/^([\d.]+)\s*mins?$/i);
  if (mn) return Math.round(parseFloat(mn[1]));
  return 0;
}

function fmtDur(mins) {
  if (!mins) return null;
  const m = Number(mins);
  if (!m) return null;
  if (m < 60) return `${m} mins`;
  const h = m / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)} hr${h !== 1 ? 's' : ''}`;
}

const LABEL_PALETTE = ['#FFB830', '#BF5FFF', '#00E5A0', '#FF6B6B', '#FF8C42', '#7BC8F6'];
function labelColor(label) {
  if (!label) return '#FFB830';
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) & 0xFFFFFF;
  return LABEL_PALETTE[Math.abs(hash) % LABEL_PALETTE.length];
}
function stripEmoji(str) {
  return str?.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim() || '';
}

function HeadphoneIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
    </svg>
  );
}

function SlotCard({ slot, claim, onFill, onEdit, onRemove, onPin, isHost, isSortable, isActiveSort, isDragOverlay, allMixSlots = [], locked = false }) {
  const [expanded,      setExpanded]      = useState(false);
  const [genreShowAll, setGenreShowAll] = useState(false);
  const pillHintRef = useRef(null);
  const [hostNote,      setHostNote]      = useState('');
  const [artistBrief,   setArtistBrief]   = useState('');
  const [notesBoxOpen,  setNotesBoxOpen]  = useState(false);
  const [briefOpen,     setBriefOpen]     = useState(false);
  const [hostNoteOpen,  setHostNoteOpen]  = useState(false);
  const [historyOpen,   setHistoryOpen]   = useState(false);
  const [followed,      setFollowed]      = useState(false);
  const [followBusy,    setFollowBusy]    = useState(false);
  const [confirm,       setConfirm]       = useState(null); // 'replace' | 'remove'

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slot.id,
    disabled: !isSortable,
  });
  const navigate = useNavigate();
  const { session } = useSession();

  useEffect(() => {
    if (!session?.user?.id || !claim?.user_id || session.user.id === claim.user_id) return;
    supabase.from('follows').select('id').eq('user_id', session.user.id).eq('entity_id', claim.user_id).maybeSingle()
      .then(({ data }) => setFollowed(!!data));
  }, [session?.user?.id, claim?.user_id]);

  useEffect(() => {
    if (!expanded) { setGenreShowAll(false); return; }
    if (!pillHintRef.current || genreShowAll) return;
    const el = pillHintRef.current;
    if (el.scrollWidth <= el.clientWidth) return;
    const t1 = setTimeout(() => el.scrollTo({ left: 48, behavior: 'smooth' }), 200);
    const t2 = setTimeout(() => el.scrollTo({ left: 0, behavior: 'smooth' }), 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [expanded]);

  const { player, setPlayer } = usePlayer();
  const claimStatus   = claim?.status || (claim?.user_id ? 'pending' : 'name_added');
  const isConfirmed   = claimStatus === 'confirmed';
  const isDraft       = claimStatus === 'draft';
  const artistName    = claim?.name || '';
  const publicName    = (!isHost && !isConfirmed && claim) ? 'PENDING' : artistName;
  const isEmpty       = !claim || (!isHost && isDraft);
  const rawDur     = parseDurMins(slot.dur ?? slot.duration);
  const durLabel   = fmtDur(rawDur > 0 ? rawDur : 60);
  const cleanLabel = slot.label ? stripEmoji(slot.label) : null;
  const col        = slot.labelColor || (cleanLabel ? labelColor(cleanLabel) : '#FFB830');

  // Single descriptor pill matching v1: sound > card_pills > genre
  const descriptor = claim?.sound || claim?.card_pills || claim?.genre || '';

  const borderCol = slot.pinned ? '#FFB830' : (isEmpty && !isDraft) ? 'var(--border)' : isDraft ? 'rgba(255,255,255,.18)' : 'var(--neon)';

  return (
    <div
      ref={setNodeRef}
      style={{ marginBottom: 8, opacity: isDragging ? 0 : isDragOverlay ? 0.85 : 1, transform: CSS.Transform.toString(transform), transition, boxShadow: isDragOverlay ? '0 8px 32px rgba(0,0,0,.5)' : undefined }}
    >
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* Drag handle — only in editor mode */}
        {isSortable && (
          <div
            {...attributes}
            {...listeners}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, flexShrink: 0, cursor: 'grab', borderRadius: expanded ? '10px 0 0 0' : '10px 0 0 10px', background: 'rgba(255,255,255,.04)', border: `1px solid ${borderCol}`, borderRight: 'none', color: 'rgba(255,255,255,.3)' }}
          >
            <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
              <circle cx="4" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/>
              <circle cx="4" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/>
              <circle cx="4" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/>
            </svg>
          </div>
        )}
        <div
          className={s.slot + (isEmpty ? ' ' + s.slotEmpty : '')}
          style={{ border: `1px solid ${borderCol}`, borderLeft: player?.url && player.url === claim?.mix_link ? '2px solid var(--neon2)' : `1px solid ${borderCol}`, borderRadius: isSortable ? (expanded ? '0 10px 0 0' : '0 10px 10px 0') : (expanded ? '10px 10px 0 0' : 10), cursor: 'pointer', marginBottom: 0, flex: 1 }}
          onClick={() => {
            if (isEmpty && onFill) { onFill(); return; }
            if (!isHost && !isConfirmed) return; // pending slot — not expandable in public view
            setExpanded(v => !v);
          }}
        >
        <div className={s.timeBlock} style={{ '--divider-col': borderCol }}>
          <div className={s.timeNum}>{slot.time || '—'}</div>
          {slot.ampm && <div className={s.timeAmPm}>{slot.ampm}</div>}
          {durLabel && <div className={s.timeDur}>{durLabel}</div>}
        </div>
        <div className={s.slotInfo}>
          <div className={s.djNameRow}>
            <HeadphoneIcon />
            <span className={s.djName} style={{ color: isEmpty ? 'var(--muted)' : publicName === 'PENDING' ? 'var(--muted)' : isDraft ? 'rgba(255,255,255,.6)' : 'var(--text)', fontStyle: isEmpty ? 'italic' : 'normal' }}>
              {isEmpty ? 'Open slot' : publicName}
            </span>
            {/* Identity before slot status, same order as every other surface.
                .djNameRow is already flex with a 6px gap and .djName carries
                nowrap + ellipsis, so the name yields width and the badge needs
                no spacing of its own. */}
            <UnclaimedBadge profile={claim?.profile} />
            {isHost && isDraft && (
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 9, letterSpacing: 1.5, color: 'rgba(255,255,255,.35)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>DRAFT</span>
            )}
            {player?.url && player.url === claim?.mix_link && (
              <div className={s.eqBars}>
                {[
                  { dur: '0.7s', delay: '0s',    maxH: 11 },
                  { dur: '0.5s', delay: '0.1s',  maxH: 13 },
                  { dur: '0.6s', delay: '0.2s',  maxH: 10 },
                  { dur: '0.8s', delay: '0.05s', maxH: 12 },
                ].map((b, i) => (
                  <div key={i} className={s.eqBar} style={{ height: 4, animation: `yp-bar${i+1} ${b.dur} ${b.delay} ease-in-out infinite` }} />
                ))}
              </div>
            )}
          </div>
          {descriptor && (isHost || isConfirmed) && (
            <span style={{ display: 'inline-block', marginTop: 3, fontSize: 11, fontFamily: "'DM Sans',sans-serif", color: 'var(--neon2)', whiteSpace: 'nowrap', maxWidth: '100%' }}>
              {descriptor}
            </span>
          )}
          {cleanLabel && (
            <div style={{ marginTop: 5 }}>
              <span style={{ display: 'inline-block', fontFamily: "'Bebas Neue',sans-serif", fontSize: 9, letterSpacing: 2, color: col, border: `1px solid ${col}`, padding: '2px 8px', borderRadius: 2 }}>
                {cleanLabel}
              </span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 4 }}>
          {claim?.mix_link && (isHost || isConfirmed) && (
            <button
              onClick={e => {
                e.stopPropagation();
                if (player?.url === claim.mix_link) { setPlayer(null); return; }
                const idx = allMixSlots.findIndex(m => m.url === claim.mix_link);
                const playlist = idx >= 0 ? allMixSlots.slice(idx + 1) : [];
                setPlayer({ url: claim.mix_link, artistName: claim.name, playlist });
              }}
              className={player?.url === claim.mix_link ? s.playBtnActive : ''}
              style={{
                width: 32, height: 32, borderRadius: '50%', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                transition: 'border-color .15s',
                border: player?.url === claim.mix_link ? '1.5px solid rgba(255,255,255,.45)' : '1px solid rgba(255,255,255,.2)',
                background: player?.url === claim.mix_link ? undefined : 'rgba(255,255,255,.06)',
              }}
            >
              <svg width="10" height="11" viewBox="0 0 9 10" fill={player?.url === claim.mix_link ? '#fff' : 'rgba(255,255,255,.8)'}><polygon points="0,0 9,5 0,10"/></svg>
            </button>
          )}
          {(isHost || isConfirmed) && <span className={s.slotChevron} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>}
        </div>
        </div>
      </div>

      {expanded && !isEmpty && (isHost || isConfirmed || claim) && (
        <div style={{ background: 'var(--card2)', border: `1px solid ${borderCol}`, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '14px 16px' }}>

          {/* Genre pills — when a card_pills value exists, this IS the performer's
              curated "Your 5 Tags" (their final identity), so it gets the
              signature Glow Pill. Falls back to the raw genre field otherwise,
              which keeps its existing look (that's not the curated 5). */}
          {(claim?.card_pills?.length || claim?.genre) && (() => {
            const usingCardPills = !!claim.card_pills?.length;
            const raw = usingCardPills ? claim.card_pills : claim.genre;
            const all = Array.isArray(raw)
              ? raw
              : raw.split(/[·,|/]+/).map(g => g.trim()).filter(Boolean);
            const SHOW = 6;
            const visible = genreShowAll ? all : all.slice(0, SHOW);
            const rest = all.length - visible.length;
            return (
              <div ref={genreShowAll ? null : pillHintRef} style={{ display: 'flex', flexWrap: genreShowAll ? 'wrap' : 'nowrap', gap: 5, marginBottom: 14, overflowX: genreShowAll ? 'visible' : 'auto', overflowY: 'hidden', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                {visible.map(g => (
                  usingCardPills
                    ? <span key={g} className="glow-pill" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{g}</span>
                    : <span key={g} style={{ fontSize: 10, fontFamily: "'DM Sans',sans-serif", background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.25)', color: '#fff', borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}>{g}</span>
                ))}
                {!genreShowAll && rest > 0 && (
                  <button onClick={e => { e.stopPropagation(); setGenreShowAll(true); }}
                    style={{ fontSize: 12, fontFamily: "'DM Sans',sans-serif", background: 'rgba(0,229,255,.05)', border: '1px solid rgba(0,229,255,.15)', color: 'var(--muted)', borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0 }}>
                    +{rest} more
                  </button>
                )}
              </div>
            );
          })()}

          {/* Public row — Follow | Social icons | View Full Profile */}
          {claim?.user_id && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              {/* Follow — left */}
              {session?.user?.id && (
                <button
                  onClick={async e => {
                    e.stopPropagation();
                    if (followBusy) return;
                    setFollowBusy(true);
                    if (followed) {
                      await supabase.from('follows').delete().eq('user_id', session.user.id).eq('entity_id', claim.user_id);
                      setFollowed(false);
                    } else {
                      const targetProfileId = await resolveProfileId(claim.user_id, 'artist');
                      // M6 (R6.1): from_profile_id is the follower (Personal);
                      // target_profile_id is who is being followed. Two ends,
                      // two columns — never conflate them.
                      const fromProfileId = await getPersonalProfileId(session.user.id);
                      await supabase.from('follows').insert({ user_id: session.user.id, from_profile_id: fromProfileId, entity_id: claim.user_id, entity_type: 'artist', entity_name: claim.name, target_profile_id: targetProfileId });
                      track(EVENTS.FOLLOWED, { entity_type: 'artist' });
                      setFollowed(true);
                    }
                    setFollowBusy(false);
                  }}
                  style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5, border: '1.5px solid transparent', background: 'linear-gradient(var(--card),var(--card)) padding-box, linear-gradient(135deg,#00E5FF,#BF5FFF) border-box', color: '#fff', display: 'flex', alignItems: 'center', gap: 5, transition: 'opacity .15s' }}
                >
                  {followed
                    ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> FOLLOWING</>
                    : <>+ FOLLOW</>
                  }
                </button>
              )}

              {/* Social icons — centre, brand colours */}
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 12, alignItems: 'center', opacity: 0.8 }}>
                {claim.instagram && (
                  <a href={socialProfileUrl('instagram', claim.instagram)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <defs><linearGradient id="ig" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#F58529"/><stop offset="40%" stopColor="#DD2A7B"/><stop offset="100%" stopColor="#8134AF"/></linearGradient></defs>
                      <rect x="2" y="2" width="20" height="20" rx="5" stroke="url(#ig)"/>
                      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" stroke="url(#ig)"/>
                      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" stroke="url(#ig)" strokeWidth="2.5"/>
                    </svg>
                  </a>
                )}
                {(claim.soundcloud || claim.mix_link?.includes('soundcloud')) && (
                  <a href={socialProfileUrl('soundcloud', claim.soundcloud) || ensureHttps(claim.mix_link)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
                    <svg width="20" height="14" viewBox="0 0 24 16" fill="#FF5500">
                      <path d="M1.4 9.8c0-.5.4-.9.9-.9s.9.4.9.9v3.8c0 .5-.4.9-.9.9s-.9-.4-.9-.9V9.8zm2.4-.9c0-.6.5-1.1 1.1-1.1s1.1.5 1.1 1.1v4.7c0 .6-.5 1.1-1.1 1.1S3.8 14.2 3.8 13.6V8.9zm2.5-.4c0-.7.6-1.3 1.3-1.3s1.3.6 1.3 1.3v5.1c0 .7-.6 1.3-1.3 1.3S6.3 14.3 6.3 13.6V8.5zm2.6-.3c0-.8.6-1.4 1.4-1.4s1.4.6 1.4 1.4v5.4c0 .8-.6 1.4-1.4 1.4s-1.4-.6-1.4-1.4V8.2zm2.7.1c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6v5.2c0 .9-.7 1.6-1.6 1.6s-1.6-.7-1.6-1.6V8.3zm2.7-.6c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v5.8c0 1-.8 1.8-1.8 1.8s-1.8-.8-1.8-1.8V7.7zm2.8 1.1c0-1 .8-1.9 1.9-1.9s1.9.8 1.9 1.9v4.5c0 1-.8 1.9-1.9 1.9s-1.9-.8-1.9-1.9V8.8zm3-2c-.1 0-.3 0-.4.1C21.3 3.9 18.9 2 16.1 2c-1 0-1.9.3-2.7.7-.3.2-.4.4-.4.5v10.4c0 .2.1.3.3.3h8.9c.7 0 1.3-.6 1.3-1.3V8.8c0-1.1-.9-2-2-2z"/>
                    </svg>
                  </a>
                )}
                {(claim.mixcloud || claim.mix_link?.includes('mixcloud')) && (
                  <a href={socialProfileUrl('mixcloud', claim.mixcloud) || ensureHttps(claim.mix_link)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
                    <svg width="22" height="14" viewBox="0 0 32 16" fill="#52AAD8">
                      <path d="M20 2c-3.3 0-6.1 2.2-6.9 5.2-.6-.4-1.3-.6-2.1-.6-2.2 0-3.9 1.8-3.9 4s1.7 4 3.9 4h13.1c2 0 3.6-1.6 3.6-3.6 0-1.8-1.3-3.3-3-3.5V7c0-3.3-2.7-5-4.7-5zM4.5 6C2 6.2 0 8.4 0 11v.1C-.9 11.5-1.5 12.5-1.5 13.5c0 1.7 1.3 3 3 3H2V6H1.5c-.7 0-1.3.3-1.8.6C-.7 5.5.1 4.5 1 3.8c.2-.2.5-.3.8-.4h.3c.4 0 .8.2 1.1.4l.2.3c-.4.2-.7.6-.9 1.2-.1.2-.1.5-.1.7H4.5z"/>
                    </svg>
                  </a>
                )}
                {claim.youtube && (
                  <a href={socialProfileUrl('youtube', claim.youtube)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
                    <svg width="20" height="14" viewBox="0 0 24 16" fill="#FF0000">
                      <path d="M23.5 2.5a3 3 0 0 0-2.1-2.1C19.5 0 12 0 12 0S4.5 0 2.6.4A3 3 0 0 0 .5 2.5 31 31 0 0 0 0 8a31 31 0 0 0 .5 5.5 3 3 0 0 0 2.1 2.1C4.5 16 12 16 12 16s7.5 0 9.4-.4a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 8a31 31 0 0 0-.5-5.5zM9.75 11.5v-7L16 8l-6.25 3.5z"/>
                    </svg>
                  </a>
                )}
                {claim.website && (
                  <a href={ensureHttps(claim.website)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  </a>
                )}
              </div>

              {/* View Full Profile — right */}
              <button
                onClick={e => { e.stopPropagation(); navigate(claim.profile_id ? `/profile/${claim.profile_id}?prefer=performer` : `/profile/${claim.user_id}?prefer=performer`); }}
                style={{ flexShrink: 0, fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1.5, background: 'none', border: 'none', padding: '5px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
              ><span style={{ background: 'linear-gradient(135deg,#00E5FF,#BF5FFF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>VIEW PROFILE →</span></button>
            </div>
          )}

          {/* Status */}
          {(() => {
            const claimStatus = claim?.status || (claim?.user_id ? 'pending' : 'name_added');
            const updatedAgo = (claim?.created_at || claim?.updated_at) ? (() => {
              const diff = Date.now() - new Date(claim.created_at || claim.updated_at).getTime();
              const days = Math.floor(diff / 86400000);
              const hrs  = Math.floor(diff / 3600000);
              if (days >= 1) return `${days} day${days !== 1 ? 's' : ''} ago`;
              if (hrs  >= 1) return `${hrs} hr${hrs  !== 1 ? 's' : ''} ago`;
              return 'just now';
            })() : null;

            const statusChip = {
              name_added: { label: 'NAME ADDED',  bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.15)', color: 'var(--muted)',  icon: null },
              pending:    { label: 'PENDING',      bg: 'rgba(255,184,48,.10)', border: 'rgba(255,184,48,.35)',  color: '#FFB830',        icon: null },
              confirmed:  { label: 'BOOKED',       bg: 'rgba(0,200,100,.10)',  border: 'rgba(255,255,255,.15)', color: '#00C864',
                icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> },
            }[claimStatus] || { label: claimStatus.toUpperCase(), bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.15)', color: 'var(--muted)', icon: null };

            const claimedByArtist = claimStatus === 'confirmed' && !!claim?.user_id;

            return isHost ? (
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, background: statusChip.bg, border: `1px solid ${statusChip.border}`, color: statusChip.color, borderRadius: 6, padding: '3px 10px' }}>
                    {statusChip.icon}{statusChip.label}
                  </span>
                  {claimedByArtist && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.15)', color: 'var(--muted)', borderRadius: 6, padding: '3px 10px' }}>
                      ACCEPTED BY ARTIST
                    </span>
                  )}
                  {isConfirmed && (
                    <button
                      onClick={e => { e.stopPropagation(); setConfirm('replace'); }}
                      style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, background: 'rgba(255,45,120,.08)', border: '1px solid rgba(255,45,120,.35)', color: '#fff', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background .15s, border-color .15s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,45,120,.2)'; e.currentTarget.style.borderColor = 'rgba(255,45,120,.6)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,45,120,.08)'; e.currentTarget.style.borderColor = 'rgba(255,45,120,.35)'; }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                      REPLACE ARTIST
                    </button>
                  )}
                </div>
              </div>
            ) : null;
          })()}

          {isHost && (
            <>
              {/* Primary action — only show big button when slot not yet confirmed */}
              {!isConfirmed && (
                <>
                  <button
                    onClick={e => { e.stopPropagation(); onFill?.(); }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--neon)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,45,120,.5)'}
                    style={{ width: '100%', padding: '12px 0', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,45,120,.5)', fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: 2, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background .15s' }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                    <span style={{ color: '#fff' }}>BOOK ARTIST</span>
                  </button>
                </>
              )}

              {/* Confirm dialog */}
              {confirm && (
                <div onClick={e => e.stopPropagation()} style={{ background: 'rgba(255,45,120,.08)', border: '1px solid rgba(255,45,120,.3)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
                  <p style={{ margin: '0 0 10px', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.2, color: '#fff' }}>
                    {confirm === 'remove' ? 'REMOVE this artist from the slot?' : 'REPLACE this artist with someone else?'}
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => { setConfirm(null); }}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.05)', fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2, color: 'var(--muted)', cursor: 'pointer' }}
                    >CANCEL</button>
                    <button
                      onClick={() => { setConfirm(null); if (confirm === 'remove') onRemove?.(); else onFill?.(); }}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: '#FF2D78', fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2, color: '#fff', cursor: 'pointer' }}
                    >{confirm === 'remove' ? 'YES, REMOVE' : 'YES, REPLACE'}</button>
                  </div>
                </div>
              )}

              {/* Manage actions — hidden when set times are locked */}
              {!locked && (
                <div style={{ paddingTop: 0, marginBottom: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <SlotManageBtn
                      icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>}
                      label="EDIT SLOT" sub="Time, duration & details"
                      accent="#4A9EFF"
                      onClick={e => { e.stopPropagation(); onEdit?.(); }}
                    />
                    <SlotManageBtn
                      icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
                      label={slot.pinned ? 'LOCKED' : 'LOCK SLOT'} sub="Prevent this slot from moving"
                      accent="#FFB830"
                      onClick={e => { e.stopPropagation(); onPin?.(); }}
                    />
                    <SlotManageBtn
                      icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>}
                      label="REMOVE" sub="Remove this artist from slot"
                      onClick={e => { e.stopPropagation(); setConfirm('remove'); }}
                      danger
                    />
                  </div>
                </div>
              )}

              {/* Notes accordion */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', marginTop: 4 }}>
                <button
                  onClick={e => { e.stopPropagation(); setNotesBoxOpen(v => !v); }}
                  style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0', display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  <span style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, color: 'var(--text)' }}>NOTES</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', flexShrink: 0, transform: notesBoxOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><polyline points="6 9 12 15 18 9"/></svg>
                </button>

                {notesBoxOpen && (
                  <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 10, padding: '4px 12px 12px', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 0 }}>

                    {/* Artist Brief */}
                    <div style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                      <button onClick={e => { e.stopPropagation(); setBriefOpen(v => !v); }} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '9px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
                        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: 'var(--text)' }}>ARTIST BRIEF</span>
                        <span style={{ fontSize: 10, color: 'var(--muted)', flex: 1, textAlign: 'left' }}>Visible to artist</span>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: briefOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                      {briefOpen && (
                        <div style={{ paddingBottom: 10 }} onClick={e => e.stopPropagation()}>
                          <textarea value={artistBrief} onChange={e => setArtistBrief(e.target.value)} onClick={e => e.stopPropagation()} placeholder="Arrive time, load-in instructions, set length, guest list…" rows={3}
                            style={{ width: '100%', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, color: 'var(--text)', padding: '8px 12px', fontSize: 12, outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
                          <div style={{ fontSize: 10, color: 'var(--neon2)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            Visible to artist
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Host Notes */}
                    <div style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                      <button onClick={e => { e.stopPropagation(); setHostNoteOpen(v => !v); }} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '9px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: 'var(--text)' }}>HOST NOTES</span>
                        <span style={{ fontSize: 10, color: 'var(--muted)', flex: 1, textAlign: 'left' }}>Private to organisers</span>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: hostNoteOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                      {hostNoteOpen && (
                        <div style={{ paddingBottom: 10 }} onClick={e => e.stopPropagation()}>
                          <textarea value={hostNote} onChange={e => setHostNote(e.target.value)} onClick={e => e.stopPropagation()} placeholder="Rider notes, agreements, anything relevant…" rows={3}
                            style={{ width: '100%', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, color: 'var(--text)', padding: '8px 12px', fontSize: 12, outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                            Only visible to organisers
                          </div>
                        </div>
                      )}
                    </div>

                    {/* History */}
                    <div>
                      <button onClick={e => { e.stopPropagation(); setHistoryOpen(v => !v); }} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '9px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4"/><polyline points="3 16 3 11 8 11"/></svg>
                        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: 'var(--text)' }}>HISTORY</span>
                        <span style={{ fontSize: 10, color: 'var(--muted)', flex: 1, textAlign: 'left' }}>Changes & activity</span>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: historyOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                      {historyOpen && (
                        <div style={{ paddingBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {claim?.created_at && (
                            <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                              <span>{claimStatus === 'name_added' ? 'Name added' : 'Booked'}</span>
                              <span>{(() => { const d = Date.now() - new Date(claim.created_at).getTime(); const days = Math.floor(d/86400000); const hrs = Math.floor(d/3600000); return days >= 1 ? `${days}d ago` : hrs >= 1 ? `${hrs}hr ago` : 'just now'; })()}</span>
                            </div>
                          )}
                          {claimStatus === 'confirmed' && claim?.updated_at && claim.updated_at !== claim.created_at && (
                            <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                              <span>Confirmed by artist</span>
                              <span>{(() => { const d = Date.now() - new Date(claim.updated_at).getTime(); const days = Math.floor(d/86400000); const hrs = Math.floor(d/3600000); return days >= 1 ? `${days}d ago` : hrs >= 1 ? `${hrs}hr ago` : 'just now'; })()}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SlotManageBtn({ icon, label, sub, onClick, accent = '#888', danger }) {
  const hex = danger ? '#FF2D78' : accent;
  const rgb = {
    '#4A9EFF': '74,158,255',
    '#FFB830': '255,184,48',
    '#FF2D78': '255,45,120',
    '#888':    '136,136,136',
  }[hex] || '136,136,136';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      <button onClick={onClick}
        onMouseEnter={e => { e.currentTarget.style.background = `rgba(${rgb},.2)`; e.currentTarget.style.borderColor = hex; }}
        onMouseLeave={e => { e.currentTarget.style.background = `rgba(${rgb},.07)`; e.currentTarget.style.borderColor = `rgba(${rgb},.35)`; }}
        style={{ width: '100%', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 6px', borderRadius: 10, border: `1px solid rgba(${rgb},.35)`, background: `rgba(${rgb},.07)`, cursor: 'pointer', transition: 'background .15s, border-color .15s' }}>
        <span style={{ color: hex, display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.2, color: hex, lineHeight: 1.1 }}>{label}</span>
      </button>
      <span style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.3, textAlign: 'center' }}>{sub}</span>
    </div>
  );
}

function EditIcon()   { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function InboxIcon()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>; }
function LockIcon()   { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>; }
function UnlockIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>; }
function CopyIcon()   { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>; }
function TrashIcon()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>; }

function ManageSection({ label, children }) {
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 4 }}>
      <p style={{ margin: 0, padding: '14px 20px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', fontFamily: "'Bebas Neue',sans-serif", fontSize: 11 }}>{label}</p>
      {children}
    </div>
  );
}

function ManageItem({ icon, label, onClick, danger, muted }) {
  return (
    <button onClick={onClick} style={{ display:'flex', alignItems:'center', gap:14, width:'100%', padding:'14px 20px', background:'none', border:'none', cursor:muted ? 'default' : 'pointer', textAlign:'left', fontFamily:'inherit', opacity:muted ? 0.38 : 1, borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ width:20, flexShrink:0, display:'flex', alignItems:'center', color: danger ? '#ff4d6d' : 'var(--muted)' }}>{icon}</span>
      <span style={{ fontSize:14, color: danger ? '#ff4d6d' : 'var(--text)', fontWeight:500, letterSpacing:'0.01em' }}>{label}</span>
      {muted && <span style={{ marginLeft:'auto', fontSize:10, color:'var(--muted)', letterSpacing:'0.08em', fontFamily:"'Bebas Neue',sans-serif" }}>SOON</span>}
    </button>
  );
}

// LineupMemberCard removed — LINEUP tab now uses ProfileCard directly
function LineupMemberCard({ member, perf, onGoToSetTimes, onRemove, onDiscard }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const isHeadliner = member.role === 'headliner';
  const accent    = isHeadliner ? '#BF5FFF' : '#00E5FF';
  const accentRgb = isHeadliner ? '191,95,255' : '0,229,255';

  let statusLabel, statusColor;
  if (!perf) {
    statusLabel = 'ON BILL';     statusColor = 'rgba(255,255,255,.35)';
  } else if (perf.status === 'draft') {
    statusLabel = 'DRAFT SLOT'; statusColor = 'rgba(255,255,255,.3)';
  } else if (perf.status === 'offered') {
    statusLabel = 'AWAITING';   statusColor = '#FF8C42';
  } else if (perf.status === 'accepted') {
    statusLabel = 'CONFIRMED';  statusColor = '#00E5A0';
  } else if (perf.status === 'declined') {
    statusLabel = 'DECLINED';   statusColor = '#FF3399';
  } else {
    statusLabel = 'ON BILL';     statusColor = 'rgba(255,255,255,.35)';
  }

  let pills = [];
  if (Array.isArray(member.card_pills)) {
    pills = member.card_pills;
  } else if (typeof member.card_pills === 'string' && member.card_pills) {
    try { pills = JSON.parse(member.card_pills); } catch { pills = [member.card_pills]; }
  }

  async function handleRemove() {
    if (busy) return;
    setBusy(true);
    await onRemove();
    setBusy(false);
  }

  async function handleDiscard() {
    if (busy) return;
    setBusy(true);
    await onDiscard();
    setBusy(false);
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--card)', border: `1px solid rgba(${accentRgb},.35)`,
        borderRadius: expanded ? '14px 14px 0 0' : 14,
        padding: '12px 14px', cursor: 'default',
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
          background: `rgba(${accentRgb},.1)`, border: `1.5px solid rgba(${accentRgb},.4)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}>🎵</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: '0.05em', color: '#fff', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {member.artist_name || '—'}
          </div>
          {(member.sound || member.genre) && (
            <div style={{ fontSize: 12, color: accent, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {member.sound || member.genre}
            </div>
          )}
          {member.role && (
            <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, marginTop: 2, fontFamily: "'Bebas Neue'" }}>
              {member.role.toUpperCase()}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <span style={{
            fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5,
            color: statusColor, border: `1px solid ${statusColor}`,
            borderRadius: 4, padding: '2px 7px',
          }}>{statusLabel}</span>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1,
              background: `rgba(${accentRgb},.1)`, border: `1px solid rgba(${accentRgb},.35)`,
              color: accent, borderRadius: 8, padding: '3px 8px', cursor: 'pointer',
            }}
          >{expanded ? 'HIDE ▲' : 'MANAGE ▼'}</button>
        </div>
      </div>

      {expanded && (
        <div style={{
          background: 'var(--card)', border: `1px solid rgba(${accentRgb},.35)`,
          borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '12px 18px',
        }}>
          {pills.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
              {pills.map((pill, i) => (
                <span key={i} style={{
                  background: `rgba(${accentRgb},.1)`, border: `1px solid rgba(${accentRgb},.3)`,
                  borderRadius: 20, fontSize: 10, padding: '2px 8px', color: accent,
                }}>{pill}</span>
              ))}
            </div>
          )}
          {perf && (
            <div style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 70, paddingTop: 2 }}>SLOT</div>
              <div style={{ fontSize: 13, color: perf.status === 'draft' ? 'rgba(255,255,255,.4)' : 'var(--text)', flex: 1 }}>
                {perf.status === 'draft' ? 'Draft — offer not sent yet' : `Assigned — ${perf.status}`}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            <button
              onClick={onGoToSetTimes}
              style={{
                width: '100%', fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5,
                padding: '8px 0', borderRadius: 8, cursor: 'pointer', transition: 'all .15s',
                background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.4)', color: '#00E5FF',
              }}
            >→ SET TIMES</button>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={handleRemove}
                disabled={busy}
                style={{
                  flex: 1, fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2,
                  padding: '8px 0', borderRadius: 8, cursor: busy ? 'default' : 'pointer',
                  opacity: busy ? .5 : 1, transition: 'all .15s',
                  background: 'rgba(255,140,66,.06)', border: '1px solid rgba(255,140,66,.25)', color: 'rgba(255,140,66,.9)',
                }}
              >UNASSIGN</button>
              <button
                onClick={handleDiscard}
                disabled={busy}
                style={{
                  flex: 1, fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2,
                  padding: '8px 0', borderRadius: 8, cursor: busy ? 'default' : 'pointer',
                  opacity: busy ? .5 : 1, transition: 'all .15s',
                  background: 'rgba(255,51,51,.06)', border: '1px solid rgba(255,51,51,.22)', color: 'rgba(255,80,80,.8)',
                }}
              >DISCARD</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
