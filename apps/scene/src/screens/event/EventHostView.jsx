// EP-00d · EVENT MANAGEMENT.
//
// Everything the owner can do to an event: the manage panel, the editor tabs,
// and every mutation behind them. It renders the public view and injects its
// own chrome into the two slots that view exposes, so the shipped DOM order is
// unchanged — but nothing in here is reachable from the public page, and a
// change to the public page cannot reach in here.
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { resolvePerformerProfileId } from '../../lib/actingProfile';
import { writeNotification, writeNotifications } from '../../lib/writeNotification';
import { track, EVENTS } from '../../lib/analytics';
import { resolveProfileId } from '../../lib/resolveProfileId';
/* ⛔ `scopeToApplicant` left with publishSetTimes (P6.3d-1): it existed to rewrite
   applications.status in bulk, which a send no longer does. */
import { fetchApplicantProfiles } from '../../lib/applicantProfiles';
import { findOpenAsksForDate, declineOpenAsks } from '../../lib/dateLockout';
import { memberState, STATE_COLOURS, billCapacity, billFullMessage, bookedMemberRows } from '../../lib/hostLineup';
import { shortlistEntries } from '../../lib/shortlist';
import { notifyState } from '../../lib/notifyPlan';
/* ⭐ P6.3 · the sender. The rule lives there; this screen only resolves who and reports what happened. */
import { sendSlotNotice } from '../../lib/notifySender';
import { setTimesEnabled } from '../../lib/eventSetTimes';
import { normaliseStatus, PIPELINE_BUCKETS, STATUS_TAB_COLOR } from '../../lib/enquiryUtils';
import { planUnassign, planMoveToShortlist, planRemoveFromEvent, executeLineupPlan, assignMemberToSlot, planPublishSetTimes, applyPublishSetTimes, notifiablePerformances, isReachable } from '../../lib/lineupActions';
import { planAddToBill, addToBill, findExistingMember } from '../../lib/lineupFromApplication';
import { PROFILE_CARD_META_COLUMNS } from '../../components/ProfileCard';
import WorkItemCard, { applicationWorkState, lineupWorkState } from '../../components/WorkItemCard';
/**
 * ⚠⚠ MORE INFO IS `neutral` GLASS, ⛔ NOT `DetailBtn` (owner, 2026-08-15).
 *
 * `DetailBtn` carries the card's own ACCENT and is built to sit FULL-WIDTH ON
 * ITS OWN LINE above a decision row — which is exactly how EnquiryCard uses
 * it. Dropped inline as an equal-width peer it became the brightest control on
 * every card: a filled teal slab outshouting CLEAR SET TIME, and competing
 * with ASSIGN SET TIME on the one row that has real work outstanding.
 *
 * ⛔ Navigation must never out-weigh the operation. That is the same rule
 * index.css already states for the decisions themselves ("Accept must never
 * out-weigh Shortlist"), applied to the control that commits to nothing.
 */
import { DecisionBtn, StarIcon, CheckIcon, XIcon } from '../../components/DecisionButtons';
import FillSlotModal from '../../components/FillSlotModal';
import AssignSlotSheet from '../../components/AssignSlotSheet';
import ShortlistArtistSheet from '../../components/ShortlistArtistSheet';
import { planAddArtistToShortlist, addArtistToShortlist } from '../../lib/shortlistFromArtist';
import EventTabBar from '../../components/EventTabBar';
import EventPublicView from './EventPublicView';
import EventPage from './EventPage';
import SchedulePortrait from './SchedulePortrait';
import SlotEditModal from './SlotEditModal';
import { EditIcon, InboxIcon, LockIcon, UnlockIcon, CopyIcon, TrashIcon, QrIcon, ManageSection, ManageItem } from './manageMenu';
import QrCodeCreator from '../../components/QrCodeCreator';
import { addSlotBefore } from '../../lib/eventSlots';
import s from '../EventScreen.module.css';

export default function EventHostView({
  id, event, cfg, session, ownerProfile, venueProfile,
  claims, claimsBySlot = {}, days, lineupMembers, shortlistMembers = [], perfsByMember = {}, memberProfiles,
  poster, posterFull, genres, isPast,
  showTimesPublicly, totalSlots, takenSlots, lineupPct, isLocked, schedule, slots: slotRows = [],
}) {
  const navigate    = useNavigate();
  const queryClient = useQueryClient();

  const [showManage,    setShowManage]    = useState(false);
  const [appCounts,     setAppCounts]     = useState({ total: 0, shortlisted: 0 });
  const [appsOpen,      setAppsOpen]      = useState(null);
  /**
   * ⭐ DOES THIS EVENT HAVE A RUNNING ORDER? One reader, `lib/eventSetTimes`.
   * ⚠ `totalSlots` is only consulted for an event that has never stated a
   * preference, which keeps every existing event exactly as it is today.
   */
  const usesSetTimes = setTimesEnabled(event, totalSlots);

  /**
   * ⭐ THE CONFIRMED BILL (P5.1). ⚠ Derived from the RAW member and performance
   * rows via `isBooked`, ⛔ never from a display status — `memberState` calls a
   * hand-entered act 'CONFIRMED' because nobody is waiting on a reply, which is
   * right for pixels and would book somebody who never agreed.
   */
  const bookedLineup = bookedMemberRows(lineupMembers, perfsByMember, event);
  /* ⭐ P6.2 · is any artist owed a notice? Read from the SAME `claim.notify`
     the slot cards render, so the tab and the rows can never disagree. */
  const anyNoticeOutstanding = Object.values(claims || {}).some(c => c?.notify?.needsNotice);

  /* ⭐ WHICH SET TIMES THE PUBLIC STILL CANNOT SEE. Derived from the RAW member
     and performance rows, ⛔ never from `claim.status` — that translation calls
     a hand-entered act 'confirmed' for display, which is precisely the belief
     that hid this problem: the host saw a filled slot and the public saw
     "Open slot". See planPublishSetTimes. */
  const publishPlan = planPublishSetTimes(lineupMembers, Object.values(perfsByMember || {}).flat());

  const [eventTab,      setEventTab]      = useState('LINEUP');

  /**
   * ⛔⛔ THE ACTIVE TAB CAN BE ONE THAT NO LONGER EXISTS. `eventTab` defaults to
   * LINEUP and is remembered across renders, so an event that uses set times
   * would open on a tab absent from its own tab bar — the content would render
   * with nothing selected above it, which reads as a broken screen rather than
   * a missing tab.
   *
   * ⚠ Swapped rather than reset: LINEUP and SET TIMES are the SAME position in
   * the workflow, so the host lands where they meant to be either way.
   */
  useEffect(() => {
    if (usesSetTimes  && eventTab === 'LINEUP')    setEventTab('SET_TIMES');
    if (!usesSetTimes && eventTab === 'SET_TIMES') setEventTab('LINEUP');
  }, [usesSetTimes, eventTab]);
  const [showEditor,    setShowEditor]    = useState(false);
  const [allApps,       setAllApps]       = useState([]);
  const [appProfiles,   setAppProfiles]   = useState({});
  const [editingSlot,   setEditingSlot]   = useState(null);
  const [fillSlot,      setFillSlot]      = useState(null);
  const [addArtistOpen,  setAddArtistOpen]  = useState(false);
  const [addingArtist,   setAddingArtist]   = useState(false);
  const [addArtistError, setAddArtistError] = useState('');
  const [assigningApp,  setAssigningApp]  = useState(null);
  /**
   * ⭐ ASSIGNING A SET TIME TO SOMEBODY ALREADY ON THE BILL (owner, 2026-08-15).
   *
   * ⚠⚠ A SEPARATE STATE FROM `assigningApp`, NOT A REUSE. The two share the
   * slot-picker sheet but ⛔ not the write: `doAssign` upserts a member,
   * accepts the APPLICATION and NOTIFIES, because it is answering an applicant.
   * A member on the LINEUP tab has no application to accept and may never have
   * had one — 21 acts were typed in by hand. Threading a member through
   * `doAssign` would have written `applications.status` for a row that does
   * not exist.
   */
  const [assigningMember, setAssigningMember] = useState(null);
  /**
   * ⚠ A FAILED SLOT WRITE MUST SAY SO. Until L1 the host could not write these
   * rows at all on 22 real events, and RLS filters an UPDATE rather than
   * erroring it — so the screen reported success and changed nothing. Surfacing
   * the error is what makes that class of failure visible if it ever returns.
   */
  const [slotError,     setSlotError]     = useState('');
  /**
   * ⛔⛔ THIS STATE DID NOT EXIST AND THREE HANDLERS CALLED ITS SETTER.
   *
   * ⚠⚠ `setLineupError(...)` appeared at every failure exit of "offer this
   * member a slot" and "promote to the bill" — so the one path that was
   * supposed to EXPLAIN a refusal was the path that threw a ReferenceError
   * instead. The comment beside one of them reads "SURFACED, NEVER SWALLOWED —
   * RLS filters an UPDATE rather than erroring it, so a blocked write looks
   * exactly like a button that did nothing", which is exactly what it did.
   *
   * ⚠ The banner below is the other half. State alone would have stopped the
   * crash and kept the silence, which is the worse half of the bug.
   */
  const [lineupError,   setLineupError]   = useState('');
  const [publishError,  setPublishError]  = useState('');
  const [publishing,    setPublishing]    = useState(false);
  /* Taking somebody off a bill is irreversible-looking and affects a real
     person, so it states exactly what it will do and waits. */
  const [confirmRemove, setConfirmRemove] = useState(null);
  /**
   * ⭐ `?view=public` OPENS STRAIGHT INTO THE PUNTER PREVIEW (owner,
   * 2026-08-16), so the dashboard's eye can reach it in one press instead of
   * landing the host in their own workspace to go hunting for the toggle.
   *
   * ⚠ INITIAL STATE ONLY, ⛔ not a synced mirror of the URL. The × on the
   * preview banner and the eye in the host bar both just setState, and making
   * the param authoritative would mean either fighting them or rewriting the
   * URL on every toggle. The link chooses the ENTRY; the controls own it after
   * that.
   */
  const [searchParams] = useSearchParams();
  const [viewAsPunter,  setViewAsPunter]  = useState(searchParams.get('view') === 'public');
  const [goLiveConfirm, setGoLiveConfirm] = useState(false);
  /* QR1 · which destination the generator opens on, or null when it is shut. */
  const [qrFor,         setQrFor]         = useState(null);
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
  /* ⛔ `sendingOffers` and `confirmUnlock` are GONE with the bulk publish and the
     offer-reverting unlock (P6.3d-1). ⛔ Do not reintroduce either: a send is one
     artist at a time, and nothing may revert an outstanding offer in bulk. */
  /**
   * ── ⭐⭐ P6.3d-0 · THE EDITING LOCK BECOMES A SESSION LOCK ────────────────────
   *
   * ⚠⚠ THERE WERE TWO DIFFERENT LOCKS. The dashboard has a PADLOCK in its tab
   * heading over component state (`setTimesUnlocked`), and this screen had a
   * PERSISTED `config.set_times_locked` with ⛔ no padlock at all — its only route
   * out was EDIT SET TIMES, which runs `unlockSetTimes` and reverts EVERY
   * outstanding offer to draft. So the two surfaces disagreed about what "locked"
   * means, and one of them could only be unlocked destructively.
   *
   * ⛔⛔ AND THAT IS WHY THIS COMES FIRST. P6.3d-1 deletes both writers of the
   * persisted flag. Deleting them with no replacement would freeze the ONE event
   * that has `set_times_locked = true` (Bass Heavy) on this surface forever, while
   * the dashboard stayed editable — the same event, frozen on one screen and not
   * the other.
   *
   * ⭐ SEEDED FROM THE PERSISTED FLAG, THEN SESSION-ONLY. So the 89 events that
   * never had the flag behave exactly as they do today (open), the one locked
   * event opens with the padlock instead of a destructive unlock, and ⛔ nothing
   * is ever written to `config` again.
   *
   * ⚠ `null` means "not yet decided by the host this session": the query's value
   * can arrive after the first render, so ⛔ it cannot be an eager initial state.
   */
  const [unlockedByHost, setUnlockedByHost] = useState(null);
  const setTimesUnlocked = unlockedByHost === null ? !isLocked : unlockedByHost;
  /* ⭐ P6.3 · one artist at a time, behind a confirm step. */
  const [confirmNotify, setConfirmNotify] = useState(null);
  const [notifying,     setNotifying]     = useState(false);
  const [notifyError,   setNotifyError]   = useState('');

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
      /* ⚠ The completion columns are appended for the READY chip the
         application cards now carry. `card_pills` was already selected here —
         the LINEUP side's query was the one missing it. ⛔ See
         PROFILE_CARD_META_COLUMNS: an unfetched completion column does not
         hide readiness, it silently lowers it. */
      const map = await fetchApplicantProfiles(supabase, rows,
        ['id, user_id, name, avatar, type, sound, genre_string, location, bio, mix_link, card_pills, vibe_tags',
          ...PROFILE_CARD_META_COLUMNS].join(', '));
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
    const { ok, error } = await executeLineupPlan(supabase, plan, {
      member,
      // ⚠ Scoped by the executor to what the plan destroys, so handing it
      // everything the member holds is safe — and `removeArtist` narrows to a
      // single performance before this, because one slot is not the other.
      perfs: memberPerfs(member.id),
      event: { id, name: event.name, owner_profile_id: event.owner_profile_id },
      notify: writeNotification,
      resolveProfileId: resolvePerformerProfileId,
    });
    if (!ok) { setSlotError(error); return; }
    setConfirmRemove(null);
    queryClient.invalidateQueries({ queryKey: ['event', id] });
  }

  /**
   * ⭐⭐ AN APPLICATION JOINS THE BILL — the transition that did not exist.
   *
   * ⛔ SILENT unless the DECISION changes. Q3: joining the bill notifies
   * nobody; only "your application was accepted" is worth saying, and only the
   * first time. See lib/lineupFromApplication for the rules.
   *
   * ⛔ Creates no `performance`. On the bill is not given a time.
   */
  async function addApplicantToBill(app) {
    const plan = planAddToBill(app, appProfiles[app.id] || null, lineupMembers, { totalSlots });
    if (!plan.ok) { setSlotError(plan.reason); return; }

    const { ok, error, memberId, accepted } = await addToBill(supabase, plan);
    if (!ok) { setSlotError(error || 'Could not add them to the bill.'); return; }
    if (error) setSlotError(error);   // added, but the status write failed
    // AV5: add-to-bill IS an accept decision — observed here at the caller
    // (the lib keeps its injected-db purity), same event name as the
    // ApplicationsScreen path, distinguished by `via`.
    if (accepted && !error) track(EVENTS.APPLICATION_ACCEPTED, { event_id: event?.id, via: 'add_to_bill' });

    if (plan.statusUpdate) {
      setAllApps(prev => prev.map(a => a.id === app.id ? { ...a, status: plan.statusUpdate } : a));
    }
    /**
     * ⚠ THE APPLICANT HEARS ABOUT THE DECISION, NOT THE BILL. The old copy
     * for this said "You're booked!" — which is now provably wrong: accepted
     * means the host said yes, and a booking is a SLOT they have not been
     * offered yet.
     */
    if (plan.notify === 'accepted' && app.artist_id) {
      await writeNotification({
        toUserId:       app.artist_id,
        toProfileId:    (await resolvePerformerProfileId(app.artist_id)).profileId ?? null,
        aboutProfileId: event.owner_profile_id ?? null,
        type:    'booking_confirmed',
        message: `Your application for ${event.name} was accepted. You are on the lineup.`,
        data:    { event_id: id, event_name: event.name, lineup_member_id: memberId },
      });
    }
    queryClient.invalidateQueries({ queryKey: ['event', id] });
  }

  /**
   * ── ⭐⭐ P6.3 · TELL ONE ARTIST ABOUT ONE SET TIME ───────────────────────────
   *
   * ⛔⛔ THE RULE LIVES IN `lib/notifySender`, ⛔ NOT HERE. This function resolves
   * the recipient from the slot the host tapped and reports the outcome; it makes
   * no decision about whether a send is allowed, ⛔ writes nothing itself, and
   * ⛔ never touches `set_times_locked`, `applications` or another artist's row.
   *
   * ⭐⭐ THIS IS NOW THE ONLY WAY A SET TIME IS SENT (P6.3d-1). `publishSetTimes`
   * is deleted: it flipped every draft event-wide, notified everyone reachable,
   * rewrote `applications.status` and locked the event, all behind one press and
   * with none of its four writes inspected.
   */
  const NOTIFY_KIND_FOR = { NOT_SENT: 'slot_offer', TIME_CHANGED: 'slot_changed', REMOVAL_TO_TELL: 'slot_removed' };

  function askToNotify(slot) {
    const claim  = claims[slot.id];
    const member = claim && lineupMembers.find(m => m.id === claim.member_id);
    const kind   = NOTIFY_KIND_FOR[claim?.notify?.state];
    /* ⛔ A control that cannot act is not a control — but if one is somehow
       reached, refuse in words rather than sending the wrong thing. */
    if (!member || !kind) { setNotifyError('There is nothing to tell this artist about.'); return; }
    setConfirmNotify({ member, kind, slotUuid: slot.id, slotLabel: [slot.time, slot.ampm].filter(Boolean).join(' ') });
  }

  /**
   * ── ⭐⭐ P6.3c-3 · THE REMOVAL FALLBACK ──────────────────────────────────────
   *
   * ⚠⚠ WHY A CONTROL EXISTS AT ALL. `executeLineupPlan` announces a removal as it
   * happens and records it (P6.3c-2), so this is ⛔ NOT the normal path. It is for
   * the cases that path cannot reach: the send FAILED, or the placement vanished
   * without going through a plan at all — deleting a slot in the editor takes its
   * performances with it, silently. Both leave a truthful `REMOVAL_TO_TELL`: an
   * artist who believes they are playing and has not been told otherwise.
   *
   * ⛔ THERE IS NO SLOT TO POINT AT, which is the whole state. The slot we record
   * is the one we last TOLD them about, and `notified_slot_uuid` may itself be
   * NULL because deleting the slot row nulls the FK — the KIND is what carries
   * the meaning, not the slot.
   */
  function askToSendRemoval(member) {
    if (!member?.id) { setNotifyError('There is nothing to tell this artist about.'); return; }
    setConfirmNotify({ member, kind: 'slot_removed', slotUuid: member.notified_slot_uuid || null, slotLabel: null });
  }

  async function doNotify() {
    if (!confirmNotify || notifying) return;
    const { member, kind, slotUuid, slotLabel } = confirmNotify;
    setNotifying(true);
    setNotifyError('');
    const res = await sendSlotNotice(supabase, {
      member, event, perfs: perfsByMember[member.id] || [],
      slotUuid, kind, slotLabel,
      /* ⭐ THE TRANSPORT IS INJECTED, so the module holds no client of its own. */
      notify: row => writeNotifications([row]),
      resolveProfileId: resolvePerformerProfileId,
    });
    setNotifying(false);
    setConfirmNotify(null);
    // AV5: the artist was TOLD — the release moment the funnel observes.
    // The P6 notification boundary stays the truth; `kind` says which
    // notice went out. Fires only on a fully recorded send.
    if (res.ok && res.sent && res.recorded) {
      track(EVENTS.APPLICATION_RELEASED, { event_id: event?.id, kind });
    }
    /**
     * ⚠⚠ SENT BUT NOT RECORDED MUST BE SAID OUT LOUD. The artist has the message
     * and the system does not know, so the next pass would tell them again. ⛔ It
     * is not a silent retry and ⛔ not a plain failure.
     */
    if (res.sent && !res.recorded) {
      setNotifyError(`${member.artist_name || 'The artist'} WAS told, but recording it failed. Do not send again until this is checked: ${res.error}`);
    } else if (!res.ok) {
      setNotifyError(res.error || 'The notification was not sent.');
    }
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
  /**
   * ⭐⭐ THE SHORTLIST IS A PLACE, NOT A WORD ON AN APPLICATION (ratified
   * 2026-08-16). It holds artists you are ACTIVELY CONSIDERING, whether they
   * applied, you found them in search, or you played them last month.
   *
   * ⚠⚠ TWO SOURCES, ONE LIST, AND THE MEMBER WINS. A `lineup_members` row with
   * `status='shortlisted'` is the real thing; a `shortlisted` APPLICATION is the
   * legacy shape from when this tab was a filter over applications. Both render,
   * but an applicant who already has a member row must appear ONCE — production
   * has exactly this case, and both of its shortlisted applications already had
   * a member.
   *
   * ⛔ SHORTLIST IS NOT A BIN. Dropping somebody from the event is its own
   * explicit act from this tab; calling this a holding pen is what turns the
   * status into a garbage state.
   *
   * ⭐⭐ P5.2 · THE POPULATION NOW COMES FROM `lib/shortlist`, which both host
   * surfaces share — including the de-duplication against the shortlist AND the
   * bill that these two screens previously each assembled for themselves.
   *
   * ⛔⛔ AND IT IS CONTRACT-AWARE. On a legacy or imported event the list is
   * exactly what it was: ⛔ the existing bill is NOT injected. Only a managed
   * event shows booked artists here, at the top, because SHORTLIST is that
   * model's working surface and P5.1 can remove the LINEUP tab entirely.
   */
  const shortlistRows = shortlistEntries({
    event,
    shortlistMembers,
    billMembers: lineupMembers,
    perfsByMember,
    shortlistedApps: allApps.filter(a => bucketOf(a) === 'shortlisted'),
    appProfiles,
    /* ⭐⭐ P5.3 · THE GATE. `usesSetTimes` is already this screen's answer from
       `lib/eventSetTimes` (line 69) and drives the tab strip below, so the
       shortlist cannot disagree with which tabs exist. */
    usesSetTimes,
  });
  /* ⚠ Kept under its old name for the tab COUNT and the header, which have
     always meant "how many am I considering", and for `FillSlotModal`, which
     takes the raw rows. */
  const shortList  = shortlistRows.map(e => e.row);
  /**
   * ⚠⚠ `new` AND `seen`. Matching `new` alone meant OPENING an application
   * dropped it out of the queue, because `EnquiryCard` auto-writes `seen` on
   * expand. Bass Heavy's PIPELINE read empty with an application sitting in it.
   * See PIPELINE_BUCKETS — reading is not deciding.
   */
  const pipeline   = allApps.filter(a => PIPELINE_BUCKETS.includes(bucketOf(a)));
  /**
   * ⭐⭐ THE ORPHANS — accepted, and on nobody's bill.
   *
   * ⚠⚠ A STATE THE MODEL NO LONGER CREATES. Since ADD TO LINEUP *is* the
   * acceptance, "accepted" and "on the bill" arrive together. Five rows in
   * production predate that and were told yes without ever being booked.
   *
   * ⛔ NOT AN `acceptedApps` LIST ANY MORE. Accepted applicants who ARE on the
   * bill belong to the LINEUP and are excluded here — otherwise this tab would
   * show four people who are already booked and read as a workspace rather than
   * a one-time cleanup.
   */
  const orphanedAccepted = allApps.filter(a =>
    bucketOf(a) === 'accepted'
    && !findExistingMember(a, lineupMembers, appProfiles[a.id] || null)
    && !findExistingMember(a, shortlistMembers, appProfiles[a.id] || null));

  async function doAssign(slot) {
    if (!assigningApp) return;
    const { app: aApp, prof: aProf } = assigningApp;
    const artistName = aProf?.name || aApp.artist_name || '—';
    const slotTime = [slot.time, slot.ampm].filter(Boolean).join(' ');
    // Upsert lineup_member for this artist
    let { data: memberData } = await supabase.from('lineup_members').select('id').eq('event_id', id).eq('artist_id', aApp.artist_id).eq('status', 'on_bill').maybeSingle();
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
    /* ⛔⛔ WAS WRITING `slot_id` (the legacy TEXT key) WITH A UUID, so the row
       landed with a NULL `slot_uuid` and no surface could see it. One writer
       now — see `assignMemberToSlot`. */
    const { ok: assigned, error: assignErr, performance: perf } = await assignMemberToSlot(supabase, {
      slotId: slot.id, eventId: id, memberId: memberData.id, status: 'offered',
    });
    if (!assigned) { setLineupError(assignErr); return; }
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

  /**
   * ⭐⭐ GIVE AN EXISTING BILL MEMBER A SET TIME — the action the LINEUP tab
   * exists to offer and did not have. 123 of 152 members sit at "on the bill,
   * no set time"; until now the only routes to a slot were the SHORT LIST's
   * ASSIGN SLOT (applications only) or the set-times grid.
   *
   * ⛔⛔ CREATES A `draft` PERFORMANCE AND NOTIFIES NOBODY.
   *
   * ⚠ This is Q3, not a shortcut: adding to the bill is private, and OFFERING
   * a slot is the actionable, notifying act. The per-artist SEND on the row's
   * chip is the only thing that speaks (P6.3), and it promotes that one draft
   * as it sends.
   * Writing `offered` here would notify from a button labelled "assign", which
   * is an automatic transition the owner explicitly ruled out.
   *
   * ⛔ NOTHING IS WRITTEN TO `applications`. A member is not an applicant.
   */
  /* ⛔ `openProfile`/`hasProfile` DELETED — navigation moved INTO the card.
     WorkItemCard’s panel owns PROFILE, MESSAGE and FOLLOW now, so the tabs no
     longer each carry their own copy of the id-first routing rule. */

  /**
   * ⭐⭐ SHORTLIST → LINEUP for a member who is already on the event.
   *
   * ⚠ A STATUS FLIP, ⛔ NOT AN INSERT. `addApplicantToBill` exists for an
   * APPLICATION and creates the member row; this row already exists, and
   * inserting a second one is precisely the duplication that produced eight
   * junk members in production on 2026-08-15.
   *
   * ⛔ NOTHING IS WRITTEN TO `applications`. A member you shortlisted yourself
   * may have no application at all, and one that does is not answered by this —
   * membership does not reach back and rewrite the decision record.
   *
   * ⛔ NO PERFORMANCE. Being on the bill is not being given a time.
   */
  /**
   * ⭐⭐ THE SECOND ENTRY POINT — an artist who never applied.
   *
   * ⛔ The rules live in `lib/shortlistFromArtist`, not here: no fabricated
   * application, no notification, no performance, and a duplicate guard that
   * counts `removed` rows too. `lineup_members` has no uniqueness constraint,
   * so that guard is the only one.
   */
  async function addFoundArtistToShortlist(profile) {
    if (addingArtist) return;
    setAddingArtist(true);
    setAddArtistError('');
    /* ⚠ Checked against BOTH lists — somebody already on the bill is just as
       much a duplicate as somebody already shortlisted. */
    const plan = planAddArtistToShortlist(profile, id, [...lineupMembers, ...shortlistMembers]);
    if (!plan.ok) { setAddArtistError(plan.reason); setAddingArtist(false); return; }
    const { ok, error } = await addArtistToShortlist(supabase, plan);
    setAddingArtist(false);
    if (!ok) { setAddArtistError(error || 'Could not add them.'); return; }
    setAddArtistOpen(false);
    queryClient.invalidateQueries({ queryKey: ['event', id] });
  }

  async function promoteMemberToBill(member) {
    /**
     * ⛔⛔ THE SECOND WAY ONTO A BILL, AND IT NEEDS THE SAME CAP. `planAddToBill`
     * guards the APPLICATION route; this is the SHORTLIST route, and it does not
     * go through that planner — it flips a status. ⚠ A rule enforced on one of
     * two doors is not enforced.
     *
     * ⚠ `on_bill` only: the member being promoted is currently `shortlisted`
     * and so is not already counted in the total they are about to join.
     */
    const onBill = lineupMembers.filter(m => m?.status === 'on_bill').length;
    const cap = billCapacity(onBill, totalSlots);
    if (cap.full) { setLineupError(billFullMessage(cap.total)); return; }

    const { error } = await supabase.from('lineup_members')
      .update({ status: 'on_bill', updated_at: new Date().toISOString() })
      .eq('id', member.id);
    /* ⚠ SURFACED, NEVER SWALLOWED — RLS filters an UPDATE rather than erroring
       it, so a blocked write looks exactly like a button that did nothing. */
    if (error) { setLineupError(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ['event', id] });
  }

  async function doAssignMember(slot) {
    if (!assigningMember) return;
    const { member } = assigningMember;
    /* ⭐ One writer, shared with FillSlotModal and the application route — see
       `assignMemberToSlot`. ⛔ This used to write the legacy `slot_id` column
       with a UUID, which made the assignment invisible. */
    const { ok: assigned, error: assignErr } = await assignMemberToSlot(supabase, {
      slotId: slot.id, eventId: id, memberId: member.id, status: 'draft',
    });
    /* ⚠ SURFACED, NOT SWALLOWED — an INSERT blocked by RLS fails loudly (42501)
       while an UPDATE fails silently, and a set time that did not save must not
       look like one that did. */
    if (!assigned) setSlotError(assignErr);
    queryClient.invalidateQueries({ queryKey: ['event', id] });
    setAssigningMember(null);
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
          {/**
            * ⭐ TWO COLUMNS, FULL HEIGHT (owner, 2026-08-16).
            *
            * ⚠ The stats used to be their own row spanning the whole panel, so
            * they ran ACROSS the top of the control stack rather than stopping
            * at it. Left column now owns the numbers and MANAGE EVENT; right
            * column owns the four host controls and runs the full height beside
            * them.
            *
            * ⚠ `alignItems: stretch` is what lets the stack reach top to bottom
            * — with `center` it would sit in the middle of whatever height the
            * left column happened to be.
            */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className={s.managePanelStats} style={{ marginBottom: 0 }}>
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

            {/* ⚠ HOST DASH SITS BESIDE MANAGE EVENT (owner, 2026-08-16), not in
                the right-hand stack — leaving the buttons that act on THIS event
                on one line, and the stack for the ones that change how you are
                viewing it. */}
            {/* ⚠ WRAPS BELOW ~360px, BY DESIGN. HOST DASH is flexShrink:0 and
                keeps its width, so MANAGE EVENT (flex:1) absorbed every pixel
                of shrink and its label broke onto two lines at 340px — measured
                across 280-430px. Allowing the ROW to wrap lets MANAGE EVENT
                drop to its own full-width line with its label intact, which is
                the honest trade: one more line beats a broken word. */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
              {/**
                * ⚠ THE PINK/WHITE COMBO FROM `HoverProfileBtn` (owner,
                * 2026-08-16) — the treatment the old profile control used, and
                * the same one `CalendarIconBtn` carries. Reused rather than
                * re-picked so the app has ONE quiet-pink small control, ⛔ not a
                * third neutral language invented for one button.
                *
                * ⛔ White ink on the pink edge, ⛔ not pink text. Thin Bebas at
                * 10px in a saturated hue is the least legible thing on a card —
                * the same rule the enquiry status chip follows.
                */}
              {/* ⚠ 47px AND flexShrink:0 — the same height as `.manageBtn` next
                  to it, at its own natural width rather than stretching. The two
                  buttons act on this event and now read as one pair.

                  ⛔ A BLOCK COMMENT BETWEEN JSX ATTRIBUTES IS NOT A COMMENT. Put
                  one inside a tag and it swallows the next attribute: the style
                  object collapsed to a bare `flex: 1` and threw "flex is not
                  defined" at runtime, while the build stayed green. Comments in
                  a tag belong out here, in braces.

                  ⚠ 15px MATCHES `.manageBtn` BESIDE IT — the two share a line,
                  so a smaller label made this read as the lesser control.

                  ⚠ `flex-start` with a 4px left pad puts the chevron ON the
                  edge. ⛔ `justifyContent: center` would push it back inward
                  however much padding it was given. */}
              <button
                onClick={() => navigate('/industry/host')}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start', gap: 4, flexShrink: 0, height: 47, padding: '0 14px 0 4px', borderRadius: 8, cursor: 'pointer', fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: 1.5, whiteSpace: 'nowrap', border: '1px solid rgba(255,51,153,.35)', background: 'rgba(255,51,153,.1)', color: '#fff', transition: 'all .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,51,153,.22)'; e.currentTarget.style.borderColor = '#FF69B4'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,51,153,.1)'; e.currentTarget.style.borderColor = 'rgba(255,51,153,.35)'; }}
              >
                {/* ⚠ The chevron grows with the label — a small mark beside 15px
                    Bebas reads as an afterthought rather than part of the word. */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                HOST DASH
              </button>
            <button className={s.manageBtn} style={{ flex: 1 }} onClick={() => navigate(`/create-event?edit=${id}`)}>MANAGE EVENT ›</button>
            </div>
          </div>
          {/**
            * ⭐ THE HOST CONTROL STACK — draft/live, dashboard, editor, preview.
            *
            * ⚠ `justifyContent: space-between` spreads it across the full height
            * of the panel rather than bunching it at the top, so the column runs
            * bottom to top beside the stats and MANAGE EVENT.
            *
            * ⭐ HOST DASH is an EXPLICIT destination, ⛔ not `navigate(-1)`. The
            * header chevron already does history-back, and history is wherever
            * you came from — an event opened from Discover, a notification or a
            * shared link would send you back there rather than to your events.
            *
            * ⛔ HOST CHROME ONLY. This whole block is gated on being the event's
            * host, so a punter never sees a link to a workspace they cannot
            * open.
            */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, width: 128, justifyContent: 'space-between' }}>
            {/* ⚠ MOVED INTO THE RIGHT-HAND STACK (owner, 2026-08-16) so the four
                host controls share one column and one edge, instead of the toggle
                floating above the stats while the rest sat beside them. */}
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
            <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setShowEditor(v => !v)}
              style={{
                fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5,
                /* ⚠ 47px MATCHES `.manageBtn` BESIDE IT (owner, 2026-08-16). It
                   sat at 36px, so the two controls in one row read as different
                   weights of thing. ⛔ Height, not more padding — the label is
                   centred by flex, and padding would move the text rather than
                   grow the box. */
                height: 47, padding: '0 14px', borderRadius: 8, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
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
                /* ⚠ 47px to match the editor toggle and MANAGE EVENT — the three
                   controls in this row share one height. */
                flexShrink: 0, width: 36, height: 47, borderRadius: 8, cursor: 'pointer',
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

        </div>
      )}

      {/* Sub-tabs — host only, editor mode */}
      {effectiveIsHost && showEditor && (
        <EventTabBar
          active={eventTab}
          onChange={setEventTab}
          /**
           * ⚠ TAB ORDER IS THE FUNNEL, READ BACKWARDS (owner, 2026-08-15).
           *
           * Left to right: the settled bill, its running order, then the
           * decisions behind it in reverse — accepted, shortlisted, and finally
           * the raw inbox at the far right. So the tabs that answer "where is
           * this event up to" sit first, and the ones that are a queue of work
           * sit last, rather than PIPELINE and ACCEPTED being separated by the
           * two tabs that come between them in the process.
           *
           * ⛔ ORDER ONLY — the keys, labels and counts are untouched, and
           * `eventTab` still defaults to LINEUP.
           */
          /**
           * ⭐⭐ FOUR WORKSPACES, IN FUNNEL ORDER (ratified 2026-08-16).
           * LINEUP · SET TIMES · SHORTLIST · PIPELINE.
           *
           * ⛔ ACCEPTED IS NO LONGER ONE OF THEM. It was the redundant middle:
           * ADD TO LINEUP *is* the acceptance, so a separate "you said yes but
           * they're not on the bill" workspace described a state the model no
           * longer creates. `applications.status = 'accepted'` survives as
           * history, notifications and audit — ⛔ just not as a destination.
           *
           * ⭐⭐ THE ORPHAN TAB IS SELF-ELIMINATING. Five accepted applications
           * in production have no lineup member — real people who were told yes
           * and never booked. Dropping the tab outright would strand them where
           * no surface shows them, and backfilling them into `lineup_members`
           * would assert a booking the host never made. So the tab renders ONLY
           * while such rows exist, says exactly what they are, and disappears
           * for good once they are cleared. ⛔ Do not make it permanent.
           */
          /**
            * ⭐⭐ THE ORDER IS THE WORKFLOW, READ FORWARDS (ratified
            * 2026-08-17): who came to us, who do I want, then where do they go.
            *
            *     PIPELINE · SHORTLIST · SET TIMES        set times ON
            *     PIPELINE · SHORTLIST · LINEUP           set times OFF
            *
            * ⛔⛔ NEVER BOTH LINEUP AND SET TIMES. SET TIMES *is* the scheduling
            * presentation of the confirmed bill, so showing both is two host
            * workspaces over one population — ⚠ exactly the drift §11 was
            * written about and then suffered anyway. ⭐ One workspace per event
            * removes the opportunity rather than documenting it.
            *
            * ⚠ "LINEUP" the DATA survives either way; only the TAB is
            * conditional. `lib/eventSetTimes` is the one thing that decides,
            * and it falls back to the OLD derivation for any event that has
            * never stated a preference — so ⛔ nothing existing changes shape.
            *
            * ⛔ Change this list and change `HostDashboard`'s — §11.
            */
          tabs={[
            /* ⚠ SWAPPED (owner, 2026-08-17): the WORKSPACE leads and PIPELINE
               moves to the end. The order below reads outward from where the
               host actually works rather than forward through the funnel —
               ⛔ and it keeps the default landing tab first, which is what both
               surfaces already fall back to. */
            usesSetTimes
              /* ⭐⭐ P6.2 · `!` MEANS SOMEBODY HAS NOT BEEN TOLD. ⛔ Not a count:
                 the number of outstanding notices is not a quantity the host
                 acts on, the tab is. ⚠ Derived every render from the claims, so
                 it cannot go stale, and ⛔ it never reads `set_times_locked`. */
              ? { key: 'SET_TIMES', label: (
                /**
                  * ⭐⭐ P6.3d-0 · THE PADLOCK, WHERE THE DASHBOARD ALREADY PUTS IT.
                  * ⛔ Change one, change both — §11.
                  *
                  * ⛔ A `<span role="button">`, ⛔ NOT a `<button>`: the tab itself
                  * is a button and nesting one inside another is invalid HTML that
                  * browsers resolve by dropping the inner control.
                  *
                  * ⚠ `stopPropagation` or the padlock would also change tab.
                  * Locking and choosing the tab are two intents on one piece of
                  * chrome. ⚠ 40px hit area via padding + equal negative margin.
                  */
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {`SET TIMES${anyNoticeOutstanding ? ' !' : ''}`}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-pressed={setTimesUnlocked}
                    aria-label={setTimesUnlocked ? 'Lock set times' : 'Unlock to edit set times'}
                    title={setTimesUnlocked ? 'Lock set times' : 'Unlock to edit set times'}
                    onClick={e => { e.stopPropagation(); setUnlockedByHost(!setTimesUnlocked); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setUnlockedByHost(!setTimesUnlocked); }
                    }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      padding: 13, margin: -13, border: 'none', background: 'none',
                      color: setTimesUnlocked ? '#fff' : 'var(--muted)',
                      cursor: 'pointer', transition: 'color .15s',
                    }}
                  >
                    {setTimesUnlocked
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
                      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
                  </span>
                </span>
              ) }
              : { key: 'LINEUP',    label: `LINEUP${bookedLineup.length ? ` (${bookedLineup.length})` : ''}` },
            { key: 'SHORTLIST', label: `SHORTLIST${shortList.length ? ` (${shortList.length})` : ''}` },
            { key: 'PIPELINE',  label: `PIPELINE${pipeline.length ? ` (${pipeline.length})` : ''}` },
            ...(orphanedAccepted.length
              ? [{ key: 'ACCEPTED', label: `NOT BOOKED (${orphanedAccepted.length})` }]
              : []),
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

      {/* ⭐ THE LINEUP'S OWN REFUSALS — a bill that is full, or a write RLS
          filtered. ⛔ Same treatment as the slot banner deliberately: these
          fail the same silent way and a host should not have to learn two
          shapes of bad news.
          ⚠ NOT gated on `showEditor`. Promoting to the bill is reachable with
          the editor closed, and an error that renders only inside a panel the
          host is not looking at has not been surfaced at all. */}
      {effectiveIsHost && lineupError && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(255,45,120,.1)', border: '1px solid rgba(255,45,120,.35)' }}>
          <span style={{ fontSize: 12.5, color: '#FF2D78', lineHeight: 1.5 }}>
            That change to the lineup did not go through. Nothing was changed. {lineupError}
          </span>
          <button onClick={() => setLineupError('')} style={{ background: 'none', border: 'none', color: '#FF2D78', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
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

      {/**
        * ── ⭐⭐ PUBLISH SET TIMES — the acts nobody can ask ───────────────────
        *
        * ⛔⛔ NOT THE OLD `publishSetTimes`. That one flipped statuses, wrote
        * notifications, rewrote applications and locked the event on one press,
        * and was dismantled for it. This promotes drafts and does nothing else.
        *
        * ⚠ IT APPEARS ONLY WHEN THERE IS SOMETHING TO PUBLISH, and what it can
        * publish is only ever acts with no account. Owner, 2026-08-22: an event
        * with all four slots assigned read "Open slot" to the public on every
        * one of them, because hand-entered acts have nobody who can accept and
        * the public read only ever sees accepted rows.
        *
        * ⛔ SEPARATE FROM THE TOGGLE ABOVE, WHICH IS A DIFFERENT QUESTION.
        * "Are set times public?" is about the SECTION; this is about whether a
        * particular slot has a name in it. An event can announce its running
        * order and still show four empty slots — that pair is exactly what
        * produced the report.
        */}
      {effectiveIsHost && showEditor && eventTab === 'SET_TIMES' && publishPlan.promoteIds.length > 0 && (
        <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(0,229,160,.3)', background: 'rgba(0,229,160,.08)' }}>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.75)', lineHeight: 1.5, marginBottom: 10 }}>
            {publishPlan.promoteIds.length === 1
              ? `${publishPlan.names[0] || 'One act'} has a set time the public cannot see yet.`
              : `${publishPlan.promoteIds.length} set times are not visible to the public yet.`}
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.45)', marginTop: 4 }}>
              {/* ⚠ Says WHY, because "publish" on a slot that already looks
                  filled to the host is otherwise an unexplained button. */}
              {publishPlan.names.join(', ')} {publishPlan.names.length === 1 ? 'has' : 'have'} no
              account on YesPleez, so nobody can accept the slot. Publishing puts
              {publishPlan.names.length === 1 ? ' the name' : ' those names'} on the public running order.
              {publishPlan.skippedReachable > 0 && (
                <> {publishPlan.skippedReachable} other set {publishPlan.skippedReachable === 1 ? 'time is' : 'times are'} waiting
                on the artist to answer and {publishPlan.skippedReachable === 1 ? 'is' : 'are'} not affected.</>
              )}
            </div>
          </div>
          {publishError && (
            <div role="alert" style={{ fontSize: 12, color: '#FF2D78', marginBottom: 8 }}>
              Nothing was published. {publishError}
            </div>
          )}
          <button
            onClick={async () => {
              setPublishError('');
              setPublishing(true);
              const { ok, error } = await applyPublishSetTimes(supabase, publishPlan);
              setPublishing(false);
              /* ⚠ RLS FILTERS AN UPDATE RATHER THAN ERRORING IT — the same trap
                 the slot editor carries above. A silent no-op must not read as
                 success, so the refetch is what proves it, not the button. */
              if (!ok) { setPublishError(error || 'The publish did not go through.'); return; }
              queryClient.invalidateQueries({ queryKey: ['event', id] });
            }}
            disabled={publishing}
            style={{
              width: '100%', padding: '9px 14px', borderRadius: 8,
              cursor: publishing ? 'default' : 'pointer',
              fontFamily: "'Bebas Neue'", fontSize: 12.5, letterSpacing: 1.5,
              border: 'none', background: '#00E5A0', color: '#04231a',
              opacity: publishing ? 0.6 : 1,
            }}
          >
            {publishing ? 'PUBLISHING…' : `PUBLISH ${publishPlan.promoteIds.length === 1 ? 'THIS SET TIME' : `${publishPlan.promoteIds.length} SET TIMES`}`}
          </button>
        </div>
      )}

      {/**
        * ── ⭐⭐ P6.3 · THE CONFIRM STEP FOR ONE ARTIST ─────────────────────────
        *
        * ⛔ A MESSAGE TO A REAL PERSON NEVER GOES ON ONE TAP. It names WHO, WHAT
        * and WHEN before sending, because the chip that opens this sits inside a
        * grid the host is also dragging things around in.
        *
        * ⚠ It says the artist will be told; ⛔ it does not claim to change their
        * booking, because a set time move requires no re-acceptance.
        */}
      {confirmNotify && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.78)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#181825', borderRadius: 16, padding: 24, maxWidth: 360, width: '100%', border: '1px solid rgba(255,255,255,.1)' }}>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 2, marginBottom: 10 }}>
              {confirmNotify.kind === 'slot_removed'  ? 'TELL THEM IT IS OFF?'
                : confirmNotify.kind === 'slot_changed' ? 'TELL THEM IT CHANGED?'
                : 'SEND THIS SET TIME?'}
            </div>
            {/**
              * ⚠ A REMOVAL IS A DIFFERENT SENTENCE, ⛔ not the same one with a
              * blank where the time goes. And it says what stays true: they are
              * still on the lineup, because `REMOVAL_TO_TELL` only exists for a
              * member who is still booked.
              */}
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', lineHeight: 1.6, margin: '0 0 6px' }}>
              {confirmNotify.kind === 'slot_removed'
                ? <>{confirmNotify.member.artist_name || 'This artist'} will be told their set time has been{' '}
                    <strong style={{ color: '#fff' }}>removed</strong>. They stay on the lineup.</>
                : <>{confirmNotify.member.artist_name || 'This artist'} will be told they are on at{' '}
                    <strong style={{ color: '#fff' }}>{confirmNotify.slotLabel}</strong>.</>}
            </p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', lineHeight: 1.6, margin: '0 0 20px' }}>
              Only this artist is notified. Nobody else on the lineup is affected.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmNotify(null)} disabled={notifying}
                style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.6)', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, cursor: 'pointer' }}>CANCEL</button>
              <button onClick={doNotify} disabled={notifying}
                style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: '#00E5A0', color: '#0b0b12', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, cursor: notifying ? 'default' : 'pointer', opacity: notifying ? .6 : 1 }}>
                {notifying ? 'SENDING…' : 'SEND'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ⚠⚠ SURFACED, NEVER SWALLOWED — including the "told but not recorded"
          case, which needs a human rather than a retry. */}
      {notifyError && (
        <div style={{ margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, background: 'rgba(255,68,68,.1)', border: '1px solid rgba(255,68,68,.4)', color: '#FF8C8C', fontSize: 12.5, lineHeight: 1.5 }}>
          {notifyError}
          <button onClick={() => setNotifyError('')} style={{ marginLeft: 8, background: 'none', border: 'none', color: 'rgba(255,255,255,.5)', cursor: 'pointer', fontSize: 11 }}>DISMISS</button>
        </div>
      )}

      {/* LINEUP tab */}
      {effectiveIsHost && showEditor && eventTab === 'LINEUP' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/**
            * ⭐⭐ P5.1 · LINEUP IS DERIVED, ⛔ no longer read straight off
            * `status = 'on_bill'`. `lib/hostLineup.isBooked` is the one rule and
            * it has two right answers:
            *
            *   legacy / imported  the bill is authoritative as it stands, so
            *                      `on_bill` IS the answer. ⛔ Nobody reconfirms.
            *   managed            only the artist's acceptance books them.
            *
            * ⚠⚠ ON EVERY EVENT IN PRODUCTION THIS IS A NO-OP. All 90 are
            * `legacy`, and `lineupMembers` is already filtered to `on_bill` —
            * so the derivation returns the identical rows in the identical
            * order. Tested in `hostLineup.test.js`.
            *
            * ⚠ `bookedMemberRows` exists because this screen holds a FLAT list
            * plus `perfsByMember`, while the dashboard holds groups. ⛔ Two
            * shapes, ⛔ but ONE rule — both adapters call `isBooked`.
            */}
          {bookedLineup.length === 0
            ? (
              <div style={{ textAlign: 'center', padding: '48px 16px' }}>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 3, color: 'rgba(255,255,255,.18)', marginBottom: 8 }}>NO ONE ON THE BILL YET</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,.13)' }}>Shortlist artists and assign them a slot to build your lineup.</div>
              </div>
            )
            : bookedLineup.map(member => {
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
              const work       = lineupWorkState(badge);
              /* ⭐ P6.3c-1 · what have we told them? Computed ONCE per row. */
              const notice     = notifyState(member, memberPerfs(member.id), event);
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
                <WorkItemCard key={member.id} kind="lineup" item={cardItem}
                  /* ⭐⭐ EVERYONE HERE IS ON THE BILL — that is what being in
                     `lineup_members` means, and it is why there is ⛔ NO
                     `stateLabel`. The chip stated the CONSTANT once per row and
                     said nothing; only the variable is worth the space, so the
                     set time is promoted into the chip instead.
                     ⛔ Change one, change both — HostDashboard has the twin. */
                  stateColor={badgeColor}
                  /**
                   * ⭐⭐ P6.3c-1 · AN OUTSTANDING NOTICE OUTRANKS THE SCHEDULING
                   * LABEL, because it is the actionable thing.
                   *
                   * ⚠⚠ WHAT THIS FIXES: an artist told about a set time that was
                   * then CLEARED stays `on_bill` with no placement, and this row
                   * read `NEEDS SET TIME` — the label for somebody never
                   * scheduled. The host had no way to know a person was expecting
                   * to play. Same starved-input shape as the missing
                   * `notified_kind` column: the derivation was right and this
                   * screen never asked it.
                   *
                   * ⛔ ONLY WHEN THERE IS WORK. `needsNotice` is false for CLEAN,
                   * NOT_RECORDED and an unreachable act, so every other row keeps
                   * exactly the scheduling wording it has today.
                   * ⛔ Change one, change both — HostDashboard has the twin.
                   */
                  subState={notice.needsNotice ? notice.label : work.setTime}
                  needsAction={work.needsAction || notice.needsNotice}
                  /* ⚠ `member.card_pills` is the fallback: an imported act can
                     carry tags on the member row with no profile behind it. */
                  tags={prof?.card_pills || member.card_pills}
                  viewerProfileId={event?.owner_profile_id || null}
                  actions={
                    <div className="yp-decision-row">
                      {/* ⭐⭐ THE DOMINANT STATE GETS THE PRIMARY ACTION (goal 9).
                          No set time is the most common state on this tab and
                          the only one with work outstanding, so it — and only
                          it — offers the forward move. */}
                      {memberPerfs(member.id).length === 0
                        ? (
                          <DecisionBtn tone="accept" icon={CheckIcon} label="ASSIGN SET TIME"
                            onClick={() => setAssigningMember({ member, prof })} />
                        )
                        : (
                          /* ⚠⚠ CLEAR SET TIME AND REMOVE FROM BILL WERE ONCE THE
                             SAME DESTRUCTIVE OPERATION — both deleted the
                             performances AND the member row. See
                             lib/lineupActions; ⛔ they must stay distinct.
                             ⛔ Only offered when there IS a set time: a control
                             that acts on nothing is not a control. */
                          <DecisionBtn tone="neutral" icon={XIcon} label="CLEAR SET TIME"
                            onClick={() => runLineupAction(planUnassign(member, memberPerfs(member.id)), member)} />
                        )}
                      {/**
                        * ⭐⭐ P6.3c-3b · THE REMOVAL FALLBACK REACHES THIS TAB TOO,
                        * because on a SET-TIMES-OFF event this is the ONLY surface
                        * the artist appears on.
                        *
                        * ⚠⚠ THE GAP THIS CLOSES. P5.3 injects a booked artist with
                        * no set time into SHORTLIST only when the event USES set
                        * times — correctly, or 121 already-visible artists would
                        * flood 37 shortlists. So with set times OFF a
                        * `REMOVAL_TO_TELL` member showed the honest label here
                        * (P6.3c-1) and had ⛔ nowhere to act on it.
                        *
                        * ⚠ THE TWO CONTROLS NEVER BOTH APPEAR: with set times ON
                        * there is no LINEUP tab and the artist is in SHORTLIST;
                        * with set times OFF there is no SHORTLIST row. ⛔ Same
                        * verb, same confirm, same `sendSlotNotice` — the surface
                        * differs because the event shape does.
                        *
                        * ⛔ Still ONLY for `REMOVAL_TO_TELL`. ⛔ Never for NEEDS
                        * SET TIME, which would announce a booking and cancel it.
                        */}
                      {notice.state === 'REMOVAL_TO_TELL' && (
                        <DecisionBtn tone="neutral" icon={XIcon} label="SEND REMOVAL NOTICE"
                          onClick={() => askToSendRemoval(member)} />
                      )}
                      {/**
                        * ⭐⭐ THE ONLY EXIT FROM THE LINEUP (ratified 2026-08-16).
                        * `REMOVE FROM BILL` is gone from this tab — changing
                        * your mind returns somebody to SHORTLIST, and dropping
                        * them from the event entirely is a separate act from
                        * there. SHORTLIST is active consideration, ⛔ not a bin.
                        *
                        * ⛔⛔ WITHHELD ONCE THE ARTIST HAS ACCEPTED A SLOT. They
                        * agreed to a specific time; silently deleting that is
                        * the rudest thing this screen could do. The chip below
                        * says to clear the set time first, which forces the
                        * order — un-book the slot (a conversation) before
                        * un-booking the person.
                        *
                        * ⭐ BECAUSE OF THAT, THIS CAN NEVER DESTROY AN ACCEPTED
                        * PERFORMANCE, which is why nothing is notified.
                        */}
                      {badge === 'CONFIRMED'
                        ? (
                          <span title="Clear the set time before moving them back to the shortlist"
                            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: 'var(--muted)', border: '1px dashed rgba(255,255,255,.18)', borderRadius: 11, padding: '10px 8px', textAlign: 'center', lineHeight: 1.25 }}>
                            ARTIST CONFIRMED — CLEAR THE SET TIME FIRST
                          </span>
                        )
                        : (
                          /* ⚠ NEUTRAL NOW, because the dialog it opens offers
                             BOTH exits. Labelling the control MOVE TO SHORTLIST
                             would promise one of the two answers before the
                             question is asked. */
                          <DecisionBtn tone="decline" icon={XIcon} label="REMOVE FROM LINEUP"
                            onClick={() => setConfirmRemove({ member, perfs: memberPerfs(member.id) })} />
                        )}
                    </div>
                  }
                />
              );
            })
          }
        </div>
      )}

      {/* SHORTLIST tab */}
      {effectiveIsHost && showEditor && eventTab === 'SHORTLIST' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/**
            * ⭐⭐ THE ENTRY POINT FOR AN ARTIST WHO NEVER APPLIED. Until this
            * existed the funnel had one way in, so "I want to put this act on
            * the list of people I am thinking about" had no answer but adding
            * them to the bill.
            *
            * ⚠ AT THE TOP, and present even when the list is empty — an empty
            * shortlist is exactly when you most need the way to fill it.
            */}
          <button onClick={() => { setAddArtistError(''); setAddArtistOpen(true); }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', padding: '11px 0', marginBottom: 2, borderRadius: 10, cursor: 'pointer', fontFamily: "'Bebas Neue'", fontSize: 12.5, letterSpacing: 1.5, border: '1px dashed rgba(0,229,255,.35)', background: 'rgba(0,229,255,.05)', color: 'var(--neon2)' }}>
            + ADD ARTIST
          </button>
          {shortList.length === 0
            ? <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>Nobody on the shortlist yet. Add artists you are thinking about, then move them to the lineup when you decide.</p>
            : shortlistRows.map(({ row, kind, booked, needsSetTime }) => {
              /**
               * ⚠⚠ TWO SHAPES IN ONE LIST. A `lineup_members` row carries
               * `artist_profile_id`; an application carries `from_profile_id`
               * and lives in `appProfiles`. ⛔ Reading one shape's fields off
               * the other silently yields `undefined`, which renders as a card
               * with no name and no picture rather than as an error.
               *
               * ⭐ P5.2 · THE KIND IS NOW TOLD, ⛔ no longer sniffed from
               * `!!row.status`. A booked member arrives here on a managed event
               * carrying `status='on_bill'`, so the old test was about to start
               * answering a question it was never asked.
               */
              const isMember = kind === 'member';
              /* ⭐ P6.3c-3 · what have we told them? Computed ONCE per row, and
                 meaningful only for a member — an application has no record. */
              const rowNotice = isMember
                ? notifyState(row, perfsByMember[row.id] || [], event)
                : { state: null, label: null, needsNotice: false };
              const prof = isMember
                ? (memberProfiles[row.id] || null)
                : (appProfiles[row.id] || null);
              const cardItem = {
                id:           prof?.id || (isMember ? row.artist_profile_id : null) || null,
                user_id:      row.artist_id || null,
                name:         prof?.name || row.artist_name || 'Unnamed act',
                type:         prof?.type || 'artist',
                avatar:       prof?.avatar || null,
                avatar_thumb: prof?.avatar_thumb || null,
                sound:        prof?.sound || (isMember ? row.sound : null) || null,
                genre_string: prof?.genre_string || (isMember ? row.genre : null) || null,
                location:     prof?.location || null,
                state:        prof?.state || null,
              };
              return (
                <WorkItemCard key={row.id} kind="application" item={cardItem}
                  tags={prof?.card_pills || (isMember ? row.card_pills : null)}
                  viewerProfileId={event?.owner_profile_id || null}
                  /* ⭐⭐ THE CHIP TELLS THE TRUTH ABOUT THE ROW, ⛔ not about the
                     tab. A booked artist is in this workspace because the host
                     is still planning around them, ⛔ and labelling them
                     SHORTLISTED would say the booking had not happened. */
                  stateLabel={booked ? 'BOOKED' : 'SHORTLISTED'}
                  stateColor={booked ? STATE_COLOURS.CONFIRMED : STATUS_TAB_COLOR.SHORTLISTED}
                  /* ⭐⭐ P5.3 · THE WORK, SPELLED THE WAY THE LINEUP TAB SPELLS
                     IT. `lineupWorkState('ON BILL')` is the owner-ratified
                     wording ("NEEDS SET TIME", ⛔ not "NO SET TIME") and the lit
                     row is what makes a tab scannable. ⛔ Not re-worded here:
                     one phrase, one source. */
                  /**
                   * ⭐⭐ P6.2 · A BOOKED ARTIST WITH NO SET TIME IS ONE OF TWO
                   * DIFFERENT SITUATIONS, and only `notified_at` can tell them
                   * apart: never scheduled (NEEDS SET TIME) versus told about a
                   * time they no longer have (REMOVAL NOT SENT). ⛔ Calling both
                   * "needs set time" hides an artist who is expecting to play.
                   */
                  subState={needsSetTime
                    ? (rowNotice.label || lineupWorkState('ON BILL').setTime)
                    : undefined}
                  needsAction={!!needsSetTime}
                  /**
                   * ⭐⭐ THE BOOKED ROW'S ONE ACTION IS THE WORK IT IS HERE FOR.
                   *
                   * ⛔ NOT `ADD TO LINEUP` — they are already on it, and
                   * `promoteMemberToBill` would rewrite a row that already says
                   * `on_bill`. ⛔ NOT an exit either: the exits from a booking
                   * are the named ones in the LINEUP / SET TIMES workspace
                   * (§12), which refuse once an artist has ACCEPTED. Inventing
                   * a shortcut out of a booking on this tab is the "two
                   * outcomes behind one word" defect that section records.
                   *
                   * ⭐ ASSIGN SET TIME is the SAME handler the LINEUP tab uses,
                   * so the act is identical wherever the host reaches it from.
                   */
                  actions={booked ? (
                    <div className="yp-decision-row">
                      <DecisionBtn tone="accept" icon={CheckIcon} label="ASSIGN SET TIME"
                        onClick={() => setAssigningMember({ member: row, prof })} />
                      {/**
                        * ⭐⭐ P6.3c-3 · THE REMOVAL FALLBACK, and ⛔ ONLY for
                        * `REMOVAL_TO_TELL`.
                        *
                        * ⚠⚠ THIS IS NOT THE NORMAL PATH. A removal announces
                        * itself and records it (P6.3c-2). This control exists for
                        * the cases that cannot reach: the send FAILED, or the
                        * placement vanished without a plan — deleting a slot in
                        * the editor takes its performances with it, silently.
                        *
                        * ⛔ NEVER SHOWN FOR `NEEDS SET TIME`. An artist who was
                        * never told has nothing to be told about, and a removal
                        * notice would announce a booking and cancel it at once.
                        *
                        * ⭐ It goes through the SAME `sendSlotNotice` and the same
                        * confirm step as every other notice. ⛔ No second removal
                        * implementation.
                        */}
                      {rowNotice.state === 'REMOVAL_TO_TELL' && (
                        <DecisionBtn tone="neutral" icon={XIcon} label="SEND REMOVAL NOTICE"
                          onClick={() => askToSendRemoval(row)} />
                      )}
                    </div>
                  ) : (
                    <div className="yp-decision-row">
                      {/* ⭐ THE ONE FORWARD MOVE. Silent, and creates no set
                          time — giving them a slot is the next step, from the
                          LINEUP tab, and it is a separate decision.
                          ⛔ ASSIGN SLOT was removed from this tab deliberately:
                          it accepted the application AND notified AND created a
                          performance in one press, which is three decisions
                          behind one label, on the tab whose job is the first of
                          them. */}
                      <DecisionBtn tone="accept" icon={CheckIcon} label="ADD TO LINEUP"
                        onClick={() => isMember ? promoteMemberToBill(row) : addApplicantToBill(row)} />
                      {/**
                        * ⭐ THE TWO EXITS ARE DIFFERENT FACTS, so they are
                        * different words. An APPLICATION is declined — that is
                        * an answer to a person who asked. A member you added
                        * yourself was never asking, so there is nothing to
                        * decline; they simply come off the event.
                        */}
                      {isMember
                        ? (
                          <DecisionBtn tone="decline" icon={XIcon} label="REMOVE FROM EVENT"
                            onClick={() => runLineupAction(planRemoveFromEvent(row, []), row)} />
                        )
                        : (
                          <DecisionBtn tone="decline" icon={XIcon} label="DECLINE"
                            onClick={() => { supabase.from('applications').update({ status: 'declined' }).eq('id', row.id); setAllApps(prev => prev.map(a => a.id === row.id ? { ...a, status: 'declined' } : a)); }} />
                        )}
                    </div>
                  )}
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
                <WorkItemCard key={app.id} kind="application" item={cardItem}
                  tags={prof?.card_pills}
                  viewerProfileId={event?.owner_profile_id || null}
                  /* ⚠ THE STATE IS THE ROW'S OWN BUCKET, not the tab's. This
                     tab holds `new` AND `seen`, and the difference — has anyone
                     looked at this yet — is exactly what a host triaging a
                     queue wants to see per row. */
                  stateLabel={applicationWorkState(bucketOf(app)).label}
                  stateColor={STATUS_TAB_COLOR[bucketOf(app).toUpperCase()]}
                  actions={
                    <div className="yp-decision-row">
                      <DecisionBtn tone="shortlist" icon={StarIcon} label="SHORTLIST"
                        onClick={() => { supabase.from('applications').update({ status: 'shortlisted' }).eq('id', app.id); setAllApps(prev => prev.map(a => a.id === app.id ? { ...a, status: 'shortlisted' } : a)); }} />
                      <DecisionBtn tone="decline" icon={XIcon} label="DECLINE"
                        onClick={() => { supabase.from('applications').update({ status: 'declined' }).eq('id', app.id); setAllApps(prev => prev.map(a => a.id === app.id ? { ...a, status: 'declined' } : a)); }} />
                    </div>
                  }
                />
              );
            })
          }
        </div>
      )}

      {/**
        * NOT BOOKED — the one-time cleanup, ⛔ not a workspace.
        *
        * ⛔ NOTHING HERE IS AUTOMATIC. An accepted application does not become
        * bill membership on its own — ADD TO BILL is an explicit host action,
        * and until it is pressed the badge honestly reads NOT ON THE BILL.
        *
        * ⚠ This comment used to say the tab was read-only, which was true for
        * exactly one commit before the transition was built. Left corrected
        * rather than deleted: the rule that survived is that the tab shows a
        * DECISION, and membership is a separate act.
        *
        * ⭐ ON BILL / NOT ON BILL is derived from `lineup_members`, ⛔ never
        * from `applications.status` — the two are different facts and
        * conflating them is what this whole sequence removed.
        */}
      {effectiveIsHost && showEditor && eventTab === 'ACCEPTED' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {orphanedAccepted.length === 0
            /* ⛔ UNREACHABLE, and deliberately harmless. The tab is not rendered
               at all once this list empties, so nobody can land here — but a
               branch that assumes it cannot be reached is how a blank screen
               ships. */
            ? <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '32px 0' }}>Nothing left to clear.</p>
            : <>
              {/* ⚠ Says plainly that this is a cleanup with an end, not a stage
                  of the funnel. The obvious reading of "accepted" is "on the
                  bill", and for these five it never was. */}
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 4px', lineHeight: 1.5 }}>
                You told these artists yes and they were never added to the lineup. Add them or decline them — once this list is empty it will not come back.
              </p>
              {orphanedAccepted.map(app => {
                const prof = appProfiles[app.id] || {};
                const cardItem = { id: prof.id || null, user_id: app.artist_id, name: prof.name || app.artist_name, type: prof.type || 'artist', avatar: prof.avatar || null, avatar_thumb: prof.avatar_thumb || null, sound: prof.sound || null, genre_string: prof.genre_string || null, location: prof.location || null, state: prof.state || null };
                /* ⚠ Is this accepted applicant ALREADY on the bill? Answered
                   from `lineup_members`, which is the source of truth — the
                   application cannot tell you, and that is the whole point of
                   the separation. */
                const onBill = !!findExistingMember(app, lineupMembers, appProfiles[app.id] || null);
                return (
                  <WorkItemCard key={app.id} kind="application" item={cardItem}
                  tags={prof?.card_pills}
                  viewerProfileId={event?.owner_profile_id || null}
                    /* ⭐ ON BILL / NOT ON BILL is derived from `lineup_members`,
                       ⛔ never from `applications.status` — the two are
                       different facts, which is why the state chip has to say
                       both halves rather than just "ACCEPTED". */
                    stateLabel={applicationWorkState('accepted', onBill).label}
                    stateColor={onBill ? '#00E5A0' : 'rgba(255,255,255,.35)'}
                    actions={
                      <div className="yp-decision-row">
                        {/* ⚠ THIS TAB USED TO BE A DEAD END: it said NOT ON THE
                            BILL and offered no way to change that.
                            ⛔ Once they ARE on the bill there is nothing left to
                            do here — the work moves to the LINEUP tab, and
                            offering ADD TO BILL again would offer to repeat
                            something already done. */}
                        {!onBill && (
                          <DecisionBtn tone="accept" icon={CheckIcon} label="ADD TO BILL"
                            onClick={() => addApplicantToBill(app)} />
                        )}
                        <DecisionBtn tone="decline" icon={XIcon} label="DECLINE"
                          onClick={() => { supabase.from('applications').update({ status: 'declined' }).eq('id', app.id); setAllApps(prev => prev.map(a => a.id === app.id ? { ...a, status: 'declined' } : a)); }} />
                      </div>
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
            {/* ⭐ QR1 · the event-level entry to the shared generator. ⛔ There
                is no event-specific QR code here — this opens the ONE
                generator with a destination pre-selected, so the poster an
                organiser makes from an event page is the same object, in the
                same library, as one made from their dashboard. */}
            <ManageSection label="Promote">
              <ManageItem icon={<QrIcon />} label="Event QR Code" onClick={() => { setShowManage(false); setQrFor('event'); }} />
              <ManageItem icon={<QrIcon />} label="Set Times QR Code" onClick={() => { setShowManage(false); setQrFor('set-times'); }} />
            </ManageSection>
            <ManageSection label="Management">
              <ManageItem icon={<CopyIcon />} label="Duplicate Event" onClick={() => setShowManage(false)} muted />
              <ManageItem icon={<TrashIcon />} label="Delete Event" onClick={() => setShowManage(false)} danger />
            </ManageSection>
          </div>
        </div>
      )}

      {qrFor && (
        <QrCodeCreator
          userId={session?.user?.id}
          initial={{ destinationType: qrFor, destinationId: id }}
          onClose={() => setQrFor(null)}
        />
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
              Take {confirmRemove.member.artist_name || 'this act'} off the lineup?
            </div>
            {/**
              * ⭐⭐ THE DIALOG SAYS WHAT IS ACTUALLY DESTROYED, and that differs
              * by state (owner, 2026-08-16). A blanket "are you sure?" trains
              * people to click straight through it, so the sentence changes:
              *
              *     no set time  → nothing is destroyed, so it barely warns
              *     draft        → private, they were never told
              *     offered      → you are WITHDRAWING A QUESTION they have not
              *                    answered
              *
              * ⛔ THERE IS NO `accepted` CASE HERE. The card withholds this
              * action entirely once the artist has agreed to a slot — see the
              * chip on the LINEUP card — so the worst outcome cannot be reached
              * from this dialog at all.
              */}
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', marginTop: 8, lineHeight: 1.6 }}>
              {(() => {
                const held = confirmRemove.perfs.length;
                if (!held) return 'They hold no set time, so nothing else changes.';
                const offered = notifiablePerformances(confirmRemove.perfs).length;
                const label = held === 1 ? 'set time' : `${held} set times`;
                return offered && isReachable(confirmRemove.member)
                  ? `Their ${label} will be cleared. They were offered ${offered === 1 ? 'it' : 'them'} and have not replied, so that offer will be withdrawn.`
                  : `Their ${label} will be cleared. Nothing was sent to them, so they will not be notified.`;
              })()}
            </div>
            {/* ⚠ Says what is NOT touched, so nobody has to wonder whether this
                also rejected their application. It does not: declining an
                applicant is its own control, on the SHORT LIST. */}
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginTop: 10, lineHeight: 1.5 }}>
              Their application is left exactly as it is either way.
            </div>
            {/**
              * ⭐⭐ BOTH EXITS, FROM ONE DIALOG (owner, 2026-08-16). The LINEUP
              * offered only MOVE TO SHORTLIST, so an act added by mistake could
              * be demoted but ⛔ never taken off the event — the organiser had
              * to demote them here and then find them on the SHORTLIST tab to
              * finish the job.
              *
              * ⚠⚠ THIS REVISES the earlier "the only exit from the LINEUP is
              * MOVE TO SHORTLIST". The REASONING behind that rule survives and
              * is why the two are not equals here: keeping somebody is the
              * SAFE, reversible act, so it is the filled button. Taking them
              * off the event is the outline one beside it.
              *
              * ⛔ NEITHER IS REACHABLE ONCE THE ARTIST HAS ACCEPTED — the card
              * shows a chip instead of this control, so no path through this
              * dialog can destroy an accepted performance.
              */}
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button onClick={() => runLineupAction(planMoveToShortlist(confirmRemove.member, confirmRemove.perfs), confirmRemove.member)}
                style={{ flex: 1, padding: '13px 0', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, borderRadius: 10, border: 'none', background: '#FF2D78', color: '#0a0a14', cursor: 'pointer' }}>
                MOVE TO SHORTLIST
              </button>
              <button onClick={() => runLineupAction(planRemoveFromEvent(confirmRemove.member, confirmRemove.perfs), confirmRemove.member)}
                style={{ flex: 1, padding: '13px 0', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, borderRadius: 10, border: '1px solid rgba(255,45,120,.5)', background: 'rgba(255,45,120,.10)', color: '#FF2D78', cursor: 'pointer' }}>
                TAKE OFF EVENT
              </button>
            </div>
            <button onClick={() => setConfirmRemove(null)}
              style={{ width: '100%', marginTop: 10, padding: '11px 0', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.55)', cursor: 'pointer' }}>
              CANCEL
            </button>
          </div>
        </div>
      )}

      {fillSlot && (
        <FillSlotModal
          slot={fillSlot.slot}
          eventId={id}
          eventName={event?.name || ""}
          eventDate={event?.config?.date || ""}
          eventVenue={event?.config?.venue || ""}
          hostId={session?.user?.id}
          /* ⭐ THE ENTRIES, ⛔ not the bare rows — the sheet needs `kind` to know
             whether to place a member or create one. See FillSlotModal. */
          /* ⭐ The event itself, so the sheet can ask ONE reader which booking
             contract applies. ⛔ Not a booking_model string: a screen passing a
             raw value is a screen deciding the rule. */
          event={event}
          shortlist={shortlistRows}
          /* ⚠ Both maps: applications are keyed by application id, members by
             `lineup_members.id`. ⛔ Passing only `appProfiles` is what left a
             member row's profile empty. */
          shortlistProfiles={{ ...appProfiles, ...memberProfiles }}
          onFilled={() => { setFillSlot(null); queryClient.invalidateQueries({ queryKey: ['event', id] }); }}
          /**
           * ⭐⭐ A SLOT THIS SHEET CREATED IS REMOVED IF NOTHING GOES IN IT.
           *
           * ⚠⚠ MEASURED, ⛔ not theorised (2026-08-28): pressing the sliver and
           * closing the sheet left `position: -2, label: ''` sitting on the
           * live event — an empty row at the top of a stage that reads as a
           * glitch, and that nothing in the UI offers a way to remove.
           *
           * ⛔ ONLY the one it created (`fillSlot.created`). A slot the host
           * reached by tapping an EXISTING empty slot is part of their
           * schedule, and closing a sheet must never delete it. That flag is
           * the entire difference between tidying up after yourself and
           * deleting somebody's work.
           */
          onClose={async () => {
            const created = fillSlot?.created ? fillSlot.slot?.id : null;
            setFillSlot(null);
            if (!created) return;
            await supabase.from('event_slots').delete().eq('id', created);
            queryClient.invalidateQueries({ queryKey: ['event', id] });
          }}
        />
      )}

      {/**
        * ⭐ ONE SLOT PICKER, TWO CALLERS — an applicant being given a slot, and
        * a member already on the bill being given one.
        *
        * ⛔ THE SHEET IS SHARED; THE WRITE IS NOT. `doAssign` answers an
        * APPLICATION (accepts it, notifies); `doAssignMember` only creates a
        * draft performance. Picking the handler here rather than branching
        * inside one function is what keeps those two writes from converging
        * into a third that does a bit of both.
        */}
      {addArtistOpen && (
        <ShortlistArtistSheet
          /* ⚠ BOTH lists — the sheet greys out anyone already attached, and it
             must consider the bill as well as the shortlist or it would offer
             to add somebody who is already playing. */
          members={[...lineupMembers, ...shortlistMembers]}
          busy={addingArtist}
          error={addArtistError}
          onPick={addFoundArtistToShortlist}
          onClose={() => setAddArtistOpen(false)}
        />
      )}

      {/* ⭐ EXTRACTED to `components/AssignSlotSheet` so the dashboard can offer
          the same act. ⛔ The two ROUTES stay different here: an application
          accepts and notifies, a member only drafts. */}
      {(assigningApp || assigningMember) && (
        <AssignSlotSheet
          name={assigningApp
            ? (assigningApp.prof?.name || assigningApp.app.artist_name || '—')
            : (assigningMember.prof?.name || assigningMember.member.artist_name || '—')}
          days={days}
          claims={claims}
          claimsBySlot={claimsBySlot}
          quiet={!!assigningMember}
          onPick={assigningApp ? doAssign : doAssignMember}
          onClose={() => { setAssigningApp(null); setAssigningMember(null); }}
        />
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
          schedule={schedule}
          memberProfiles={memberProfiles}
          canFavourite={false}
          /* ⭐ VIEW AS PUNTER MUST SHOW WHAT A PUNTER SEES (S3). This was the
             host's own DaySlots grid with its verbs nulled, so the preview was
             of a surface no reader ever gets. It renders the public timetable
             now — ⛔ the editing grid on the tab above is untouched.

⚠  — the preview shows the cards, ⛔ not a
             continue-playing rail built from the host's own page. */
          setTimes={showTimesPublicly && totalSlots > 0
            ? <SchedulePortrait resolved={schedule} allMixSlots={[]} />
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
        effectiveIsHost, showEditor, eventTab,
        /**
         * ⭐⭐ P6.3d-0 · THE CARDS NOW READ THE SESSION LOCK, ⛔ not the persisted
         * flag. `isLocked` (from `config.set_times_locked`) still SEEDS it, so
         * nothing changes for an event that never had the flag — but the padlock
         * is now the thing that opens and shuts the schedule, and ⛔ it writes
         * nothing to the database.
         *
         * ⚠ The banner and the legacy SEND button above still read `isLocked`
         * directly. ⛔ Deliberate: they are deleted in P6.3d-1, and changing them
         * here would mix a deletion into a preparation.
         */
        isLocked: !setTimesUnlocked,
        /* ⛔ WHO A MESSAGE WOULD BE SENT AS. `openDirectConversation` takes a
           FROM profile and this account may hold several, so the surface that
           knows which one it is acting as states it. */
        viewerProfileId: event?.owner_profile_id || null,
        onFill:   slot          => setFillSlot({ slot }),
        onNotify: slot          => askToNotify(slot),
        /**
         * ⭐⭐ ADD A SLOT, then hand it straight to the sheet that fills it.
         *
         * ⚠ TWO STEPS, ONE GESTURE. The row has to exist before anything can be
         * put in it — `event_slots` is the only place a slot lives — so this
         * inserts an empty one and immediately opens the fill sheet on it. That
         * sheet already offers everything: an artist whose set starts earlier
         * than anything booked, or MARK THE TIME for a welcome or a stage open.
         *
         * ⛔ Do not stop after the insert and leave the host to find the new row
         * themselves — a bare empty slot appearing at the top of a stage reads
         * as a glitch rather than as the thing they just asked for.
         *
         * ⛔ THE ROWS, ⛔ not the rendered slots. `addSlotBefore` reads
         * `position`, which `toRenderSlot` deliberately does not carry — it is
         * an ordering fact, not a display one.
         */
        onAddSlot: async (stage, day) => {
          const stageId = stage?.id ?? null;
          const rows = (slotRows || []).filter(r =>
            (r.day_index ?? 0) === (day?.dayIndex ?? 0) && (r.stage_id ?? null) === stageId);
          const res = await addSlotBefore(supabase, {
            eventId: id,
            stageSlots: rows,
            dayIndex: day?.dayIndex ?? 0,
            dayName: day?.name || '',
            stageId,
          });
          if (!res.ok) { setNotifyError(res.error); return; }
          await queryClient.invalidateQueries({ queryKey: ['event', id] });
          /* ⭐ `created` marks this slot as THIS SHEET'S — closing without
             filling removes it again. See onClose. */
          setFillSlot({ slot: { id: res.slot.id, time: res.slot.time, ampm: res.slot.ampm }, created: true });
        },
        onEdit:   slot => setEditingSlot({ slot }),
        onRemove: slot => removeArtist(slot.id),
        /**
         * ⭐⭐ THE BILL EXIT, REACHED FROM SET TIMES (owner, 2026-08-16: the
         * set times are "essentially the lineup"). ⛔ It does NOT get its own
         * write — it opens the SAME dialog the LINEUP tab opens, so the two
         * routes out of the bill cannot drift apart or explain themselves
         * differently.
         *
         * ⚠ EVERY performance the member holds, ⛔ not just this slot's: they
         * are leaving the bill, so a second set time cannot survive them.
         */
        onDemote: slot => {
          const claim = claims[slot.id];
          const member = claim && lineupMembers.find(m => m.id === claim.member_id);
          if (member) setConfirmRemove({ member, perfs: memberPerfs(member.id) });
        },
        onPin:    slot => togglePin(slot),
      }}
    />
  );
}
