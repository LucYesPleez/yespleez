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
import { scopeToApplicant, fetchApplicantProfiles } from '../../lib/applicantProfiles';
import { findOpenAsksForDate, declineOpenAsks } from '../../lib/dateLockout';
import { durationLabel } from '../../lib/eventSlots';
import { memberState, STATE_COLOURS } from '../../lib/hostLineup';
import { normaliseStatus, rawStatusesFor, PIPELINE_BUCKETS } from '../../lib/enquiryUtils';
import { planUnassign, planRemoveFromBill, applyLineupPlan, notifiablePerformances, isReachable } from '../../lib/lineupActions';
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
  id, event, cfg, session, ownerProfile, venueProfile,
  claims, claimsBySlot = {}, days, lineupMembers, perfsByMember = {}, memberProfiles,
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
  /**
   * ⚠ A FAILED SLOT WRITE MUST SAY SO. Until L1 the host could not write these
   * rows at all on 22 real events, and RLS filters an UPDATE rather than
   * erroring it — so the screen reported success and changed nothing. Surfacing
   * the error is what makes that class of failure visible if it ever returns.
   */
  const [slotError,     setSlotError]     = useState('');
  /* Taking somebody off a bill is irreversible-looking and affects a real
     person, so it states exactly what it will do and waits. */
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [viewAsPunter,  setViewAsPunter]  = useState(false);
  const [goLiveConfirm, setGoLiveConfirm] = useState(false);
  // Everyone still queued for a date that has just been locked in. null until
  // a publish finds some — see the Go Live handler and lib/dateLockout.
  const [lockoutAsks,   setLockoutAsks]   = useState(null);
  const [lockoutBusy,   setLockoutBusy]   = useState(false);
  /**
   * ⚠⚠ THE DECLINE BUTTON IS DEAD FOR HALF A SECOND AFTER THE SHEET OPENS.
   *
   * Moving the destructive action away from the previous click position is not
   * enough on its own: this sheet appears unprompted, and a click already on
   * its way down can land on whatever arrives underneath it. An irreversible
   * bulk decline must not be reachable by a click aimed at something else.
   *
   * ⛔ Only the destructive button is disarmed. LEAVE THEM stays live — being
   * unable to dismiss a dialog you did not ask for would be its own bug.
   */
  const [lockoutArmed,  setLockoutArmed]  = useState(false);
  useEffect(() => {
    if (!lockoutAsks) { setLockoutArmed(false); return; }
    const t = setTimeout(() => setLockoutArmed(true), 500);
    return () => clearTimeout(t);
  }, [lockoutAsks]);
  const [sendingOffers, setSendingOffers] = useState(false);
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  // The owner is always the host here — `effectiveIsHost` is the one that can
  // be turned off, by the View-as-Punter preview.
  const isHost = true;
  const effectiveIsHost = !viewAsPunter;

  // L4 · `days` comes from `event_slots` and a save is a one-row update, so
  // there is nothing left for an optimistic copy to smooth over. `localDays` is
  // gone with the blob rewrite it existed to hide.
  const effectiveDays = days;

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
      // Same normaliser as the tab below it — a header that disagrees with the
      // list it sits above is worse than no header.
      setAppCounts({
        total: rows.length,
        shortlisted: rows.filter(a => normaliseStatus({ status: a.status, direction: 'incoming' }) === 'shortlisted').length,
      });
      setAllApps(rows);
      // M6 · keyed by applications.id, resolved by from_profile_id with the
      // legacy account fallback — see lib/applicantProfiles.js.
      const map = await fetchApplicantProfiles(supabase, rows,
        'id, user_id, name, avatar, type, sound, genre_string, location, bio, mix_link, card_pills, vibe_tags');
      if (!cancelled) setAppProfiles(map);
    }
    loadApps();
    return () => { cancelled = true; };
  }, [id, session?.user?.id]);

  /**
   * Clearing ONE slot from the set-times grid.
   *
   * ⭐ THE SAME ACT AS "CLEAR SET TIME" ON THE LINEUP TAB, so it goes through
   * the same rules — ⛔ it used to carry its own copy, and they disagreed: this
   * one notified on ANY status (including a draft nobody was sent) and wrote
   * `tentative` back onto the applicant's row.
   *
   * ⚠ SCOPED TO THE ONE SLOT, not to the member. An act playing two slots keeps
   * the other one, which is why `planUnassign` is given a single performance
   * here rather than everything the member holds.
   */
  async function removeArtist(slotId) {
    const claim = claims[slotId];
    if (!claim) return;
    const member = lineupMembers.find(m => m.id === claim.member_id);
    if (!member) return;
    const thisPerf = memberPerfs(member.id).filter(p => p.id === claim.id);
    await runLineupAction(planUnassign(member, thisPerf), member);
  }

  /** Every performance a member holds — the array, not the last one. */
  function memberPerfs(memberId) {
    return perfsByMember[memberId] || [];
  }

  /**
   * ⭐ ONE EXECUTOR FOR BOTH LINEUP ACTIONS.
   *
   * The plan says what happens; this does it and tells the artist only what
   * they were actually told about. `lib/lineupActions` holds the rules and the
   * reasoning — ⛔ do not re-derive either here.
   */
  async function runLineupAction(plan, member) {
    /**
     * ⚠ WHAT THE PLAN IS ACTUALLY REMOVING, not everything the member holds.
     * Clearing one slot from the grid must not notify about a second slot they
     * still have — and `removeArtist` passes exactly one performance for that
     * reason.
     */
    const acting = memberPerfs(member.id).filter(p => plan.deletePerformanceIds.includes(p.id));
    const sent   = notifiablePerformances(acting);
    const { ok, error } = await applyLineupPlan(supabase, plan);
    if (!ok) { setSlotError(error || 'That change was not saved.'); return; }

    /**
     * ⚠ ONLY IF THEY WERE EVER SENT SOMETHING. A `draft` slot was never
     * announced, so "you have been removed from a slot" would announce the
     * booking and cancel it in one message. And a hand-entered act has no
     * account to write to at all.
     */
    if (sent.length && isReachable(member)) {
      await writeNotification({
        toUserId:       member.artist_id,
        toProfileId:    (await resolvePerformerProfileId(member.artist_id)).profileId ?? null,
        aboutProfileId: event.owner_profile_id ?? null,
        type:    'slot_removed',
        message: plan.kind === 'remove-from-bill'
          ? `You are no longer on the lineup for ${event.name}.`
          : `Your set time at ${event.name} has been removed. You are still on the lineup.`,
        data:    { event_id: id, event_name: event.name },
      });
    }
    setConfirmRemove(null);
    queryClient.invalidateQueries({ queryKey: ['event', id] });
  }

  async function publishSetTimes() {
    if (sendingOffers) return;
    setSendingOffers(true);
    const { data: drafts } = await supabase
      .from('performances')
      .select('id, slot_id, lineup_members(artist_id, artist_profile_id, artist_name)')
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
        // M6 · one update per APPLICANT, narrowed to the profile the host
        // booked. De-duplicated by profile where there is one, by account only
        // for members that never got a profile id.
        const applicants = new Map();
        withArtist.forEach(d => {
          const pid = d.lineup_members.artist_profile_id || null;
          const uid = d.lineup_members.artist_id;
          applicants.set(pid || uid, { pid, uid });
        });
        await Promise.all([...applicants.values()].map(({ pid, uid }) =>
          scopeToApplicant(
            /* ⚠ `accepted`, NOT `offered`. Sending someone a set time means the
               HOST has said yes — that is the host decision this column
               records. The OFFER itself is `performances.status='offered'` +
               `offered_at`, which the update above already wrote. */
            supabase.from('applications').update({ status: 'accepted' }).eq('event_id', id),
            pid, uid,
          ).in('status', [...rawStatusesFor('new'), ...rawStatusesFor('shortlisted')])
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

  /**
   * L4 · A SLOT EDIT IS A ROW UPDATE.
   *
   * ⭐ This used to rebuild the whole `config.days` array and write the entire
   * blob back, which is why `localDays` existed: the write was slow, total, and
   * raced anything else editing the same event. One row, one update — so the
   * optimistic copy has nothing left to be optimistic about and is gone.
   *
   * ⚠ `dur` ARRIVES AS A NUMBER OR NULL from SlotEditModal. `dur_mins` is NOT
   * NULL with a default, so a cleared field must fall back rather than write
   * null — otherwise clearing the duration would fail the constraint and the
   * save would silently do nothing.
   */
  async function saveSlot(slotId, updated) {
    const { error } = await supabase.from('event_slots').update({
      time:        updated.time || null,
      ampm:        updated.ampm || null,
      dur_mins:    Number.isFinite(Number(updated.dur)) && Number(updated.dur) > 0 ? Number(updated.dur) : 60,
      label:       updated.label || null,
      label_color: updated.labelColor || null,
      updated_at:  new Date().toISOString(),
    }).eq('id', slotId);
    if (error) { setSlotError(error.message); return; }
    setEditingSlot(null);
    queryClient.invalidateQueries({ queryKey: ['event', id] });
  }

  /**
   * ⚠ THE CURRENT VALUE IS PASSED IN, not re-derived from an index.
   *
   * The old version looked the slot up by `days[dayIdx].slots[slotIdx]`, so any
   * reorder between render and click pinned the wrong slot. The card knows
   * which slot it is; it says so.
   */
  async function togglePin(slot) {
    if (!slot?.id) return;
    const { error } = await supabase.from('event_slots')
      .update({ pinned: !slot.pinned, updated_at: new Date().toISOString() })
      .eq('id', slot.id);
    if (error) { setSlotError(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ['event', id] });
  }

  /**
   * ⚠⚠ THESE TWO TABS WERE PERMANENTLY EMPTY ON EVERY EVENT.
   *
   * `'tentative'` and `'pending'` have ZERO rows in production. The host
   * surfaces write through `EnquiryCard`, whose buttons emit the enquiry
   * vocabulary (`seen` / `shortlisted` / `accepted` / `declined`), while these
   * filters were written against the older booking vocabulary. Neither filter
   * has matched a real row since the two diverged.
   *
   * ⭐ `normaliseStatus` is the one place both vocabularies already meet, and
   * it sends anything unrecognised to 'new' rather than dropping it — so an
   * application can no longer become invisible by being spelled differently.
   */
  const bucketOf   = a => normaliseStatus({ status: a.status, direction: 'incoming' });
  const shortList  = allApps.filter(a => bucketOf(a) === 'shortlisted');
  /**
   * ⚠⚠ `new` AND `seen`. Matching `new` alone meant OPENING an application
   * dropped it out of the queue, because `EnquiryCard` auto-writes `seen` on
   * expand. Bass Heavy's PIPELINE read empty with an application sitting in it.
   * See PIPELINE_BUCKETS — reading is not deciding.
   */
  const pipeline   = allApps.filter(a => PIPELINE_BUCKETS.includes(bucketOf(a)));
  /**
   * ⭐ ACCEPTED HAD NO HOME. Ten of the thirteen applications in production are
   * `accepted`, and no tab rendered them — the host said yes and nothing on
   * screen showed it. This tab makes them visible.
   *
   * ⛔ VISIBLE, NOT ACTED ON. Nothing here creates a `lineup_member`; the
   * SHORT LIST → LINEUP transition is deliberately not built yet, and an
   * accepted application still does not gate the bill.
   */
  const acceptedApps = allApps.filter(a => bucketOf(a) === 'accepted');

  async function doAssign(slot) {
    if (!assigningApp) return;
    const { app: aApp, prof: aProf } = assigningApp;
    const artistName = aProf?.name || aApp.artist_name || '—';
    const slotTime = [slot.time, slot.ampm].filter(Boolean).join(' ');
    // Upsert lineup_member for this artist
    let { data: memberData } = await supabase.from('lineup_members').select('id').eq('event_id', id).eq('artist_id', aApp.artist_id).maybeSingle();
    if (!memberData) {
      // M6 · the application already names the profile that applied. Ask it
      // first; `resolveProfileId` guesses from the account and can only ever
      // return an 'artist' — wrong for a band or a comedian.
      const artistProfileId = aApp.from_profile_id
        || await resolveProfileId(aApp.artist_id, 'artist');
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
      /* Same rule as publishSetTimes: giving somebody a slot IS the host
         saying yes. The slot offer lives on the performance created above. */
      supabase.from('applications').update({ status: 'accepted' }).eq('id', aApp.id),
      writeNotification({
        toUserId:       aApp.artist_id,
        toProfileId:    (await resolvePerformerProfileId(aApp.artist_id)).profileId ?? null,
        aboutProfileId: event.owner_profile_id ?? null,
        type:    'slot_offer',
        message: `You've been offered a slot${slotTime ? ` at ${slotTime}` : ''} at ${event.name}.`,
        data:    { performance_id: perf?.id, event_id: id, event_name: event.name, slot_id: slot.id, slot_time: slotTime, artist_name: artistName, host_id: session?.user?.id },
      }),
    ]);
    // The optimistic update must match the write above, or the screen and the
    // database disagree until the next refetch.
    setAllApps(prev => prev.map(a => a.id === aApp.id ? { ...a, status: 'accepted' } : a));
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
            { key: 'ACCEPTED',  label: `ACCEPTED${acceptedApps.length ? ` (${acceptedApps.length})` : ''}` },
          ]}
        />
      )}

      {/* ⚠ A SLOT WRITE THAT FAILED MUST SAY SO. RLS filters an UPDATE rather
          than erroring it, so a silent failure looks exactly like success —
          which is how 22 events sat un-editable without anyone noticing. */}
      {effectiveIsHost && showEditor && slotError && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(255,45,120,.1)', border: '1px solid rgba(255,45,120,.35)' }}>
          <span style={{ fontSize: 12.5, color: '#FF2D78', lineHeight: 1.5 }}>
            That slot could not be saved. Nothing was changed. {slotError}
          </span>
          <button onClick={() => setSlotError('')} style={{ background: 'none', border: 'none', color: '#FF2D78', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
        </div>
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
          {/* Sent and locked. Says nothing about public visibility, which is a
              separate decision made by the toggle above. */}
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5, color: '#00E5A0' }}>● SET TIMES SENT · LOCKED</span>
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
            {/* ⚠ "SEND", NOT "PUBLISH". This notifies the artists and locks the
                running order; it does NOT put anything in front of the public.
                The control that does is the SET TIMES PUBLIC toggle above, and
                both were called "publish" — so an organiser pressing this
                reasonably believed the timetable was now on the event page. */}
            {sendingOffers ? '● SENDING…' : '● SEND SET TIMES TO ARTISTS'}
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
              /**
               * ⭐ ONE DEFINITION OF WHAT STATE AN ACT IS IN, shared with the
               * host dashboard. This ladder was written out longhand here and
               * again there, and they had already drifted: this one read the
               * LAST performance per member and had no rule for a hand-entered
               * act, so somebody typed in by the organiser showed as AWAITING a
               * reply from nobody, forever.
               */
              const badge      = memberState(member, memberPerfs(member.id));
              const badgeColor = STATE_COLOURS[badge];
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
                      {/* ⚠⚠ THESE TWO WERE THE SAME OPERATION. Both deleted the
                          performances AND the lineup_members row; only the
                          write-back to `applications` differed, so the record
                          the action did NOT touch was the one that decided how
                          destructive it was. See lib/lineupActions.

                          ⛔ CLEAR SET TIME is only offered when there IS one.
                          A control that acts on nothing is not a control. */}
                      {memberPerfs(member.id).length > 0 && (
                        <button onClick={() => runLineupAction(planUnassign(member, memberPerfs(member.id)), member)}
                          style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,140,66,.4)', background: 'rgba(255,140,66,.08)', color: '#FF8C42', cursor: 'pointer', whiteSpace: 'nowrap' }}
                          title="Take back the set time. They stay on the bill.">CLEAR SET TIME</button>
                      )}
                      <button onClick={() => setConfirmRemove({ member, perfs: memberPerfs(member.id) })}
                        style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,51,51,.3)', background: 'rgba(255,51,51,.06)', color: 'rgba(255,80,80,.8)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        title="Take them off the bill entirely.">REMOVE FROM BILL</button>
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
              const prof = appProfiles[app.id] || {};
              // ProfileCard routes on `id` first: without it an unclaimed
              // applicant's card is unclickable (same rule as the lineup cards
              // above). `user_id` stays for the legacy route.
              const cardItem = { id: prof.id || null, user_id: app.artist_id, name: prof.name || app.artist_name, type: prof.type || 'artist', avatar: prof.avatar || null, avatar_thumb: prof.avatar_thumb || null, sound: prof.sound || null, genre_string: prof.genre_string || null, location: prof.location || null, state: prof.state || null };
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
            /* ⚠ "Nothing waiting on you", not "no pending applications" — the
               tab now holds `new` AND `seen`, so "pending" is the wrong word
               for what is or is not in it. */
            ? <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '32px 0' }}>Nothing waiting on you.</p>
            : pipeline.map(app => {
              const prof = appProfiles[app.id] || {};
              // ProfileCard routes on `id` first: without it an unclaimed
              // applicant's card is unclickable (same rule as the lineup cards
              // above). `user_id` stays for the legacy route.
              const cardItem = { id: prof.id || null, user_id: app.artist_id, name: prof.name || app.artist_name, type: prof.type || 'artist', avatar: prof.avatar || null, avatar_thumb: prof.avatar_thumb || null, sound: prof.sound || null, genre_string: prof.genre_string || null, location: prof.location || null, state: prof.state || null };
              return (
                <ProfileCard key={app.id} item={cardItem}
                  actions={
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <button onClick={() => { supabase.from('applications').update({ status: 'shortlisted' }).eq('id', app.id); setAllApps(prev => prev.map(a => a.id === app.id ? { ...a, status: 'shortlisted' } : a)); }} style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(0,229,255,.4)', background: 'rgba(0,229,255,.08)', color: 'var(--neon2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>SHORTLIST</button>
                      <button onClick={() => { supabase.from('applications').update({ status: 'declined' }).eq('id', app.id); setAllApps(prev => prev.map(a => a.id === app.id ? { ...a, status: 'declined' } : a)); }} style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,51,51,.3)', background: 'rgba(255,51,51,.06)', color: 'rgba(255,80,80,.8)', cursor: 'pointer', whiteSpace: 'nowrap' }}>DECLINE</button>
                    </div>
                  }
                />
              );
            })
          }
        </div>
      )}

      {/**
        * ACCEPTED tab — the ten applications that had nowhere to appear.
        *
        * ⛔ READ-ONLY BY DESIGN. There is no ADD TO BILL here: the
        * SHORT LIST → LINEUP transition is not built, and an accepted
        * application must never become bill membership on its own. This tab
        * says "you said yes to these people" and nothing more.
        *
        * ⚠ The only action offered is the one that is unambiguously the host's
        * to take back — a decline. It writes `applications.status` and touches
        * nothing else.
        */}
      {effectiveIsHost && showEditor && eventTab === 'ACCEPTED' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {acceptedApps.length === 0
            ? <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '32px 0' }}>Nobody accepted yet.</p>
            : <>
              {/* ⚠ Says what this tab is NOT, because the obvious reading of
                  "accepted" is "on the bill" and that is not what it means. */}
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 4px', lineHeight: 1.5 }}>
                You said yes to these applications. Adding them to the bill is still a separate step.
              </p>
              {acceptedApps.map(app => {
                const prof = appProfiles[app.id] || {};
                const cardItem = { id: prof.id || null, user_id: app.artist_id, name: prof.name || app.artist_name, type: prof.type || 'artist', avatar: prof.avatar || null, avatar_thumb: prof.avatar_thumb || null, sound: prof.sound || null, genre_string: prof.genre_string || null, location: prof.location || null, state: prof.state || null };
                /* ⚠ Is this accepted applicant ALREADY on the bill? Answered
                   from `lineup_members`, which is the source of truth — the
                   application cannot tell you, and that is the whole point of
                   the separation. */
                const onBill = lineupMembers.some(m =>
                  (app.from_profile_id && m.artist_profile_id === app.from_profile_id) ||
                  (app.artist_id && m.artist_id === app.artist_id));
                return (
                  <ProfileCard key={app.id} item={cardItem}
                    badge={onBill ? 'ON THE BILL' : 'NOT ON THE BILL'}
                    badgeColor={onBill ? '#00E5A0' : 'rgba(255,255,255,.35)'}
                    actions={
                      <button onClick={() => { supabase.from('applications').update({ status: 'declined' }).eq('id', app.id); setAllApps(prev => prev.map(a => a.id === app.id ? { ...a, status: 'declined' } : a)); }} style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,51,51,.3)', background: 'rgba(255,51,51,.06)', color: 'rgba(255,80,80,.8)', cursor: 'pointer', whiteSpace: 'nowrap' }}>DECLINE</button>
                    }
                  />
                );
              })}
            </>
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
          onSave={updated => saveSlot(editingSlot.slot.id, updated)}
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
                /**
                 * ⭐ THE DATE IS NOW SPOKEN FOR — so ask about everyone still
                 * queued for it (owner, 2026-08-11).
                 *
                 * ⛔ AFTER the publish, never as a condition of it. Publishing
                 * must succeed on its own; a failure to look up the funnel
                 * cannot be allowed to block going live.
                 *
                 * ⛔ The venue's enquiries are only ever included when THIS
                 * account owns that venue. Publishing an event at someone
                 * else's room does not grant the right to answer their mail.
                 */
                if (!error) {
                  const ownsVenue = !!venueProfile?.user_id && venueProfile.user_id === session?.user?.id;
                  const found = await findOpenAsksForDate({
                    supabase, eventId: id, date: cfg?.date || null,
                    venueProfileId: ownsVenue ? venueProfile.id : null,
                  });
                  if (found.applications.length + found.enquiries.length > 0) setLockoutAsks(found);
                }
              }}
                style={{ flex: 1, padding: '13px 0', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, borderRadius: 10, border: 'none', background: '#00E5A0', color: '#0a0a14', cursor: 'pointer' }}>
                GO LIVE
              </button>
            </div>
          </div>
        </div>
      )}

      {/**
        * ⭐ THE DATE IS LOCKED — CLEAR THE FUNNEL BY ANSWERING IT.
        *
        * ⛔ NOT a silent filter. Everyone listed here is waiting on a reply; the
        * only honest way to take them out of the funnel is to actually decline
        * them, which notifies each one. Hiding them would leave real people
        * waiting on an answer nobody was ever prompted to give.
        *
        * ⛔ NOT automatic either. This is a bulk decline of real people, so it
        * states exactly who it will touch and does nothing until the promoter
        * says so. LEAVE THEM is a first-class answer — the event is already
        * live either way.
        */}
      {lockoutAsks && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 3000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 'var(--yp-safe-bottom)' }}
          onClick={e => e.target === e.currentTarget && !lockoutBusy && setLockoutAsks(null)}>
          <div style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: '28px 24px 40px', border: '1px solid rgba(255,255,255,.08)', borderBottom: 'none' }}>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: '#fff' }}>
              This date is now confirmed.
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', marginTop: 8, lineHeight: 1.6 }}>
              {(() => {
                const a = lockoutAsks.applications.length;
                const e = lockoutAsks.enquiries.length;
                const parts = [
                  a > 0 && `${a} unanswered application${a !== 1 ? 's' : ''} to this event`,
                  e > 0 && `${e} unanswered enquir${e !== 1 ? 'ies' : 'y'} for ${lockoutAsks.date}`,
                ].filter(Boolean);
                return `${parts.join(' and ')} ${a + e !== 1 ? 'are' : 'is'} still open. Decline them and let each person know?`;
              })()}
            </div>
            {/* ⚠ Says what is NOT swept, so a promoter never has to wonder
                whether their short list just went with it. */}
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginTop: 10, lineHeight: 1.5 }}>
              Anyone you shortlisted, offered a slot or already accepted is left alone.
            </div>
            {/**
              * ⚠⚠ THE DESTRUCTIVE BUTTON IS ON THE LEFT, AND THE SAFE ONE
              * INHERITS THE PREVIOUS CLICK POSITION. Found the hard way while
              * testing this on 2026-08-11: this sheet OPENS ITSELF straight
              * after GO LIVE, in the same place, and GO LIVE sits on the right.
              * With the confirm button in the conventional right-hand slot, a
              * second GO LIVE click — a double-tap, an impatient retry when the
              * first seems not to register — lands on it and silently commits
              * an irreversible bulk decline. It happened on the very first run,
              * and the dialog was never even seen.
              *
              * ⛔ So the app's usual "primary on the right" does NOT apply to a
              * sheet nobody asked to open. Whatever occupies the spot the user
              * just clicked must be the harmless choice.
              */}
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button disabled={lockoutBusy || !lockoutArmed} onClick={async () => {
                setLockoutBusy(true);
                await declineOpenAsks({
                  supabase, writeNotification,
                  applications: lockoutAsks.applications,
                  enquiries:    lockoutAsks.enquiries,
                  eventName:    event?.name || null,
                  venueName:    venueProfile?.name || null,
                  // Legacy rows carry no applicant profile id; the seam resolves
                  // one rather than addressing the notice to nobody.
                  resolveToProfileId: async uid => (await resolvePerformerProfileId(uid)).profileId ?? null,
                });
                setLockoutBusy(false);
                setLockoutAsks(null);
                queryClient.invalidateQueries({ queryKey: ['event', id] });
              }}
                style={{ flex: 1, padding: '13px 0', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, borderRadius: 10, border: 'none', background: '#FF2D78', color: '#0a0a14', cursor: (lockoutBusy || !lockoutArmed) ? 'default' : 'pointer', opacity: (lockoutBusy || !lockoutArmed) ? .5 : 1 }}>
                {lockoutBusy ? 'DECLINING…' : 'DECLINE & NOTIFY'}
              </button>
              {/* The safe choice, in the slot GO LIVE just occupied. */}
              <button disabled={lockoutBusy} onClick={() => setLockoutAsks(null)}
                style={{ flex: 1, padding: '13px 0', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.55)', cursor: lockoutBusy ? 'default' : 'pointer' }}>
                LEAVE THEM
              </button>
            </div>
          </div>
        </div>
      )}

      {/**
        * ⭐ TAKING SOMEBODY OFF A BILL STATES WHAT IT WILL DO, AND WHAT IT WILL
        * NOT. The old DISCARD button did this instantly, hard-deleted the row,
        * and silently wrote `declined` onto their application.
        *
        * ⚠ THE DESTRUCTIVE BUTTON IS ON THE LEFT. Same rule the publish sweep
        * had to learn: whatever occupies the position of the click that opened
        * a sheet must be the harmless choice. REMOVE FROM BILL sits in the
        * card's right-hand action column, so CANCEL takes the right.
        */}
      {confirmRemove && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 3000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 'var(--yp-safe-bottom)' }}
          onClick={e => e.target === e.currentTarget && setConfirmRemove(null)}>
          <div style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: '28px 24px 40px', border: '1px solid rgba(255,255,255,.08)', borderBottom: 'none' }}>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: '#fff' }}>
              Take {confirmRemove.member.artist_name || 'this act'} off the bill?
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', marginTop: 8, lineHeight: 1.6 }}>
              {(() => {
                const sent = notifiablePerformances(confirmRemove.perfs).length;
                const held = confirmRemove.perfs.length;
                const parts = [];
                if (held) parts.push(`Their ${held === 1 ? 'set time' : `${held} set times`} will be cleared.`);
                if (sent && isReachable(confirmRemove.member)) parts.push('They will be told.');
                else if (held) parts.push('Nothing was sent to them, so they will not be notified.');
                return parts.join(' ') || 'They hold no set times, so nothing else changes.';
              })()}
            </div>
            {/* ⚠ Says what is NOT touched, so nobody has to wonder whether this
                also rejected their application. It does not: declining an
                applicant is its own control, on the SHORT LIST. */}
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginTop: 10, lineHeight: 1.5 }}>
              Their application is left exactly as it is, and you can put them back on the bill later.
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button onClick={() => runLineupAction(planRemoveFromBill(confirmRemove.member, confirmRemove.perfs), confirmRemove.member)}
                style={{ flex: 1, padding: '13px 0', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, borderRadius: 10, border: 'none', background: '#FF2D78', color: '#0a0a14', cursor: 'pointer' }}>
                REMOVE FROM BILL
              </button>
              <button onClick={() => setConfirmRemove(null)}
                style={{ flex: 1, padding: '13px 0', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.55)', cursor: 'pointer' }}>
                CANCEL
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
          acceptedArtists={shortList}
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
              {days.flatMap(d => d.slots || []).length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>No slots yet — add slots in the LINEUP editor first.</p>
              )}
              {days.flatMap(d => d.slots || []).map(slot => {
                const existing = claims[slot.id];
                const isFilled = existing && existing.status !== 'declined';
                const timeLabel = [slot.time, slot.ampm].filter(Boolean).join(' ');
                /* ⚠ WAS `slot.dur >= 60 ? … : `${slot.dur}m``, which printed
                   `1.5 hrsm` for every slot whose `dur` was the string
                   "1.5 hrs" — the comparison is false against a string, so it
                   fell to the minutes branch and concatenated the unit twice.
                   `durationLabel` is the one formatter now. */
                const durLabel  = durationLabel(slot.dur);
                /* Every act on the slot, not just the one the map picked. On a
                   contested slot "Currently: X" was naming one of two at
                   random. */
                const onSlot    = claimsBySlot[slot.id] || (existing ? [existing] : []);
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
                      {isFilled && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginTop: 2 }}>Currently: {onSlot.map(c => c.name).filter(Boolean).join(' · ')}</div>}
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
      userId={session?.user?.id} ownerProfile={ownerProfile}
      hostChrome={hostChrome}
      overlays={overlays}
      host={{
        effectiveIsHost, showEditor, eventTab, isLocked,
        onFill:   slot          => setFillSlot({ slot }),
        onEdit:   slot => setEditingSlot({ slot }),
        onRemove: slot => removeArtist(slot.id),
        onPin:    slot => togglePin(slot),
      }}
    />
  );
}
