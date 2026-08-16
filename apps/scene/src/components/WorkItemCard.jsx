/**
 * THE EVENT WORKSPACE'S CARD — an operational work item, ⛔ not a poster tile.
 *
 * ⭐⭐ THE ACCEPTANCE TEST THIS IS BUILT AGAINST (owner, 2026-08-15). Not "every
 * state is represented" — a host looks at one card and immediately knows:
 *
 *     WHO is this · WHAT state are they in · WHAT happens next ·
 *     WHICH BUTTON does it.
 *
 * ── ⛔ WHY THIS IS A SIBLING OF ProfileCard, NOT A MODE ON IT ───────────────
 *
 * Same SUBJECT (a profile), different SHAPE — which the platform contract says
 * makes it a sibling. `ProfileCard` is a BROWSE card: Discover, My Scene,
 * Messenger contacts, Presented By, where the photograph IS the content and
 * the job is to make you tap through. This is a WORK card: the job is state
 * and action, and the picture is a thumbnail.
 *
 * ⚠ The evidence for splitting rather than adding a mode: ProfileCard had
 * already grown `cover`, then `tags`, then `readiness`, and every new caller
 * had to know which flags to pass. A third "work" mode would have finished
 * turning it into a switchboard.
 *
 * ⛔ IT HOLDS NO STATE MODEL. `applications.status` through `normaliseStatus`
 * and the slot lifecycle through `memberState` are unchanged; this file only
 * chooses WORDS and COLOUR for a state it is handed.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import s from './WorkItemCard.module.css';
import { profileIdentity } from '../lib/profileTypes';
import { genreLabels } from '../lib/profileTaxonomy';
import { openDirectConversation } from '../lib/messaging';
import UnclaimedBadge from './UnclaimedBadge';
import FollowHeartBtn from './FollowHeartBtn';

/**
 * ⭐ THE APPLICATION LADDER, AS THE HOST READS IT.
 *
 * ⚠ `onBill` is NOT an application status and is deliberately not treated as
 * one — it is read from `lineup_members`, and it is the reason ACCEPTED splits
 * into two rows here. An accepted application that is not on the bill still
 * has work outstanding; one that is has none.
 */
export function applicationWorkState(bucket, onBill = false) {
  switch (bucket) {
    case 'new':         return { label: 'NEW APPLICATION', quiet: false };
    /* ⚠ "UNDECIDED", not "SEEN". `seen` is written by LOOKING — expanding a
       card sets it — so the word would describe the host's eyes rather than
       the row's position. */
    case 'seen':        return { label: 'UNDECIDED', quiet: false };
    case 'shortlisted': return { label: 'SHORTLISTED', quiet: false };
    case 'accepted':    return onBill
      ? { label: 'ACCEPTED · ON THE BILL', quiet: false }
      : { label: 'ACCEPTED · NOT ON BILL', quiet: false };
    case 'declined':    return { label: 'DECLINED', quiet: true };
    default:            return { label: String(bucket || '').toUpperCase(), quiet: true };
  }
}

/**
 * ⭐⭐ ONE FACT, ⛔ NOT TWO (owner, 2026-08-16).
 *
 * ⛔ THE BILL IS THE TAB. Every row in LINEUP is in `lineup_members`, so an
 * `ON BILL` chip on each of them restated the tab's own name once per card and
 * distinguished nothing. It is GONE from this surface. What varies — and
 * therefore what the card shows — is the SET TIME.
 *
 * ⚠ The chip's COLOUR still comes from `STATE_COLOURS[memberState]`, so the
 * state information the chip carried is kept; only the redundant word was
 * dropped.
 *
 * ⚠ `DECLINED` HERE IS THE ARTIST DECLINING A SLOT — ⛔ not the host declining
 * an application. Two systems, one word; the copy says "ARTIST DECLINED" out
 * loud so the two can never be read as the same event.
 */
export function lineupWorkState(memberState) {
  switch (memberState) {
    /* ⭐ THE DOMINANT OPERATIONAL STATE: 123 of 152 members are here. It is the
       only one flagged as needing action, which is what makes the tab
       scannable — the lit rows are the work.

       ⚠⚠ "NEEDS SET TIME", ⛔ NOT "NO SET TIME" (owner, 2026-08-16). Beside
       `SET TIME NOT SENT` the old wording was a near-homograph — both are
       literally true of a member with no performance, and a host had to stop
       and work out which one they were reading. NEEDS names the WORK; NOT SENT
       names a set time that already exists and is being withheld. */
    case 'ON BILL':   return { setTime: 'NEEDS SET TIME',    needsAction: true  };
    case 'DRAFT':     return { setTime: 'SET TIME NOT SENT', needsAction: false };
    case 'AWAITING':  return { setTime: 'AWAITING REPLY',    needsAction: false };
    case 'CONFIRMED': return { setTime: 'CONFIRMED',         needsAction: false };
    case 'DECLINED':  return { setTime: 'ARTIST DECLINED',   needsAction: false };
    default:          return { setTime: String(memberState || '—'), needsAction: false };
  }
}

/**
 * @param kind        'application' | 'lineup'
 * @param item        the profile-shaped row this card draws
 * @param stateLabel  the prominent state chip's words. ⛔ OPTIONAL — omit it
 *                    and `subState` is promoted into the chip instead, which is
 *                    what the LINEUP tab does.
 * @param stateColor  its colour, from the caller's own status map
 * @param quiet       settled states recede
 * @param subState    lineup only — the set-time line
 * @param needsAction lineup only — lights the set-time line
 * @param tags        their five `card_pills`, string or array. ⚠ PANEL ONLY.
 * @param viewerProfileId  who MESSAGE would be sent AS. ⛔ Without it the
 *                    button is not rendered — see the note at the render site.
 * @param actions     the state's own buttons, inside a `.yp-decision-row`
 */
export default function WorkItemCard({
  kind = 'application', item, stateLabel, stateColor, quiet = false,
  subState = null, needsAction = false, tags = null, viewerProfileId = null,
  actions = null,
}) {
  /**
   * ⭐⭐ EVERYTHING BUT NAME, SOUND AND STATE IS BEHIND THE DISCLOSURE
   * (owner, 2026-08-16).
   *
   * ⚠⚠ THE BUTTON ROW WAS THE WHOLE HEIGHT PROBLEM. A card carrying three
   * actions stood roughly twice as tall as one carrying none, which is why the
   * dashboard's lineup and the event page's lineup did not look like the same
   * card even though they ARE the same component. Scanning a queue is the
   * common case; acting on one row is the exception, so the exception folds.
   *
   * ⛔ AN INLINE EXPANDER, ⛔ NOT A FLOATING MENU. These cards sit inside
   * scrolling tab panels; an absolutely-positioned dropdown is clipped by the
   * first ancestor with `overflow` set, and escaping that means portalling to
   * body — which this app already had to do for the header overlays. A
   * disclosure that pushes the card open cannot be clipped and needs no portal.
   */
  const [open, setOpen] = useState(false);
  const [msgBusy, setMsgBusy] = useState(false);
  const navigate = useNavigate();
  if (!item) return null;

  const pt   = profileIdentity(String(item.type || '').toLowerCase());
  const img  = item.avatar_thumb || item.avatar || pt.defaultImage;
  /* Their own words first, the genre string as the fallback — the same
     resolution ProfileCard uses, kept identical so one act does not describe
     itself differently on two screens. */
  /* ⛔⛔ `genreLabels`, ⛔ NEVER a raw split of `genre_string`. Role KEYS live in
     that column beside the genres, so the raw string reads "dj_prod · Drum &
     Bass · Breaks" and a comedian's leads with "comedy". See profileTaxonomy. */
  const genres = genreLabels(item.genre_string);

  const sound = item.sound || genres.slice(0, 3).join(' · ') || '';

  /* ⛔ `genreLine` IS GONE with the GENRES row (owner, 2026-08-16). ⚠ `genres`
     itself stays — the face's `sound` line still falls back to the first three
     when an act has no words of its own. */

  /* `card_pills` is a delimited string on a profiles row and an array from
     some callers — accept both, and treat any other shape as no tags rather
     than rendering the result of splitting it. */
  const tagList = Array.isArray(tags)
    ? tags.map(t => String(t).trim()).filter(Boolean)
    : typeof tags === 'string'
      ? tags.split(/[,·]/).map(t => t.trim()).filter(Boolean)
      : [];

  const canOpenProfile = !!(item.id || item.user_id);
  const goProfile = () => {
    /* ⛔ ROUTES ON `id` FIRST, `user_id` second. An unclaimed imported profile
       has no user, and without the id its profile exists and cannot be
       opened. */
    if (item.id) navigate(`/profile/${item.id}`);
    else navigate(`/profile/${item.user_id}?type=${(item.type || '').toLowerCase()}`);
  };

  async function message() {
    if (msgBusy || !viewerProfileId || !item.id) return;
    setMsgBusy(true);
    const { conversationId } = await openDirectConversation(viewerProfileId, item.id);
    setMsgBusy(false);
    if (conversationId) navigate(`/messages/${conversationId}`);
  }

  /* The panel is worth opening only if it would hold something. ⛔ A
     disclosure that reveals an empty box is worse than no disclosure. */
  /* ⚠ `genreLine` DROPPED FROM THIS TEST TOO, deliberately. It let a card with
     nothing but genres open a panel that now has nothing in it — a chevron
     that rewards a tap with an empty box. */
  const hasPanel = !!(actions || tagList.length || canOpenProfile || viewerProfileId);

  return (
    <article
      className={`${s.card} ${kind === 'application' ? s.application : s.lineup}`}
      style={{ '--state': stateColor || 'var(--border)' }}
    >
      {/**
        * ⭐⭐ THE APP'S CARD TREATMENT — full-bleed image under a dark ramp,
        * the same `.bgImg` + `.bgOverlay` pair ProfileCard and EventCard use
        * (owner, 2026-08-16: "canonical cards" = one visual language, ⛔ not
        * one component). ⛔ Do not restyle these here; change all three.
        *
        * ⛔ RENDERED ONLY WHEN THERE IS GENUINELY AN IMAGE. `img` resolves to
        * the TYPE's default and that default is legitimately null for an
        * unknown type — and ⛔ borrowing a real type's photograph to fill the
        * gap is precisely what an earlier pass existed to stop. With none, the
        * card keeps its own `--card` ground and the overlay is skipped too:
        * a dark ramp over a flat panel is just a smudge.
        *
        * ⚠ `alt=""` — decoration. The name is right there in the heading, and
        * a screen reader announcing the picture would read the act twice.
        */}
      {img && (
        <>
          <img className={s.bgImg} src={img} alt="" />
          <div className={s.bgOverlay} />
        </>
      )}
      {/**
        * ⭐⭐ THE WHOLE HEAD IS THE TRIGGER (owner, 2026-08-16: "just clicking
        * the card is the padding for the chevron").
        *
        * ⚠ I ARGUED THE OPPOSITE ONE PASS AGO and was wrong for a different
        * card. The objection to a clickable card was ambiguity — a surface that
        * silently NAVIGATED while carrying buttons that did other things. This
        * tap does exactly one thing, disclose, which is what the chevron beside
        * it already advertises, and it is what the slot rows have always done.
        *
        * ⛔ THE CHEVRON IS NO LONGER A BUTTON. Nested inside a clickable
        * region its own handler would fire AND bubble — two toggles, net
        * nothing, on the one control this card has. It is decoration now
        * (`aria-hidden`), and the head carries the role, the keyboard handler
        * and `aria-expanded`.
        *
        * ⚠ The PANEL is deliberately outside this region: clicking near an
        * action button must not also collapse the thing you were reaching into.
        */}
      <div
        className={s.head + (hasPanel ? ' ' + s.headClickable : '')}
        {...(hasPanel ? {
          role: 'button',
          tabIndex: 0,
          'aria-expanded': open,
          'aria-label': open ? 'Hide details' : 'Show details',
          onClick: () => setOpen(v => !v),
          onKeyDown: e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); }
          },
        } : {})}
      >
        {/* ⭐ The type ring and glow, exactly as ProfileCard draws them — the
            photography language kept, demoted from surface to thumbnail. */}
        {img && (
          <img className={s.avatar} src={img} alt=""
            style={{ borderColor: pt.muted, boxShadow: `0 0 6px rgba(${pt.mutedRgb},.15)` }} />
        )}

        <div className={s.who}>
          <div className={s.nameRow}>
            <h3 className={s.name}>{item.name || 'Unnamed act'}</h3>
            {/* Kept on the face: it changes what a host can expect to happen
                when they act on this row. */}
            <UnclaimedBadge profile={item} />
          </div>
          {/**
            * ⭐ THE SOUND LINE, AND NOTHING ELSE (owner, 2026-08-16: "remove
            * the dj / prod, have just the your sound tag under the artist name
            * and thats it").
            *
            * ⛔ THE TYPE LABEL IS GONE FROM THE FACE. "DJ / PROD." was the same
            * three words on almost every row of a music event's lineup, so it
            * cost a line and separated nothing — the accent colour already
            * carries type. ⚠ The locality moved into the panel as HOME TOWN,
            * where it is reference rather than a scanning signal.
            */}
          {sound && <div className={s.genres} style={{ color: pt.accent }}>{sound}</div>}
        </div>

        {/**
          * ⭐⭐ THE STATUS COLUMN CARRIES ONE PROMINENT CHIP, ⛔ never two.
          *
          * ⚠ A caller that has a genuine headline state (an application's
          * NEW / UNDECIDED / SHORTLISTED) passes `stateLabel`, and `subState`
          * sits beneath it as the quiet second line. A caller with no headline
          * — the LINEUP tab, where "on the bill" is the tab itself — passes
          * only `subState`, and it is PROMOTED into the chip rather than being
          * rendered small under an empty space.
          *
          * ⛔ DO NOT "FIX" THIS BY PASSING stateLabel={subState}. The promotion
          * has to keep `needsAction`, which is what lights the rows holding
          * work, and a headline chip has no such concept.
          */}
        <div className={s.status}>
          {stateLabel && (
            <span className={`${s.state}${quiet ? ' ' + s.quiet : ''}`}>{stateLabel}</span>
          )}
          {subState && (stateLabel
            ? <span className={`${s.subState}${needsAction ? ' ' + s.needsAction : ''}`}>{subState}</span>
            : <span className={`${s.state}${needsAction ? ' ' + s.stateAction : ''}`}>{subState}</span>
          )}
        </div>

        {/* ⚠ ON THE RIGHT, where the slot rows already put theirs — one answer
            to "where do I press to see more" per screen, ⛔ not one per
            component. Decoration only; the head above owns the interaction. */}
        {hasPanel && (
          <span aria-hidden="true" className={s.disclosure + (open ? ' ' + s.disclosureOpen : '')}>
            {/* ⚠ POINTS RIGHT AT REST, TURNS DOWN WHEN OPEN (owner,
                2026-08-16) — so the glyph is the RIGHT chevron and the open
                state rotates it a quarter turn, ⛔ not a down chevron flipped
                180°. Right reads as "there is more through here"; down reads as
                "it is now below you". */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </span>
        )}
      </div>

      {open && hasPanel && (
        <div className={s.panel}>
          {/* ⛔ HOME TOWN REMOVED (owner, 2026-08-16). It was the last thing
              left of the old meta line and it earned no room: an organiser
              deciding who plays their night is not deciding on locality, and
              the profile behind PROFILE carries it in full. */}

          {/**
            * ⛔⛔ THE GENRES ROW IS GONE (owner, 2026-08-16: "remove genres from
            * cards. keep 5 tags"). It listed every genre in full and ran to
            * three wrapped lines on a real act, which pushed the ACTIONS —
            * the reason the panel opens — below the fold.
            *
            * ⚠ The act's own five tags stay and are now the only taxonomy here:
            * curated by them, ⛔ not a machine's list of everything they have
            * ever been filed under. The `sound` line on the card face is
            * untouched.
            *
            * ⛔ Do not "restore the full genres for completeness" — the profile
            * behind PROFILE carries them, and this panel is for deciding who
            * plays, not for browsing.
            */}

          {tagList.length > 0 && (
            /* Their own curated five, ⛔ not a genre guess. `.spot-tag` is the
               app's existing pill; this panel does not invent another. */
            <div className="spot-tags" style={{ marginTop: 2 }}>
              {tagList.slice(0, 5).map(t => <span key={t} className="spot-tag">{t}</span>)}
            </div>
          )}

          {/* ── WHO THEY ARE TO YOU — follow, message, profile ──────────────
              ⚠ Separated from the decision row below by their own divider:
              these change YOUR relationship to a person, the ones below change
              THEIR position in your event. Reading them as one row of six
              would put "follow" beside "remove from bill". */}
          {(canOpenProfile || viewerProfileId) && (
            <div className={s.relRow}>
              {canOpenProfile && <FollowHeartBtn profile={item} />}
              {/* ⛔ MESSAGE NEEDS AN EXPLICIT SENDER. `openDirectConversation`
                  takes a FROM profile, and this account may hold several —
                  `profiles.user_id` is shared across a multi-profile account,
                  so guessing the sender here could speak as the wrong identity.
                  The surface passes who it is acting as, or the button is not
                  offered. */}
              {viewerProfileId && item.id && (
                <button type="button" className={s.relBtn} onClick={message} disabled={msgBusy}>
                  {msgBusy ? 'OPENING…' : 'MESSAGE'}
                </button>
              )}
              {canOpenProfile && (
                <button type="button" className={s.relBtn} onClick={goProfile}>PROFILE</button>
              )}
            </div>
          )}

          {actions && <div className={s.actions}>{actions}</div>}
        </div>
      )}

    </article>
  );
}
