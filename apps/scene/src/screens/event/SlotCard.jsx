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
import { track, EVENTS } from '../../lib/analytics';
import { openDirectConversation } from '../../lib/messaging';
import UnclaimedBadge from '../../components/UnclaimedBadge';
import { profileIdentity } from '../../lib/profileTypes';
import { parseDurMins, fmtDur, labelColor, stripEmoji } from './slotUtils';
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
 * ⭐ So the dashboard stays TRIAGE — the same rule its LINEUP tab follows by
 * passing no `actions`. Scheduling happens on the event page.
 */
export default function SlotCard({ slot, claim, onFill, onEdit, onRemove, onPin, isHost, isSortable, isActiveSort, isDragOverlay, allMixSlots = [], locked = false, viewerProfileId = null, expandable = true, registerNode }) {
  const [expanded,      setExpanded]      = useState(false);
  const [hostNote,      setHostNote]      = useState('');
  const [artistBrief,   setArtistBrief]   = useState('');
  const [notesBoxOpen,  setNotesBoxOpen]  = useState(false);
  const [briefOpen,     setBriefOpen]     = useState(false);
  const [hostNoteOpen,  setHostNoteOpen]  = useState(false);
  const [historyOpen,   setHistoryOpen]   = useState(false);
  const [followed,      setFollowed]      = useState(false);
  const [followBusy,    setFollowBusy]    = useState(false);
  const [confirm,       setConfirm]       = useState(null); // 'replace' | 'remove'
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
    || profileIdentity(String(claim.profile?.type || 'artist').toLowerCase()).defaultImage
    || null
  );

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
          className={s.slot + (isEmpty ? ' ' + s.slotEmpty : '')}
          /* ⭐ `isOver` is the ONLY drag feedback now that nothing slides: the
             slot under the pointer lights up, so the destination is visible
             BEFORE you let go rather than explained afterwards. ⛔ Not applied
             to the row being dragged — a card cannot land on itself. */
          style={{ border: `1px solid ${isOver && !isDragging ? 'var(--neon2)' : borderCol}`, borderLeft: player?.url && player.url === claim?.mix_link ? '2px solid var(--neon2)' : `1px solid ${isOver && !isDragging ? 'var(--neon2)' : borderCol}`, background: isOver && !isDragging ? 'rgba(0,229,255,.07)' : undefined, borderRadius: isSortable ? (expanded ? '0 10px 0 0' : '0 10px 10px 0') : (expanded ? '10px 10px 0 0' : 10), cursor: 'pointer', marginBottom: 0, flex: 1 }}
          onClick={() => {
            if (isEmpty && onFill) { onFill(); return; }
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
          {(isHost || isConfirmed) && (
            <span className={s.slotChevron} aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .18s' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </span>
          )}
        </div>
        </div>
      </div>

      {expanded && !isEmpty && (isHost || isConfirmed || claim) && (
        <div style={{ background: 'var(--card2)', border: `1px solid ${borderCol}`, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '14px 16px' }}>

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

          {/* ── 1 · STATUS ─────────────────────────────────────────────── */}
          {isHost && (() => {
            const cStatus = claim?.status || (claim?.user_id ? 'pending' : 'name_added');
            const chip = {
              name_added: { label: 'NAME ADDED', bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.15)', color: 'var(--muted)', icon: null },
              pending:    { label: 'AWAITING REPLY', bg: 'rgba(255,184,48,.10)', border: 'rgba(255,184,48,.35)', color: '#FFB830', icon: null },
              offered:    { label: 'AWAITING REPLY', bg: 'rgba(255,184,48,.10)', border: 'rgba(255,184,48,.35)', color: '#FFB830', icon: null },
              draft:      { label: 'SET TIME NOT SENT', bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.15)', color: 'var(--muted)', icon: null },
              /* ⚠ "ARTIST DECLINED", matching the LINEUP tab exactly — the host
                 declining an APPLICATION is a different event that shares the
                 word, so neither surface may use it bare. */
              declined:   { label: 'ARTIST DECLINED', bg: 'rgba(255,51,153,.10)', border: 'rgba(255,51,153,.40)', color: '#FF3399', icon: null },
              confirmed:  { label: 'BOOKED', bg: 'rgba(0,200,100,.10)', border: 'rgba(255,255,255,.15)', color: '#00C864',
                icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> },
            }[cStatus] || { label: cStatus.toUpperCase(), bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.15)', color: 'var(--muted)', icon: null };
            const claimedByArtist = cStatus === 'confirmed' && !!claim?.user_id;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, background: chip.bg, border: `1px solid ${chip.border}`, color: chip.color, borderRadius: 6, padding: '3px 10px' }}>
                  {chip.icon}{chip.label}
                </span>
                {claimedByArtist && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.15)', color: 'var(--muted)', borderRadius: 6, padding: '3px 10px' }}>
                    ACCEPTED BY ARTIST
                  </span>
                )}
                {slot.pinned && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1.2, background: 'rgba(255,184,48,.10)', border: '1px solid rgba(255,184,48,.35)', color: '#FFB830', borderRadius: 6, padding: '3px 10px' }}>
                    LOCKED
                  </span>
                )}
              </div>
            );
          })()}

          {/* ── 2 · RELATIONSHIP — follow · message · profile ───────────────
              ⚠ These change YOUR relationship to a person. The slot controls
              below change THEIR place in your night, which is why the two are
              separate rows and not one row of six. */}
          {claim?.user_id && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
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
              {/* ⛔ MESSAGE NEEDS AN EXPLICIT SENDER. `openDirectConversation`
                  takes a FROM profile and this account may hold several —
                  `profiles.user_id` is shared across a multi-profile account —
                  so the surface states who it is acting as, or the button is
                  not offered. */}
              {viewerProfileId && claim.profile_id && (
                <button
                  onClick={async e => {
                    e.stopPropagation();
                    if (msgBusy) return;
                    setMsgBusy(true);
                    const { conversationId } = await openDirectConversation(viewerProfileId, claim.profile_id);
                    setMsgBusy(false);
                    if (conversationId) navigate(`/messages/${conversationId}`);
                  }}
                  style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)', color: 'var(--muted)' }}
                >{msgBusy ? 'OPENING…' : 'MESSAGE'}</button>
              )}
              <button
                onClick={e => { e.stopPropagation(); navigate(claim.profile_id ? `/profile/${claim.profile_id}?prefer=performer` : `/profile/${claim.user_id}?prefer=performer`); }}
                style={{ flexShrink: 0, fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1.5, background: 'none', border: 'none', padding: '5px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
              ><span style={{ background: 'linear-gradient(135deg,#00E5FF,#BF5FFF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>VIEW PROFILE →</span></button>
            </div>
          )}

          {/* ── 3 · CONTEXT — up to five tags, ⛔ no overflow control ────────
              ⚠ FIVE, matching the act's own curated "Your 5 Tags" and the
              lineup card's panel. The `+N more` button expanded a rail that
              could run to twenty pills, which is browsing, not context. */}
          {(claim?.card_pills?.length || claim?.genre) && (() => {
            const usingCardPills = !!claim.card_pills?.length;
            const raw = usingCardPills ? claim.card_pills : claim.genre;
            const all = Array.isArray(raw)
              ? raw
              : raw.split(/[·,|/]+/).map(g => g.trim()).filter(Boolean);
            return (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
                {all.slice(0, 5).map(g => (
                  usingCardPills
                    ? <span key={g} className="glow-pill" style={{ whiteSpace: 'nowrap' }}>{g}</span>
                    : <span key={g} style={{ fontSize: 10, fontFamily: "'DM Sans',sans-serif", background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.25)', color: '#fff', borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap' }}>{g}</span>
                ))}
              </div>
            );
          })()}

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

              {/**
                * Manage actions — hidden when set times are locked.
                *
                * ⛔⛔ AND EACH ONE IS GATED ON ITS OWN HANDLER (2026-08-16).
                * ⚠⚠ They used to render from `isHost` alone and call
                * `onEdit?.()` / `onPin?.()`, so a surface that supplied no
                * handlers drew three controls — one of them a red REMOVE — that
                * did NOTHING when pressed. That shipped to the dashboard and
                * was caught by looking at a screenshot, ⛔ not by any test.
                *
                * ⭐⭐ THE RULE: a control exists only where its verb does. That
                * makes "pass no handler" mean "offer no button", which is what
                * every caller already assumed it meant.
                *
                * ⚠ The column count is derived, ⛔ not a fixed `1fr 1fr 1fr` —
                * one button in a three-column grid renders a third of a row
                * wide with two empty gaps beside it.
                */}
              {!locked && (onEdit || onPin || onRemove) && (
                <div style={{ paddingTop: 0, marginBottom: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${[onEdit, onPin, onRemove].filter(Boolean).length}, minmax(0, 1fr))`, gap: 8 }}>
                    {onEdit && (
                      <SlotManageBtn
                        icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>}
                        label="EDIT SLOT" sub="Time, duration & details"
                        accent="#4A9EFF"
                        onClick={e => { e.stopPropagation(); onEdit(); }}
                      />
                    )}
                    {onPin && (
                      <SlotManageBtn
                        icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
                        label={slot.pinned ? 'LOCKED' : 'LOCK SLOT'} sub="Prevent this slot from moving"
                        accent="#FFB830"
                        onClick={e => { e.stopPropagation(); onPin(); }}
                      />
                    )}
                    {onRemove && (
                      <SlotManageBtn
                        icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>}
                        label="REMOVE" sub="Remove this artist from slot"
                        onClick={e => { e.stopPropagation(); setConfirm('remove'); }}
                        danger
                      />
                    )}
                  </div>
                </div>
              )}

              {/**
                * ── 5 · REPLACEMENT ────────────────────────────────────────
                * ⭐ LAST, AND ONLY WHERE AN ARTIST IS ATTACHED. It ends the
                * panel because it is the one action that discards what the rest
                * of the card describes.
                *
                * ⚠ Gated on `claim`, ⛔ not on `isConfirmed`. An artist who has
                * not replied yet, and one who has DECLINED, are both still
                * attached to the slot — declined especially is the case where a
                * host most needs to swap somebody in, and it was the case the
                * old `isConfirmed` gate hid it from.
                *
                * ⛔ Withheld while the set times are LOCKED, exactly like the
                * three controls above: a locked slot does not change hands.
                */}
              {claim && !locked && onFill && (
                <div style={{ marginBottom: 14 }}>
                  <button
                    onClick={e => { e.stopPropagation(); setConfirm('replace'); }}
                    style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 12, fontFamily: "'Bebas Neue'", letterSpacing: 1.5, background: 'rgba(255,45,120,.08)', border: '1px solid rgba(255,45,120,.35)', color: '#fff', borderRadius: 8, padding: '9px 12px', cursor: 'pointer', transition: 'background .15s, border-color .15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,45,120,.2)'; e.currentTarget.style.borderColor = 'rgba(255,45,120,.6)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,45,120,.08)'; e.currentTarget.style.borderColor = 'rgba(255,45,120,.35)'; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                    REPLACE ARTIST
                  </button>
                </div>
              )}

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
