// EP-00d · EVENT MANAGEMENT.
//
// Everything the owner can do to an event: the manage panel, the editor tabs,
// and every mutation behind them. It renders the public view and injects its
// own chrome into the two slots that view exposes, so the shipped DOM order is
// unchanged — but nothing in here is reachable from the public page, and a
// change to the public page cannot reach in here.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { resolvePerformerProfileId } from '../../lib/actingProfile';
import { writeNotification, writeNotifications } from '../../lib/writeNotification';
import { track, EVENTS } from '../../lib/analytics';
import { resolveProfileId } from '../../lib/resolveProfileId';
import ProfileCard from '../../components/ProfileCard';
import FillSlotModal from '../../components/FillSlotModal';
import EventTabBar from '../../components/EventTabBar';
import EventPublicView from './EventPublicView';
import EventPage from './EventPage';
import DaySlots from './DaySlots';
import SlotEditModal from './SlotEditModal';
import { EditIcon, InboxIcon, LockIcon, UnlockIcon, CopyIcon, TrashIcon, ManageSection, ManageItem } from './manageMenu';
import s from '../EventScreen.module.css';

export default function EventHostView({
  id, event, cfg, session, isGuest, ownerProfile, venueProfile,
  claims, days, lineupMembers, memberPerfMap, memberProfiles,
  poster, posterFull, genres, isPast,
  showTimesPublicly, totalSlots, takenSlots, lineupPct, isLocked, draftCount,
}) {
  const navigate    = useNavigate();
  const queryClient = useQueryClient();

  const [showManage,    setShowManage]    = useState(false);
  const [appCounts,     setAppCounts]     = useState({ total: 0, shortlisted: 0 });
  const [appsOpen,      setAppsOpen]      = useState(null);
  const [eventTab,      setEventTab]      = useState('LINEUP');
  const [showEditor,    setShowEditor]    = useState(false);
  const [allApps,       setAllApps]       = useState([]);
  const [appProfiles,   setAppProfiles]   = useState({});
  const [editingSlot,   setEditingSlot]   = useState(null);
  const [fillSlot,      setFillSlot]      = useState(null);
  const [assigningApp,  setAssigningApp]  = useState(null);
  const [localDays,     setLocalDays]     = useState(null);
  const [viewAsPunter,  setViewAsPunter]  = useState(false);
  const [goLiveConfirm, setGoLiveConfirm] = useState(false);
  const [sendingOffers, setSendingOffers] = useState(false);
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  // The owner is always the host here — `effectiveIsHost` is the one that can
  // be turned off, by the View-as-Punter preview.
  const isHost = true;
  const effectiveIsHost = !viewAsPunter;

  // `localDays` is the optimistic copy the slot editor writes to. It only ever
  // diverges from the fetched config between a save and the refetch, and it is
  // host state — which is why it lives here and not in useEventData.
  const effectiveDays = localDays ?? days;

  // Load applications + profiles for host
  useEffect(() => {
    // The shipped guard also tested `isRealEvent`. EventScreen returns the demo
    // notice before this component is ever rendered, so that term is now
    // provably true here and has been dropped rather than threaded through as a
    // constant.
    if (!id || !session?.user?.id) return;
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

  const shortList  = allApps.filter(a => a.status === 'tentative');
  const pipeline   = allApps.filter(a => a.status === 'pending');

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

  async function toggleAppsOpen() {
    const next = !appsOpen;
    setAppsOpen(next);
    await supabase.from('events').update({ applications_open: next }).eq('id', id);
  }

  const hostChrome = (
    <>
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
              // Keyed by the member row, not by artist_id — an imported member
              // has a profile and no artist_id, and the old lookup returned
              // null for every one of them.
              const prof = memberProfiles[member.id] || null;
              const perf = memberPerfMap[member.id];
              let badge, badgeColor;
              if (!perf)                       { badge = 'ON BILL';   badgeColor = 'rgba(255,255,255,.35)'; }
              else if (perf.status === 'draft')    { badge = 'DRAFT';     badgeColor = 'rgba(255,255,255,.35)'; }
              else if (perf.status === 'offered')  { badge = 'AWAITING';  badgeColor = '#FF8C42'; }
              else if (perf.status === 'accepted') { badge = 'CONFIRMED'; badgeColor = '#00E5A0'; }
              else if (perf.status === 'declined') { badge = 'DECLINED';  badgeColor = '#FF3399'; }
              const cardItem = {
                // ProfileCard routes on `id` first and falls back to user_id.
                // An unclaimed imported profile has no user, so without the id
                // its card is unclickable — the profile exists and cannot be
                // opened.
                id:           prof?.id || member.artist_profile_id || null,
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
    </>
  );

  const overlays = (
    <>
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
          eventName={event?.name || ''}
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
    </>
  );

  // ⚠ PUNTER VIEW MUST BE THE PUNTER'S PAGE (EP-01).
  //
  // The banner above says "this is how the event looks to the public". Once
  // /event/:id started serving the redesigned page, rendering the old markup
  // here would have made that sentence false — and false in the one place an
  // organiser goes specifically to check their event before sharing it.
  //
  // The editor keeps EventPublicView below: it carries the slot grid, the
  // chrome injection points and the day editor, and porting that surface is
  // its own job.
  if (viewAsPunter) {
    return (
      <>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '72px 16px 0' }}>{hostChrome}</div>
        <EventPage
          event={event}
          ownerProfile={ownerProfile}
          venueProfile={venueProfile}
          lineupMembers={lineupMembers}
          memberProfiles={memberProfiles}
          canFavourite={false}
          setTimes={showTimesPublicly && totalSlots > 0
            ? <DaySlots eventId={id} days={effectiveDays} claims={claims} allMixSlots={[]} isHost={false} editable={false} />
            : null}
        />
        {overlays}
      </>
    );
  }

  return (
    <EventPublicView
      id={id} event={event} cfg={cfg}
      poster={poster} posterFull={posterFull} genres={genres} isPast={isPast}
      claims={claims} days={effectiveDays}
      showTimesPublicly={showTimesPublicly}
      totalSlots={totalSlots} takenSlots={takenSlots}
      userId={session?.user?.id} isGuest={isGuest} ownerProfile={ownerProfile}
      hostChrome={hostChrome}
      overlays={overlays}
      host={{
        effectiveIsHost, showEditor, eventTab, isLocked,
        onFill:   slot          => setFillSlot({ slot }),
        onEdit:   (di, si, slot) => setEditingSlot({ dayIdx: di, slotIdx: si, slot }),
        onRemove: slot          => removeArtist(slot.id),
        onPin:    (di, si)      => togglePin(di, si),
      }}
    />
  );
}
