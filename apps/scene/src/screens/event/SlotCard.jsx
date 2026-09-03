// EP-00 · extracted verbatim from EventScreen.jsx.
// One slot row. Renders read-only for the public view and editable for the
// host editor — the difference is entirely in the props it is given.
/* ⚠ `useRef` went with the genre rail's scroll hint — the pill row no longer
   overflows, so there is nothing to nudge. */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
/**
 * ⛔⛔ `useDraggable` + `useDroppable`, ⛔ NEVER `useSortable` (owner,
 * 2026-08-16). A SORTABLE moves an object THROUGH A LIST; a schedule moves an
 * artist INTO A FIXED TIME SLOT. Those are different interaction models, and
 * every drop artefact chased today came from fighting that distinction:
 * snap-back, double-play, bounce. ⛔ The slots never move, so nothing here may
 * compute a transform from a destination.
 */
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { supabase } from '../../lib/supabase';
import { usePlayer, useSession } from '../../App';
// The follow-this-artist action inside an expanded slot needs all four of
// these. They were free identifiers in EventScreen.jsx — resolved there by its
// own imports — so extracting SlotCard without them would have been a
// ReferenceError on the first tap. Caught by `oxlint --deny no-undef`.
import { getPersonalProfileId } from '../../lib/actingProfile';
import { resolveProfileId } from '../../lib/resolveProfileId';
import { unfollowProfile } from '../../lib/participation';
import { track, EVENTS } from '../../lib/analytics';
import { openDirectConversation } from '../../lib/messaging';
import UnclaimedBadge from '../../components/UnclaimedBadge';
import FollowHeartBtn from '../../components/FollowHeartBtn';
import { profileIdentity } from '../../lib/profileTypes';
import { stageDefaultImage } from '../../lib/stageDefaultImage';
import { actPills } from '../../lib/actPills';
import { parseDurMins, fmtDur, labelColor, stripEmoji, isWelcomeToCountry, slotOccupant } from './slotUtils';
import s from '../EventScreen.module.css';

/**
 * Set Times hardening · the Notes accordion (Artist Brief, Host Notes, History)
 * is hidden until there is somewhere to store it. See the note at its markup.
 * ⛔ Do not flip this without the column and the RLS policy behind it.
 */
const NOTES_PERSISTENCE_READY = false;

function HeadphoneIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
    </svg>
  );
}

/**
 * @param expandable ⛔ FALSE ON THE DASHBOARD (owner, 2026-08-16).
 *
 * ⚠⚠ WITHHOLDING `onEdit`/`onRemove` IS NOT ENOUGH, and assuming it was is a
 * mistake this prop exists to correct. The expanded panel renders EDIT SLOT,
 * LOCK SLOT, REMOVE and REPLACE ARTIST from `isHost` ALONE — so the dashboard,
 * which must pass `isHost` to show acts truthfully, drew four host controls
 * (two of them destructive-looking) wired to handlers that do not exist.
 *
 * ⛔ A dead REMOVE button is worse than a missing one: it reads as a working
 * control, and the one time it appears not to work is indistinguishable from
 * the RLS-filtered silent failure this codebase keeps being bitten by.
 *
 * ⭐ THE FIX WAS THE RIGHT ONE AND IT STILL STANDS: every control here renders
 * only where its HANDLER exists, ⛔ never from `isHost` alone.
 *
 * ⚠ UPDATED 2026-08-16 — "the dashboard stays TRIAGE" no longer follows from
 * it. REMOVE was withheld there because the screen could not act safely: the
 * planners need the member row and its performances, and the dashboard held a
 * translated status and a name. `eventSlots.toClaim` now carries
 * `performance` and `member`, both screens call `executeLineupPlan`, and the
 * dashboard passes a REAL `onRemove` behind its padlock. ⛔ REPLACE ARTIST is
 * still withheld there — it needs the artist picker mounted, which is a
 * surface, not a rule.
 */
/**
 * ⭐⭐ THE PERSON ACTIONS — MESSAGE and VIEW PROFILE.
 *
 * ⛔⛔ NAVIGATING TO AN ACT IS NOT A HOST OPERATION (owner, 2026-08-20). This
 * pair used to live INSIDE the `isHost` block, so a punter reading the running
 * order could expand a card and find no way to reach the artist at all — the
 * timetable was a dead end for the only people it is published for.
 *
 * ⭐ ONE DEFINITION, TWO PLACEMENTS. The host renders it inside the slot's
 * action row (person actions right, slot actions left); the public renders it
 * on its own. ⛔ Not copied into both — a styled control duplicated across two
 * surfaces is a control that drifts.
 *
 * ⚠ MESSAGE SELF-GATES and therefore stays host-only WITHOUT an `isHost` test:
 * it needs `viewerProfileId`, which only a managing surface supplies, because
 * `openDirectConversation` takes a FROM profile and this account may hold
 * several. ⛔ Do not "simplify" that into an isHost check — the sender is the
 * real requirement, and the day a punter surface gains one it should work.
 */
function PersonActions({ claim, viewerProfileId, navigate, msgBusy, setMsgBusy, align = 'auto' }) {
  if (!claim?.user_id && !claim?.profile_id) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginLeft: align === 'auto' ? 'auto' : undefined }}>
      {claim?.user_id && viewerProfileId && claim.profile_id && (
        <button
          onClick={async e => {
            e.stopPropagation();
            if (msgBusy) return;
            setMsgBusy(true);
            const { conversationId } = await openDirectConversation(viewerProfileId, claim.profile_id);
            setMsgBusy(false);
            if (conversationId) navigate(`/messages/${conversationId}`);
          }}
          /* ⭐ THE GRADIENT BORDER (owner, 2026-08-16) — the app's cyan→violet
             edge, painted with the two-layer background trick: a padding-box
             fill over a border-box gradient. ⛔ A transparent 1.5px border is
             REQUIRED for it to show; drop it and the gradient is hidden under
             the fill. */
          style={{ flexShrink: 0, padding: '7px 12px', borderRadius: 9, cursor: 'pointer', fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.2, border: '1.5px solid transparent', background: 'linear-gradient(var(--card2),var(--card2)) padding-box, linear-gradient(135deg,#00E5FF,#BF5FFF) border-box', color: '#fff', whiteSpace: 'nowrap' }}
        >{msgBusy ? 'OPENING…' : 'MESSAGE'}</button>
      )}

      {/**
        * ⭐⭐ FOLLOW, BESIDE VIEW PROFILE (owner, 2026-08-28). Reaching an act
        * and keeping an act are the two things a reader wants from an expanded
        * card, so they sit together rather than the second one living only in
        * the fifteen minute window after the set.
        *
        * ⛔ `FollowHeartBtn`, ⛔ NOT a second implementation. It owns the
        * follow/unfollow write across BOTH keyspaces and the `followedProfiles`
        * cache — the dual-keyspace trap this file's own heart was once bitten
        * by. `variant="label"` because a bare heart between two worded controls
        * reads as decoration.
        *
        * ⚠ GATED ON `profile_id`, ⛔ not `user_id`. Most acts on a bill are
        * profiles nobody has claimed an account for; gating on the account is
        * what makes the panel's existing heart invisible on almost every card.
        */}
      {claim?.profile_id && (
        <FollowHeartBtn
          profile={{
            ...(claim.profile || {}),
            id: claim.profile_id,
            user_id: claim.user_id ?? claim.profile?.user_id ?? null,
            type: claim.profile?.type || 'artist',
            name: claim.name,
          }}
          variant="label"
          className={s.slotFollowBtn}
        />
      )}

      {/* ⚠ `profile_id` FIRST, account second — the profile is the real
          reference and `user_id` is null for the many imported acts nobody has
          claimed. An act with neither is not rendered at all (guard above). */}
      {(claim?.profile_id || claim?.user_id) && (
        <button
          onClick={e => { e.stopPropagation(); navigate(claim.profile_id ? `/profile/${claim.profile_id}?prefer=performer` : `/profile/${claim.user_id}?prefer=performer`); }}
          style={{ flexShrink: 0, fontSize: 10, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, background: 'none', border: 'none', padding: '7px 2px', cursor: 'pointer', whiteSpace: 'nowrap' }}
        ><span style={{ background: 'linear-gradient(135deg,#00E5FF,#BF5FFF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>VIEW PROFILE →</span></button>
      )}
    </div>
  );
}

export default function SlotCard({ slot, claim, onFill, onEdit, onRemove, onDemote, onPin, onNotify, onAddToCalendar, isHost, isSortable, isActiveSort, isDragOverlay, allMixSlots = [], locked = false, viewerProfileId = null, expandable = true, registerNode }) {
  const [expanded,      setExpanded]      = useState(false);
  const [hostNote,      setHostNote]      = useState('');
  const [artistBrief,   setArtistBrief]   = useState('');
  const [notesBoxOpen,  setNotesBoxOpen]  = useState(false);
  const [briefOpen,     setBriefOpen]     = useState(false);
  const [hostNoteOpen,  setHostNoteOpen]  = useState(false);
  const [historyOpen,   setHistoryOpen]   = useState(false);
  const [followed,      setFollowed]      = useState(false);
  const [followBusy,    setFollowBusy]    = useState(false);
  /* ⚠ ONE state, ⛔ no longer 'replace' | 'remove'. REPLACE and REMOVE share a
     single button, so the panel asks once and the CHOICE is made in the
     confirm. See the action row below. */
  const [confirm,       setConfirm]       = useState(null); // 'choose' | null
  const [msgBusy,       setMsgBusy]       = useState(false);

  /**
   * ⭐⭐ DRAGGABLE AND DROPPABLE ARE TWO DIFFERENT QUESTIONS (2026-08-16).
   *
   * ⚠⚠ THIS WAS `disabled: !isSortable`, and in dnd-kit a boolean `disabled`
   * turns off BOTH halves. An empty slot is not sortable — nothing to drag — so
   * it was also NOT A DROP TARGET. Drag an act onto a gap and `closestCenter`
   * had no droppable there to resolve, so `over` fell back to the ORIGIN and
   * `handleDragEnd` bailed on `active.id === over.id`. dnd-kit's own announcer
   * said so out loud: "dropped over droppable area <its own id>".
   *
   * ⛔ So the "move to an empty slot" branch in DaySlots could NEVER run — the
   * code planned for a drop the registration made impossible. Act-onto-ACT
   * (a swap) always worked, which is why this hid on the event page and only
   * surfaced on a dashboard with two acts and three gaps.
   *
   * ⭐ Now: `draggable` follows `isSortable` (you cannot pick up an empty slot),
   * `droppable` follows `isHost` (any slot can RECEIVE an act while editing).
   * ⚠ Pinned slots stay undroppable via the guard in `handleDragEnd`.
   */
  /**
   * ⭐⭐ TWO SEPARATE ROLES ON ONE ROW.
   *
   *   DRAGGABLE — only an occupied slot can be picked up, and only by the grip.
   *   DROPPABLE — EVERY slot can receive, occupied or not, while editing.
   *
   * ⛔ NEITHER PRODUCES A TRANSFORM. The row is painted at its own position and
   * stays there for the whole gesture; the thing that follows the pointer is
   * the `DragOverlay` in DaySlots. ⚠ That is the entire fix: there is no
   * "return" to animate, because nothing ever left.
   */
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: slot.id,
    disabled: !isSortable,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: slot.id,
    disabled: !isHost,
  });
  /* ⚠ One element is three things — draggable, droppable, and the node DaySlots
     measures for FLIP. ⛔ Assigning only some of these silently breaks either
     the hit-testing or the displaced-act animation. */
  const setRowRef = node => { setDragRef(node); setDropRef(node); registerNode?.(node); };
  const navigate = useNavigate();
  const { session } = useSession();

  /* ⛔ THE SETTLE ANIMATION IS GONE (owner, 2026-08-16: "no settle animation").
     It existed to soften a transform unwind that no longer happens. A drop is
     now a plain occupant change, and dressing that up is what made it read as
     a second movement. */

  useEffect(() => {
    if (!session?.user?.id || !claim?.user_id || session.user.id === claim.user_id) return;
    supabase.from('follows').select('id').eq('user_id', session.user.id).eq('entity_id', claim.user_id).maybeSingle()
      .then(({ data }) => setFollowed(!!data));
  }, [session?.user?.id, claim?.user_id]);

  const { player, setPlayer } = usePlayer();
  const claimStatus   = claim?.status || (claim?.user_id ? 'pending' : 'name_added');
  /**
   * ⭐⭐ THE STATUS CHIP LIVES ON THE MINIMISED ROW (owner, 2026-08-16), top
   * right. It was inside the expanded panel, so "where does this act stand"
   * — the question a host scans a schedule to answer — required opening every
   * slot one at a time.
   *
   * ⛔ HOSTED ONLY, unchanged. The public page shows an unfilled slot as
   * unfilled; who has and has not answered is the organiser's business.
   *
   * ⚠ ⛔ NOT A SECOND INTERPRETATION OF STATE. It reads `claimStatus`, the
   * value already derived above, ⛔ never `performance.status` — a chip is
   * pixels, and the display translation is exactly what it should show.
   */
  const chip = {
    name_added: { label: 'NAME ADDED', bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.15)', color: 'var(--muted)', icon: null },
    pending:    { label: 'AWAITING REPLY', bg: 'rgba(255,184,48,.10)', border: 'rgba(255,184,48,.35)', color: '#FFB830', icon: null },
    offered:    { label: 'AWAITING REPLY', bg: 'rgba(255,184,48,.10)', border: 'rgba(255,184,48,.35)', color: '#FFB830', icon: null },
    draft:      { label: 'SET TIME NOT SENT', bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.15)', color: 'var(--muted)', icon: null },
    /* ⚠ "ARTIST DECLINED", matching the LINEUP tab exactly — the host declining
       an APPLICATION is a different event that shares the word, so ⛔ neither
       surface may use it bare. */
    declined:   { label: 'ARTIST DECLINED', bg: 'rgba(255,51,153,.10)', border: 'rgba(255,51,153,.40)', color: '#FF3399', icon: null },
    confirmed:  { label: 'BOOKED', bg: 'rgba(0,200,100,.10)', border: 'rgba(255,255,255,.15)', color: '#00C864',
      icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> },
  }[claimStatus] || { label: String(claimStatus).toUpperCase(), bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.15)', color: 'var(--muted)', icon: null };
  const isConfirmed   = claimStatus === 'confirmed';
  const isDraft       = claimStatus === 'draft';
  /**
   * ⭐⭐ THE VISIBILITY RULES MOVED TO `slotUtils` (2026-08-31) — draft reads as
   * open, unconfirmed reads as PENDING, only a confirmed act is named.
   *
   * ⛔⛔ THEY WERE INLINE HERE, AND THAT WAS FINE UNTIL A SECOND SURFACE NEEDED
   * THEM. The zoomed-out schedule map draws a name too, and a copy of these two
   * lines over there is the exact failure `SchedulePortrait`'s header warns
   * about: two answers to one question, and a leak on the day they disagree.
   * ⛔ Do not inline them again — this card and the map read the same function.
   */
  const { isEmpty, name: publicName } = slotOccupant(claim, isHost);
  const rawDur     = parseDurMins(slot.dur ?? slot.duration);
  const durLabel   = fmtDur(rawDur > 0 ? rawDur : 60);
  const cleanLabel = slot.label ? stripEmoji(slot.label) : null;
  /**
   * ⭐⭐ AN INFO CARD: a slot with a LABEL and no act. A welcome to country, a
   * stage close, a changeover, a workshop block. The time is SPOKEN FOR, so it
   * is ⛔ not an open slot, and there is no performer, so it is ⛔ not an act.
   *
   * ⚠⚠ NAMED ONCE, ON PURPOSE. This condition was written inline in three
   * places — the heading, the label chip and the headphones — and a fourth
   * surface would have made a fourth copy and drifted. ⛔ Do not re-derive it;
   * read this.
   *
   * ⭐ It is EDITABLE like any other slot: its time, length and wording are the
   * host's to change. What it has no use for is REPLACE / REMOVE and the person
   * actions, and those gate themselves on `claim`, which it does not have.
   */
  const isInfoCard = isEmpty && !!cleanLabel;
  const isWelcome  = isWelcomeToCountry(cleanLabel);
  const col        = slot.labelColor || (cleanLabel ? labelColor(cleanLabel) : '#FFB830');

  // Single descriptor pill matching v1: sound > card_pills > genre
  const descriptor = claim?.sound || claim?.card_pills || claim?.genre || '';

  /**
   * ⭐ THE ACT'S PICTURE, for the card background.
   *
   * ⚠⚠ TWO DIFFERENT ABSENCES, ⛔ and they must not be collapsed:
   *
   *     no ACT at all      → ⛔ NO image. "Open slot" names an absence, and a
   *                          photograph there would draw a booking that does
   *                          not exist.
   *     an act with no PIC → the TYPE's default, exactly as the lineup card
   *                          resolves it.
   *
   * ⚠ The second half was missed on the first pass, and `fewrf` — an unclaimed
   * act with no avatar — carried a picture on the LINEUP tab and none on SET
   * TIMES. ⛔ The same act rendering two ways on two tabs of one event is the
   * precise inconsistency this whole card pass exists to remove.
   *
   * ⚠ `defaultImage` is itself legitimately null for an unknown type, which is
   * the one case that correctly falls through to no image at all.
   */
  const slotImg = !claim ? null : (
    claim.profile?.avatar_thumb || claim.profile?.avatar
    || claim.avatar_thumb || claim.avatar
    /**
     * ⭐ THE STAGE ANSWERS BEFORE THE TYPE DOES — but only ever after the act's
     * own picture. A workshop leader who HAS a photograph keeps it; the stage
     * default is for the hand-entered acts that have none, which on a workshops
     * or gallery stage is most of them (`artist_id` and `artist_profile_id` are
     * both null on every one of Neverland's).
     *
     * ⚠⚠ WITHOUT THIS THE NEXT LINE RAN AND A YOGA CLASS WORE A DJ'S PHOTO.
     * `profileIdentity('artist')` is the fallback for an act with no profile,
     * and it is right for a music stage and confidently wrong for this one.
     * ⛔ Do not reorder these two.
     */
    || stageDefaultImage(slot?.stageName)
    || profileIdentity(String(claim.profile?.type || 'artist').toLowerCase()).defaultImage
    || null
  );

  /**
   * ⚠ NAMES THE CONTROL THAT OPENS IT, ⛔ not just the fact that something is
   * shut. "LOCK SET TIMES" is the padlock's own label beside the SET TIMES
   * heading, so the tooltip and the control agree word for word.
   */
  const lockReason = 'Set times are locked. Use LOCK SET TIMES beside the heading to unlock.';

  const borderCol = slot.pinned ? '#FFB830' : (isEmpty && !isDraft) ? 'var(--border)' : isDraft ? 'rgba(255,255,255,.18)' : 'var(--neon)';

  return (
    <div
      ref={setRowRef}
      /**
       * ⭐⭐ THE ROW NEVER MOVES. ⛔ No transform, no transition, no settle.
       *
       * ⚠⚠ EVERY DROP ARTEFACT CHASED TODAY CAME FROM THIS ONE MISTAKE — using
       * a SORTABLE for a schedule. A sortable transforms rows to preview a
       * reorder; these rows are fixed times and never reorder, so those
       * transforms always had to be undone. Undoing them instantly read as a
       * SNAP; easing them read as the move PLAYING TWICE; and swapping between
       * dnd-kit's transition and ours mid-flight read as a BOUNCE. Three
       * symptoms, three failed fixes, one wrong model.
       *
       * ⭐ Now: the card under the pointer is the `DragOverlay`. This row is
       * ghosted where it came from. The destination is decided ONLY by
       * `over.id`, and on drop the occupant simply changes. ⛔ There is nothing
       * to animate, because nothing ever left its slot.
       */
      style={{
        marginBottom: 8,
        /* ⭐ GHOSTED, ⛔ not hidden: the row keeps its space and shows you where
           the act came FROM while the overlay carries it. */
        opacity: isDragging ? 0.3 : isDragOverlay ? 0.95 : 1,
        /* ⛔⛔ NO `transform`, and ⛔ NO `transition`. The row is painted at its
           own position for the whole gesture. Nothing to return from. */
        boxShadow: isDragOverlay ? '0 10px 34px rgba(0,0,0,.55)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* Drag handle — only in editor mode */}
        {isSortable && (
          <div
            {...attributes}
            {...listeners}
            /**
              * ⭐⭐ 44px OF TARGET, 28px OF BUTTON (owner, 2026-08-16: "put the
              * button back in its appearance but keep the padding only at 44px").
              *
              * ⚠⚠ Widening the button to 44 made the GRIP fatter, which was not
              * the ask. The hit area and the mark are two different things: this
              * outer element is INVISIBLE — no background, no border — and only
              * carries the listeners and the 16px of dead space. The inner one
              * keeps the exact appearance it always had.
              *
              * ⛔⛔ AND THE PADDING HANGS OUTSIDE THE ROW — `marginLeft: -16`
              * cancels it (owner, 2026-08-16). ⚠⚠ Without that, the 16px of
              * dead space was real layout: it pushed every draggable row 16px
              * right, so the sortable slots no longer lined up with the open
              * ones above and below them. A hit target is not allowed to move
              * the thing it is targeting.
              *
              * ⭐ Net effect: the visible bar sits exactly where the old 28px
              * button did, flush with the column edge, and the extra reach
              * spills into the page margin where there was nothing to hit
              * anyway. Its right border is still removed and its radius still
              * matches the card's, so the two read as one object.
              */
            style={{ display: 'flex', alignItems: 'stretch', width: 44, paddingLeft: 16, marginLeft: -16, boxSizing: 'border-box', flexShrink: 0, cursor: 'grab', background: 'none', border: 'none' }}
          >
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, borderRadius: expanded ? '10px 0 0 0' : '10px 0 0 10px', background: 'rgba(255,255,255,.04)', border: `1px solid ${borderCol}`, borderRight: 'none', color: 'rgba(255,255,255,.3)' }}
            >
              <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
                <circle cx="4" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/>
                <circle cx="4" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/>
                <circle cx="4" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/>
              </svg>
            </div>
          </div>
        )}
        <div
          /**
           * ⭐⭐ ONE EXCEPTION TO THE DIMMING, AND ONLY ONE (owner, 2026-08-28):
           * "stage close can be muted, that's not as important; welcome to
           * country is".
           *
           * ⚠ So this is NOT `!isInfoCard`. Every other marker — stage open,
           * stage close, doors — keeps `.slotEmpty`'s 55%, because they are
           * scaffolding around the programme rather than part of it. A welcome
           * to country is the programme, and it was being greyed out beside the
           * acts it opens for.
           *
           * ⛔ Do not widen this to all markers to make the rule tidier; the
           * narrowness IS the rule.
           */
          className={s.slot + (isEmpty && !isWelcome ? ' ' + s.slotEmpty : '')}
          /* ⭐ `isOver` is the ONLY drag feedback now that nothing slides: the
             slot under the pointer lights up, so the destination is visible
             BEFORE you let go rather than explained afterwards. ⛔ Not applied
             to the row being dragged — a card cannot land on itself. */
          style={{ border: `1px solid ${isOver && !isDragging ? 'var(--neon2)' : borderCol}`, borderLeft: player?.url && player.url === claim?.mix_link ? '2px solid var(--neon2)' : `1px solid ${isOver && !isDragging ? 'var(--neon2)' : borderCol}`, background: isOver && !isDragging ? 'rgba(0,229,255,.07)' : undefined, borderRadius: isSortable ? (expanded ? '0 10px 0 0' : '0 10px 10px 0') : (expanded ? '10px 10px 0 0' : 10), cursor: 'pointer', marginBottom: 0, flex: 1 }}
          onClick={() => {
            /* ⛔⛔ `!locked` IS LOAD BEARING NOW. `DaySlots` used to null the
               handlers while LOCK SET TIMES was shut, so this line could not
               fire; it passes them through so the panel can show them MUTED,
               and without this guard tapping an open row would book a slot on
               a locked schedule — the one write the lock exists to prevent. */
            if (isEmpty && onFill && !locked) { onFill(); return; }
            /* ⛔ THE READ-ONLY SURFACES STOP HERE — see `expandable` above. The
               panel below is a workspace, and a summary must not open one. */
            if (!expandable) return;
            if (!isHost && !isConfirmed) return; // pending slot — not expandable in public view
            setExpanded(v => !v);
          }}
        >
        {/**
          * ⭐⭐ THE APP'S CARD TREATMENT, LAYERED ONTO THE SLOT (owner,
          * 2026-08-16: "layer the slotcard with all the data from the work
          * item"). ⛔ The same `.bgImg`/`.bgOverlay` pair ProfileCard,
          * EventCard and WorkItemCard use — ⛔ do not restyle it here.
          *
          * ⛔⛔ AN EMPTY SLOT GETS NO PICTURE. "Open slot" names an ABSENCE;
          * there is no act, so there is no photograph, and borrowing one would
          * draw a booking that does not exist. ⚠ This is the same rule
          * WorkItemCard follows for a profile with no image of its own — an
          * absent picture stays absent rather than being filled in.
          *
          * ⚠ `alt=""` — decoration. The act's name is already in the row.
          */}
        {!isEmpty && slotImg && (
          <>
            <img className={s.slotBgImg} src={slotImg} alt="" />
            <div className={s.slotBgOverlay} />
          </>
        )}
        <div className={s.timeBlock} style={{ '--divider-col': borderCol }}>
          <div className={s.timeNum}>{slot.time || '—'}</div>
          {slot.ampm && <div className={s.timeAmPm}>{slot.ampm}</div>}
          {durLabel && <div className={s.timeDur}>{durLabel}</div>}
        </div>
        <div className={s.slotInfo}>
          <div className={s.djNameRow}>
            {/* ⛔ NOT ON A PROGRAMME ITEM. Headphones say "an act plays here",
                and a welcome to country or a stage close is not an act — the
                icon claimed a performer where there is none.
                ⚠ An OPEN slot keeps it: that row is waiting for an act, and the
                icon is what says so. The test is a LABEL standing in for a
                name, ⛔ not emptiness. */}
            {!isInfoCard && <HeadphoneIcon />}
            {/* ⭐ THE ACT'S NAME IS SET IN CAPS (owner, 2026-08-22) — the same
                weight the LINEUP cards read at, where the caps come from Bebas
                Neue being an all-caps face rather than from a transform.
                ⛔ THE CAPS ARE A TREATMENT, ⛔ NOT THE DATA. `6ixy` and `Jemz¥`
                are how those acts spell themselves, and uppercasing the stored
                name would push a display choice into every surface that reads
                it — a message, a search result, a claim request.
                ⛔ AND NOT ON "Open slot", which is italic lowercase on purpose:
                it names an ABSENCE rather than an act, and shouting it would
                make an empty slot the loudest row on the bill. */}
            {/* ⭐⭐ A LABELLED SLOT WITH NO ACT IS NOT AN OPEN SLOT. A welcome to
                country, a changeover, a stage close: the time is SPOKEN FOR, so
                calling it open invites a host to book over a ceremony and tells
                a reader nothing is happening when something is.
                ⛔ It is also NOT an act. No artwork, no DRAFT chip and no route
                to a profile, because there is no artist behind it — those all
                key off `claim`, which is absent, so this needs no exception.
                ⚠ Upright and unmuted, unlike "Open slot": the italic lowercase
                is reserved for a genuine absence. */}
            <span
              /* ⭐ An info card's heading is a LABEL, not a name — see
                 `.slotLabelHeading`. ⛔ Only the marker cards take it. */
              className={`${s.djName} ${isEmpty && !isInfoCard ? '' : s.djNameCaps}${isInfoCard ? ' ' + s.slotLabelHeading : ''}`}
              style={{
                color: isEmpty && !isInfoCard ? 'var(--muted)'
                  : publicName === 'PENDING' ? 'var(--muted)'
                    : isDraft && !isEmpty ? 'rgba(255,255,255,.6)' : 'var(--text)',
                fontStyle: isEmpty && !isInfoCard ? 'italic' : 'normal',
              }}
            >
              {isInfoCard ? cleanLabel : isEmpty ? 'Open slot' : publicName}
            </span>
            {/* Identity before slot status, same order as every other surface.
                .djNameRow is already flex with a 6px gap and .djName carries
                nowrap + ellipsis, so the name yields width and the badge needs
                no spacing of its own. */}
            <UnclaimedBadge profile={claim?.profile} />
            {isHost && isDraft && (
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 9, letterSpacing: 1.5, color: 'rgba(255,255,255,.35)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>DRAFT</span>
            )}
            {/**
              * ⭐⭐ A DECLINED SLOT SAYS SO (owner, 2026-08-15).
              *
              * ⚠⚠ IT ALREADY LOOKED DIFFERENT AND NEVER SAID WHY. `isSortable`
              * in DaySlots excludes a declined claim, which is correct — a slot
              * the artist turned down is not a booking you reorder — but the
              * only visible consequence was a MISSING DRAG HANDLE. The row lost
              * its grip and gave no reason, so it read as a rendering glitch
              * rather than as an answer somebody gave.
              *
              * ⛔ HOST ONLY, like DRAFT beside it. Who said no is the
              * organiser's business; the public page shows the slot as
              * unfilled, ⛔ not as rejected.
              *
              * ⚠ "ARTIST DECLINED", matching the LINEUP tab's wording exactly —
              * `applications.declined` is the HOST declining an application and
              * this is the opposite party. Two systems share the word, so
              * neither surface may use it bare.
              */}
            {/**
              * ⚠⚠ WHY THIS SURVIVES ON THE MINIMISED ROW while the chip states
              * the same thing in the panel: a declined slot loses its DRAG
              * HANDLE, and a row that silently loses its grip reads as a
              * rendering glitch rather than as an answer somebody gave. The
              * chip is one tap away inside the panel; the missing handle is
              * visible immediately, so its explanation has to be too.
              */}
            {isHost && claimStatus === 'declined' && (
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 9, letterSpacing: 1.5, color: '#FF3399', border: '1px solid rgba(255,51,153,.4)', borderRadius: 3, padding: '1px 5px', flexShrink: 0, whiteSpace: 'nowrap' }}>ARTIST DECLINED</span>
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
          {/* ⚠ ⛔ NOT WHEN THE LABEL IS ALREADY THE NAME. On a slot with no act
              the label IS the heading, and the chip repeated it directly
              underneath. The chip exists to annotate an act ("Sunset Set" under
              a DJ), so it only earns its place when there is an act to annotate. */}
          {cleanLabel && !isInfoCard && (
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
          {/**
            * ⚠ THE SAME CHEVRON AS `WorkItemCard`, AIMED THE SAME WAY (owner,
            * 2026-08-16). This was the text glyph `›` rotated 90°, so one
            * screen had a caret that pointed RIGHT when closed and DOWN when
            * open, while the cards above had one pointing DOWN when closed and
            * UP when open — two disclosure languages for one gesture.
            *
            * ⛔ A TYPOGRAPHIC GLYPH IS NOT A MARK. `›` is sized by whatever
            * font resolves it and never aligns to a drawn icon, which is the
            * same reason `DecisionButtons` replaced `★ ✓ ✗` with outlines.
            *
            * ⭐ RIGHT at rest, DOWN when open — the motion this row always had,
            * now with the drawn mark and matched by `WorkItemCard`.
            */}
          {/**
            * ⚠ THE HEART MOVED INTO THE PANEL (owner, 2026-08-16), so the
            * column that held it above the chevron is gone — the chevron sits
            * in this row directly rather than alone inside a wrapper that
            * exists for a sibling it no longer has.
            *
            * ⛔ The trade the move makes, stated rather than discovered:
            * following an artist requires OPENING the slot.
            */}
          {(isHost || isConfirmed) && (
            <span className={s.slotChevron} aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .18s' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </span>
          )}
        </div>
        </div>
      </div>

      {/* ⭐⭐ AN INFO CARD OPENS TOO, for its host. It was inert: expanding a
          stage close showed nothing at all, so its time, length and wording
          could not be changed from the schedule where you are looking at them.
          ⚠ `isHost` alone — a punter has nothing to do with a stage close, and
          the `isConfirmed || claim` arms are about an ACT's own view of its
          booking, which an info card has none of.
          ⛔ The controls inside need no new gates: EDIT SLOT asks only for
          `onEdit`, while REPLACE / REMOVE and the person actions already gate
          on `claim` and so stay away by themselves. */}
      {expanded && (isInfoCard ? isHost : !isEmpty && (isHost || isConfirmed || claim)) && (
        <div style={{ background: 'var(--card2)', border: `1px solid ${borderCol}`, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '10px 13px' }}>

          {/**
            * ⭐⭐ THE EXPANDED SLOT, TRIMMED TO A HIERARCHY (owner, 2026-08-16).
            *
            * The order is stated rather than inherited: STATUS · RELATIONSHIP ·
            * CONTEXT · SLOT CONTROLS · REPLACEMENT. It previously opened with a
            * scrolling pill rail and put the status three rows down, so the
            * first thing a host read was genre and the last was whether the
            * artist had actually said yes.
            *
            * ⛔ REMOVED IN THIS PASS: the Instagram / SoundCloud / Mixcloud /
            * YouTube / website row, and the `+N more` genre overflow. Both were
            * browsing material on a card whose job is running a night.
            *
            * ⛔ NO NEW DATA OR BEHAVIOUR — presentation and action surface only.
            * MESSAGE is the one addition, and it calls the existing
            * `openDirectConversation`.
            */}

          {/**
            * ── 1 · WHO THEY ARE, AND WHERE THEY STAND — one line ────────────
            *
            * ⭐ Tags left, status right (owner, 2026-08-16). The act's own five
            * words and the artist's answer are the two things a host reads
            * first, so they share the top line rather than stacking.
            *
            * ⚠ FIVE tags, matching the act's curated "Your 5 Tags" and the
            * lineup card's panel. ⛔ No `+N more` — a rail of twenty pills is
            * browsing, not context.
            */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 9 }}>
            {(() => {
              /* ⛔⛔ `actPills`, ⛔ NOT a split here. This read
                 `claim.genre.split(/[·,|/]+/)` and printed the pieces, so a DJ
                 whose `genre_string` holds the role key `dj_prod` got a pill
                 reading literally `dj_prod`. `genre_string` carries ROLE KEYS
                 as well as genres and only `genreLabels()` knows the
                 difference. ⚠ An empty result is normal and renders nothing. */
              const all = actPills(claim);
              if (!all.length) return <div style={{ flex: 1 }} />;
              const usingCardPills = !!claim?.card_pills?.length;
              return (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minWidth: 0 }}>
                  {all.slice(0, 5).map(g => (
                    usingCardPills
                      ? <span key={g} className="glow-pill" style={{ whiteSpace: 'nowrap' }}>{g}</span>
                      : <span key={g} style={{ fontSize: 10, fontFamily: "'DM Sans',sans-serif", background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.25)', color: '#fff', borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap' }}>{g}</span>
                  ))}
                </div>
              );
            })()}

            {/* ⭐⭐ THE PUNTER'S WAY INTO THE ACT (owner, 2026-08-20). The same
                control the host gets, in the same place on the line — ⛔ not a
                simplified public variant. Without it the published timetable
                was a dead end: a reader could open a card and find no route to
                the artist. MESSAGE self-gates on `viewerProfileId`, which a
                public surface does not supply, so a punter gets VIEW PROFILE
                alone without an `isHost` test being needed here. */}
            {!isHost && (
              <PersonActions
                claim={claim} viewerProfileId={viewerProfileId} navigate={navigate}
                msgBusy={msgBusy} setMsgBusy={setMsgBusy}
              />
            )}

            {/* ⚠ The status chip, ⛔ no longer on a line of its own.
                ⛔ AND NOT ON AN INFO CARD. Every value it can show is about an
                ACT — "NAME ADDED", "AWAITING REPLY", "BOOKED" — and with no
                claim it fell through to `name_added`, so a stage close
                announced that a name had been added to it. */}
            {isHost && !isInfoCard && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, background: chip.bg, border: `1px solid ${chip.border}`, color: chip.color, borderRadius: 6, padding: '3px 10px', whiteSpace: 'nowrap' }}>
                {chip.icon}{chip.label}
              </span>
            )}

            {/**
              * ⭐⭐ P6.2 · WHAT HAVE WE ACTUALLY TOLD THIS ARTIST?
              *
              * ⚠⚠ A SECOND CHIP, ⛔ NOT a replacement for the one above. They
              * answer different questions and conflating them is the defect
              * `lib/notifyPlan` exists to end: the chip on the left is the
              * artist's ANSWER (draft, awaiting, confirmed), this one is whether
              * the set time has been COMMUNICATED. An artist can be confirmed on
              * a time they were told about and then quietly moved.
              *
              * ⛔ ONLY WHEN THERE IS WORK. `needsNotice` is false for CLEAN and
              * for an artist who is not booked, and a chip that says "nothing to
              * do" on every row is noise that hides the rows that matter.
              *
              * ⛔ NOT A BUTTON. P6.2 is read-only; nothing here sends.
              */}
            {isHost && claim?.notify?.needsNotice && (
              /**
                * ⭐⭐ P6.3 · THE CHIP IS THE BUTTON when there is somebody to tell.
                *
                * ⛔ ONLY WHEN `onNotify` IS GIVEN. The event page passes it; the
                * DASHBOARD DOES NOT, because that screen is triage and sending a
                * message is a workspace act. ⚠ Same rule as `onFill`: the handler
                * says the verb exists here, ⛔ its absence is not a disabled
                * control but no control at all.
                *
                * ⚠ `stopPropagation`, or tapping it would also expand the card.
                */
              onNotify ? (
                <button
                  onClick={e => { e.stopPropagation(); onNotify(); }}
                  title="Tell this artist about this set time"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, fontSize: 10.5, fontFamily: "'Bebas Neue'", letterSpacing: 1.1, background: 'rgba(255,140,66,.14)', border: '1px solid rgba(255,140,66,.5)', color: '#FF8C42', borderRadius: 6, padding: '4px 9px', whiteSpace: 'nowrap', cursor: 'pointer' }}
                >
                  {claim.notify.label} <span aria-hidden style={{ opacity: .8 }}>›</span>
                </button>
              ) : (
                <span title="This artist has not been told about this set time"
                  style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, fontSize: 10.5, fontFamily: "'Bebas Neue'", letterSpacing: 1.1, background: 'rgba(255,140,66,.14)', border: '1px solid rgba(255,140,66,.5)', color: '#FF8C42', borderRadius: 6, padding: '3px 9px', whiteSpace: 'nowrap' }}>
                  {claim.notify.label}
                </span>
              )
            )}

            {/**
              * ⭐ THE HEART, TOP RIGHT OF THE PANEL, RIGHT OF THE CHIP (owner,
              * 2026-08-16). ⚠ This REVERSES the earlier "above the chevron, ⛔
              * not in the panel" from the same day — the note it replaced is
              * gone rather than left to contradict this one.
              *
              * ⚠⚠ IT SITS OUTSIDE THE `isHost` GATE ON PURPOSE. The chip beside
              * it is host-only; the heart is not, and nesting it there would
              * have quietly removed following for every non-host viewer. The
              * ROW renders for everyone, which is why it can live here at all.
              *
              * ⚠ 44px of TARGET on 22px of LAYOUT — the negative vertical
              * margin keeps the generous hit area without making the top line
              * twice as tall as the chip it sits next to.
              */}
            {claim?.user_id && session?.user?.id && (
              <button
                onClick={async e => {
                  e.stopPropagation();
                  if (followBusy) return;
                  setFollowBusy(true);
                  if (followed) {
                    /* ⚠ BOTH KEYSPACES. This deleted on `entity_id` alone, and
                       the follow branch below writes BOTH `entity_id` and
                       `target_profile_id` — so an unfollow left the canonical
                       row behind and the artist stayed on the follower's list.
                       `unfollowProfile` spans both, exactly as ProfileScreen's
                       and the card heart's unfollow already did; going through
                       the shared function also keeps the `followedProfiles`
                       cache in step, which the hand-rolled delete never did. */
                    const targetProfileId = await resolveProfileId(claim.user_id, 'artist');
                    await unfollowProfile(session.user.id, {
                      id: targetProfileId || claim.user_id,
                      user_id: claim.user_id,
                      type: 'artist',
                      name: claim.name,
                    });
                    setFollowed(false);
                  } else {
                    const targetProfileId = await resolveProfileId(claim.user_id, 'artist');
                    /* M6 (R6.1): from_profile_id is the follower (Personal);
                       target_profile_id is who is being followed. ⛔ Two ends,
                       two columns — never conflate them. */
                    const fromProfileId = await getPersonalProfileId(session.user.id);
                    await supabase.from('follows').insert({ user_id: session.user.id, from_profile_id: fromProfileId, entity_id: claim.user_id, entity_type: 'artist', entity_name: claim.name, target_profile_id: targetProfileId });
                    track(EVENTS.FOLLOWED, { entity_type: 'artist' });
                    setFollowed(true);
                  }
                  setFollowBusy(false);
                }}
                title={followed ? 'Following' : 'Follow'}
                aria-label={followed ? 'Following' : 'Follow'}
                aria-pressed={followed}
                style={{ width: 44, height: 44, margin: '-11px -12px -11px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: followed ? '#FF2D78' : 'rgba(255,255,255,.45)', transition: 'color .15s' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill={followed ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z"/>
                </svg>
              </button>
            )}
          </div>

          {/**
            * ⭐ ADD TO CALENDAR — the confirmed set as a standard .ics file.
            *
            * ⛔ HANDLER-GATED, the card's own law: the surfaces that can build
            * a calendar event (SchedulePortrait, holding the event and venue)
            * pass the handler, and they pass it ONLY for a confirmed set the
            * schedule can place on a clock — `lib/calendarEvent` owns that
            * gate. A draft, offered, declined or timeless slot never sees
            * this control, and no second copy of the eligibility rules lives
            * here.
            */}
          {onAddToCalendar && (
            <div style={{ marginBottom: isHost ? 9 : 0 }}>
              <SlotManageBtn
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>}
                label="ADD TO CALENDAR"
                accent="#4A9EFF"
                onClick={e => { e.stopPropagation(); onAddToCalendar(); }}
              />
            </div>
          )}

          {isHost && (
            <>
              {/**
                * ⛔⛔ `BOOK ARTIST` IS GONE FROM THIS PANEL (owner, 2026-08-16).
                *
                * ⚠⚠ IT WAS OFFERED ON A SLOT THAT ALREADY HAD AN ARTIST. This
                * whole block renders only when `!isEmpty` — an EMPTY slot never
                * opens it, because tapping an empty row calls `onFill` directly
                * (see the row's own onClick). So the button appeared on exactly
                * the slots where "book an artist" is the wrong verb: somebody is
                * already there, and the honest action is REPLACE.
                *
                * ⚠ It was gated on `!isConfirmed`, which meant an AWAITING or
                * DECLINED slot showed BOOK ARTIST while a BOOKED one showed
                * REPLACE ARTIST — two names for one operation, chosen by
                * whether the artist had answered yet.
                *
                * ⭐ The action is state-dependent and now says so:
                *     empty slot        → the row itself books (⛔ not here)
                *     artist attached   → REPLACE ARTIST
                *     artist declined   → REPLACE ARTIST
                */}

              {/* Confirm dialog */}
              {confirm && (
                <div onClick={e => e.stopPropagation()} style={{ background: 'rgba(255,45,120,.08)', border: '1px solid rgba(255,45,120,.3)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
                  {/**
                    * ⭐⭐ ONE BUTTON, TWO ANSWERS (owner, 2026-08-16: "replace /
                    * remove can be one button").
                    *
                    * ⚠⚠ They were two buttons in the panel, which spent two
                    * slots of the action row on the same question — is this act
                    * staying? ⛔ The question is asked once; the CHOICE moves
                    * here, where it is already being confirmed.
                    *
                    * ⛔ BOTH ARE DESTRUCTIVE AND NEITHER IS THE DEFAULT. Cancel
                    * sits first and unstyled; the two live options are stated in
                    * full so nobody presses "yes" to whichever one they had in
                    * mind. ⚠ REPLACE goes on to a picker, REMOVE does not.
                    */}
                  <p style={{ margin: '0 0 10px', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.2, color: '#fff' }}>
                    {claim?.name ? `${claim.name} is on this slot.` : 'This slot has an artist.'} What would you like to do?
                  </p>
                  {/**
                    * ⛔⛔ `REMOVE` MEANT ONE THING AND READ AS ANOTHER (owner,
                    * 2026-08-16: "i removed enlil from the set times which is
                    * essentially the lineup, so he should have gone back to
                    * short list").
                    *
                    * ⚠⚠ It ran `planUnassign` — clear the SET TIME, stay on the
                    * bill — while the word promised the act was gone. The
                    * organiser pressed it expecting the bill exit and got a
                    * still-booked artist with no time.
                    *
                    * ⭐⭐ SO THE TWO ANSWERS ARE NAMED, ⛔ not merged and ⛔ not
                    * guessed. `CLEAR SET TIME` keeps them on the bill needing a
                    * time; `MOVE TO SHORTLIST` takes them off it. ⚠⚠ This is
                    * the same defect that once made UNASSIGN and DISCARD one
                    * destructive operation: two outcomes behind one word.
                    */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => { setConfirm(null); }}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.05)', fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2, color: 'var(--muted)', cursor: 'pointer' }}
                    >CANCEL</button>
                    {onRemove && (
                      <button
                        onClick={() => { setConfirm(null); onRemove(); }}
                        style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid rgba(255,255,255,.22)', background: 'rgba(255,255,255,.05)', fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2, color: 'var(--text)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >CLEAR SET TIME</button>
                    )}
                    {/* ⭐ THE BILL EXIT, from the tab the owner reads AS the
                        bill. ⛔ Rendered only where the surface supplies it. */}
                    {onDemote && (
                      <button
                        onClick={() => { setConfirm(null); onDemote(); }}
                        style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid rgba(255,45,120,.5)', background: 'rgba(255,45,120,.12)', fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2, color: '#FF2D78', cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >MOVE TO SHORTLIST</button>
                    )}
                    {onFill && (
                      <button
                        onClick={() => { setConfirm(null); onFill(); }}
                        style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: '#FF2D78', fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2, color: '#fff', cursor: 'pointer' }}
                      >REPLACE</button>
                    )}
                  </div>
                </div>
              )}

              {/**
                * ── 2 · ONE ACTION LINE (owner, 2026-08-16) ──────────────────
                *
                *   EDIT SLOT · REPLACE / REMOVE · MESSAGE · VIEW PROFILE →
                *
                * ⭐ Left to right: what you do to the SLOT, then what you do
                * with the PERSON. They were two stacked rows; one line does the
                * same work in half the height.
                *
                * ⚠ COLOURED BORDER, WHITE TEXT on the two host buttons — the
                * colour classifies the action, the white keeps the label
                * readable. Coloured-on-coloured was the least legible thing in
                * the old panel.
                *
                * ⛔⛔ EACH GATED ON ITS OWN HANDLER. "Pass no handler" means
                * "offer no button" — that rule is why the dashboard shows EDIT
                * SLOT alone with no dead REMOVE beside it.
                *
                * ⛔ LOCK IS NOT HERE. It is the padlock icon, which both shows
                * the state and toggles it; a boolean needs neither a full-width
                * button nor a status chip.
                */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                {/**
                  * ⭐ THE PADLOCK IS THE WHOLE CONTROL — it SHOWS that the slot
                  * is locked and TOGGLES it. ⛔ The old LOCK SLOT button and the
                  * LOCKED status chip are both gone; two elements for one
                  * boolean is what made this panel crowded.
                  *
                  * ⚠ First in the line: it governs whether the slot moves at
                  * all, which is prior to editing it or changing who is on it.
                  */}
                {/**
                  * ⚠ VISIBLE BUT MUTED WHEN THE SET TIMES ARE LOCKED (owner,
                  * 2026-08-16), ⛔ no longer hidden. It was `!locked && onPin`,
                  * so a shut screen padlock removed this control and left the
                  * two muted buttons beside it with no lock in sight.
                  *
                  * ⭐ ALL THREE NOW MUTE TOGETHER — the row reads as one locked
                  * group rather than as a gap plus two grey buttons.
                  */}
                {onPin && (
                  <button
                    disabled={!!locked}
                    aria-disabled={!!locked}
                    onClick={e => { e.stopPropagation(); if (locked) return; onPin(); }}
                    title={locked ? lockReason : (slot.pinned ? 'Locked — tap to unlock' : 'Lock this slot')}
                    aria-label={locked ? lockReason : (slot.pinned ? 'Locked, tap to unlock' : 'Lock this slot')}
                    aria-pressed={!!slot.pinned}
                    /* ⭐ THE ICON IS WHITE (owner, 2026-08-16) — it was amber
                       when pinned and muted when not. ⚠ THE CHIP AROUND IT IS
                       UNTOUCHED while the tab is unlocked: the amber border and
                       fill still mark a pinned slot, and the shackle still
                       opens and closes.
                       ⚠ MUTED, the whole control greys to match EDIT SLOT and
                       REPLACE / REMOVE. ⛔ The shackle still shows pinned or
                       not — colour is the redundant half of that signal. */
                    style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderRadius: 9, cursor: locked ? 'not-allowed' : 'pointer', border: `1px solid ${locked ? 'rgba(255,255,255,.10)' : slot.pinned ? 'rgba(255,184,48,.55)' : 'var(--border)'}`, background: locked ? 'rgba(255,255,255,.03)' : slot.pinned ? 'rgba(255,184,48,.10)' : 'rgba(255,255,255,.03)', color: locked ? 'rgba(255,255,255,.28)' : '#fff', transition: 'color .15s, border-color .15s, background .15s' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2"/>
                      {/* ⚠ Shackle CLOSED when pinned, open when not. */}
                      {slot.pinned ? <path d="M7 11V7a5 5 0 0 1 10 0v4"/> : <path d="M7 11V7a5 5 0 0 1 9.9-1"/>}
                    </svg>
                  </button>
                )}
                {/**
                  * ⭐⭐ A SHUT PADLOCK MUTES THESE, ⛔ it no longer removes them
                  * (owner, 2026-08-16). They used to be gated on `!locked`, so
                  * closing the padlock beside the SET TIMES heading DELETED
                  * them from the panel and the panel changed shape as the lock
                  * turned. They now stay where the eye left them and simply
                  * stop being available.
                  *
                  * ⛔⛔ ONLY `locked` MUTES — that is LOCK SET TIMES, the
                  * padlock beside the SET TIMES heading, which governs the
                  * whole tab.
                  *
                  * ⚠⚠ ⛔ NOT `slot.pinned`. I briefly muted on that too and it
                  * was wrong: pinning holds ONE row in place so a drag cannot
                  * move it, and it has never stopped anyone editing the slot or
                  * changing who is on it. Two padlocks sit near each other here
                  * and they answer different questions — ⛔ do not merge them
                  * again.
                  */}
                {onEdit && (
                  <SlotManageBtn
                    icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>}
                    label="EDIT SLOT"
                    accent="#4A9EFF"
                    muted={!!locked}
                    mutedReason={lockReason}
                    onClick={e => { e.stopPropagation(); onEdit(); }}
                  />
                )}
                {/* ⚠ Gated on `claim`: with nobody on the slot there is nobody
                    to replace or remove. ⛔ An empty row books through its own
                    onClick, not through here. */}
                {claim && (onFill || onRemove || onDemote) && (
                  <SlotManageBtn
                    icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>}
                    label="REPLACE / REMOVE"
                    muted={!!locked}
                    mutedReason={lockReason}
                    onClick={e => { e.stopPropagation(); setConfirm('choose'); }}
                    danger
                  />
                )}

                {/**
                  * ⭐ THE PERSON ACTIONS SIT RIGHT (owner, 2026-08-16).
                  * `marginLeft: auto` splits the line: what you do to the SLOT
                  * stays left, what you do with the PERSON goes to the far
                  * edge. ⚠ Their own flex group, so they stay together when the
                  * row wraps on a narrow screen.
                  */}
                <PersonActions
                  claim={claim} viewerProfileId={viewerProfileId} navigate={navigate}
                  msgBusy={msgBusy} setMsgBusy={setMsgBusy}
                />
              </div>

              {/* ── ⚠ NOTES ARE HIDDEN BECAUSE THEY NEVER SAVED ──────────────
                  `hostNote` and `artistBrief` below are local state with no
                  write path and no column behind them. The Artist Brief was
                  labelled "Visible to artist" and its placeholder invited
                  arrive times, load-in instructions and set length — none of
                  which ever reached the artist, or survived closing the card.

                  ⭐ A FEATURE THAT LIES IS WORSE THAN ONE THAT IS ABSENT. An
                  organiser who types load-in details here has done the job as
                  far as they can tell, and finds out on the night. Hidden
                  rather than deleted: persisting this needs a column and an RLS
                  policy that lets the act read their brief while host notes
                  stay private, which is real work and is on the hardening
                  backlog. Turning it back on is deleting this flag, and the
                  markup below is kept intact for exactly that. */}
              {NOTES_PERSISTENCE_READY && (
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
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * @param muted ⭐ SHOWN BUT NOT OFFERED (owner, 2026-08-16). A locked slot keeps
 *   EDIT SLOT and REPLACE / REMOVE on screen instead of removing them, so the
 *   panel does not change SHAPE as the padlock turns — the controls stay where
 *   the eye left them and simply stop being available.
 *
 * ⛔ IT IS A REAL `disabled`, ⛔ not just grey paint. A control that looks
 * unavailable and still fires is worse than either state on its own, and this
 * one destroys performances. The hover lift is dropped with it, or the button
 * would brighten under the pointer while refusing to act.
 */
function SlotManageBtn({ icon, label, sub, onClick, accent = '#888', danger, muted, mutedReason }) {
  const hex = danger ? '#FF2D78' : accent;
  const rgb = {
    '#4A9EFF': '74,158,255',
    '#FFB830': '255,184,48',
    '#FF2D78': '255,45,120',
    '#888':    '136,136,136',
  }[hex] || '136,136,136';
  if (muted) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: sub ? 4 : 0 }}>
        <button
          disabled
          aria-disabled="true"
          /* ⚠ The reason, ⛔ not just the fact. A disabled control with no
             explanation reads as broken. */
          title={mutedReason || 'Locked. Unlock to make changes.'}
          style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 11px', borderRadius: 9, border: '1px solid rgba(255,255,255,.10)', background: 'rgba(255,255,255,.03)', cursor: 'not-allowed', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.2, color: 'rgba(255,255,255,.38)', lineHeight: 1.1 }}>{label}</span>
        </button>
        {sub && <span style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.3, textAlign: 'center' }}>{sub}</span>}
      </div>
    );
  }
  return (
    /* ⚠ `sub` IS OPTIONAL NOW. The caption under each button cost a 9px line
       plus a 5px gap on every control, and "EDIT SLOT" does not need "Time,
       duration & details" underneath it. ⛔ Kept as a prop rather than deleted:
       a future control with a genuinely ambiguous label can still explain
       itself. */
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: sub ? 4 : 0 }}>
      <button onClick={onClick}
        onMouseEnter={e => { e.currentTarget.style.background = `rgba(${rgb},.2)`; e.currentTarget.style.borderColor = hex; }}
        onMouseLeave={e => { e.currentTarget.style.background = `rgba(${rgb},.07)`; e.currentTarget.style.borderColor = `rgba(${rgb},.35)`; }}
        /* ⚠ COLOURED BORDER, WHITE TEXT (owner, 2026-08-16). The hue classifies
           the action; the label stays white so it is actually readable. ⛔ The
           old coloured-on-coloured text was the least legible thing here.
           ⚠ The ICON keeps the accent — it carries the colour without costing
           legibility. */
        style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 11px', borderRadius: 9, border: `1px solid rgba(${rgb},.55)`, background: `rgba(${rgb},.10)`, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background .15s, border-color .15s' }}>
        <span style={{ color: hex, display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.2, color: '#fff', lineHeight: 1.1 }}>{label}</span>
      </button>
      {sub && <span style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.3, textAlign: 'center' }}>{sub}</span>}
    </div>
  );
}
