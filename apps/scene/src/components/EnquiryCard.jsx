import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { normaliseStatus, STATUS_TAB_COLOR } from '../lib/enquiryUtils';
import { completionFor, COMPLETION_COLUMNS, requirementLabel } from '@yespleez/requirements';

/**
 * Every `profiles` column this card reads — declared HERE, by the component
 * that reads them, because two callers batch-fetch applicant profiles and
 * hand them in (VenueDashboard, HostDashboard) and both were keeping their
 * own list.
 *
 * Both lists were wrong in the same silent way. A column the card reads but
 * the query never selected arrives as `undefined`: the FEE and EMAIL rows are
 * dropped by `.filter(([, v]) => v)` and simply never appear, and the
 * readiness percentage counts the absence as a real gap. Nothing throws and
 * every number looks plausible.
 *
 * The completion half is appended from the engine rather than typed out, so
 * adding a key to COMPLETION_KEYS cannot leave a fetcher behind. See
 * COMPLETION_COLUMNS, and the projection test that keeps it honest.
 */
export const ENQUIRY_CARD_COLUMNS = [...new Set([
  'id', 'user_id', 'type', 'avatar', 'avatar_thumb', 'name', 'bio', 'sound',
  'genre_string', 'location', 'mix_link', 'tagline', 'card_pills',
  'years', 'fee', 'fee_type', 'contact_email',
  ...COMPLETION_COLUMNS,
])];
import { formatLocation } from '../lib/formatLocation';
import ds from '../screens/DiscoverScreen.module.css';
import DateBox from './DateBox';
import { DecisionBtn, DetailBtn, StarIcon, CheckIcon, XIcon } from './DecisionButtons';
import EnquiryDossierSheet from './EnquiryDossierSheet';
import { PROFILE_TYPES } from '../lib/profileTypes';


export function HoverPill({ label, accentRgb, accent }) {
  const [hov, setHov] = useState(false);
  return (
    <span
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? `rgba(${accentRgb},.25)` : `rgba(${accentRgb},.1)`,
        border: `1px solid ${hov ? accent : `rgba(${accentRgb},.3)`}`,
        borderRadius: 20, fontSize: 10, padding: '2px 8px',
        color: accent, cursor: 'default', transition: 'all .15s',
      }}
    >{label}</span>
  );
}

export function HoverProfileBtn({ expanded, onClick, compact }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderRadius: 8, cursor: 'pointer', transition: 'all .15s',
        fontFamily: "'Bebas Neue'", letterSpacing: 1.5,
        background: hov ? 'rgba(255,51,153,.22)' : 'rgba(255,51,153,.1)',
        border: `1px solid ${hov ? '#FF69B4' : 'rgba(255,51,153,.35)'}`,
        color: '#fff',
        ...(compact
          ? { fontSize: 10, padding: '3px 8px' }
          : { fontSize: 10, padding: '4px 10px' }),
      }}
    >{expanded ? 'HIDE ▲' : 'MORE INFO ▼'}</button>
  );
}

export function HoverBtn({ onClick, disabled, base, hover, children }) {
  const [hov, setHov] = useState(false);
  const st = hov && !disabled ? hover : base;
  return (
    <button
      onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: 1, fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5,
        padding: '8px 0', borderRadius: 8, cursor: disabled ? 'default' : 'pointer',
        transition: 'all .15s',
        background: st.bg, border: st.border, color: st.color || base.color,
        opacity: disabled ? .5 : 1,
      }}
    >{children}</button>
  );
}

/**
 * ── ⚠ THE CHIP TAKES ITS COLOUR FROM THE TAB, NOT FROM A COPY ────────
 *
 * This file kept its own status→colour map, and it had drifted from
 * `STATUS_TAB_COLOR` in exactly the way a duplicate always does: it had no
 * `seen` key at all. Every seen enquiry therefore fell through to the `new`
 * yellow while the tab above it underlined in orange, so the chip and the tab
 * disagreed about what the card was — on the one screen that shows both.
 *
 * Deleted rather than corrected. Adding `seen: '#FF8C42'` would have fixed
 * today's symptom and left the second map in place to drift again on the next
 * status anyone adds. `STATUS_TAB_COLOR` is keyed by tab name (uppercase);
 * `displayStatus` is the lowercase status, and they name the same thing.
 */
const statusChipColor = (displayStatus) =>
  // ⛔ `declined` KEEPS `--muted` and does NOT take the tab's #888. The owner
  // signed off the declined chip as it stands; the tab grey is a different
  // grey, and switching it would be an unrequested change to the one chip that
  // was already right.
  displayStatus === 'declined'
    ? 'var(--muted)'
    : (STATUS_TAB_COLOR[displayStatus.toUpperCase()] || '#FFD700');

/**
 * Chip wording where the status name is longer than the chip deserves.
 *
 * ⚠ THE CHIP ONLY. The status itself stays `shortlisted` everywhere — in the
 * data, in the tab, in the colour lookup and in every comparison. This is one
 * label in one corner, not a rename: "SHORTLISTED" is nearly as wide as the
 * date chip beside it and unbalances the pair, while "SHORT" is unambiguous in
 * a row that already reads new / seen / short / accepted.
 */
const STATUS_CHIP_LABEL = { shortlisted: 'SHORT' };

/* The decision controls and their icons now live in DecisionButtons.jsx — the
   dossier sheet renders the same three actions and was drawing its own. */

// "What happens next" — same status set as the chip colours, worded per
// direction (incoming = you received this; outgoing = you sent this).
const NEXT_STEPS = {
  incoming: {
    new:         'Awaiting your review — shortlist or respond when ready.',
    shortlisted: "You've shortlisted this — accept or decline when ready.",
    accepted:    "You've accepted this — it's confirmed.",
    booked:      "You've accepted this — it's confirmed.",
    declined:    'You declined this.',
  },
  /**
   * ⚠ OUTGOING COPY MUST NOT INSTRUCT AN ACTION THE SENDER NO LONGER HAS.
   *
   * These read "confirm to lock it in" and "confirm to finalise the booking"
   * while the only outgoing control is now CANCEL ENQUIRY — guidance pointing
   * at a button that had just been removed, which is worse than no guidance.
   * They now state where the enquiry stands and leave the next move to the
   * party who actually has it.
   */
  outgoing: {
    awaiting:    'Waiting for a response.',
    interested:  "They're interested — waiting on them to confirm.",
    accepted:    'Accepted — waiting on them to finalise the booking.',
    booked:      'Booked and confirmed.',
    declined:    'This was declined.',
  },
};

export default function EnquiryCard({ enq, viewerProfile, onRespond, onPlayDemo }) {
  const [busy, setBusy]       = useState(false);
  const [profile, setProfile] = useState(enq.profile || null);
  const [expanded, setExpanded] = useState(false);
  // The dossier — the full, readable view. See EnquiryDossierSheet for why
  // the depth lives there rather than growing this card.
  const [sheetOpen, setSheetOpen] = useState(false);
  const expandRef = useRef(null);


  useEffect(() => {
    // M5.1 (D7): resolve by the enquiry row's applicant_profile_id; legacy
    // user_id+type lookup only when no profile id is present.
    if (enq.profile || (!enq.applicant_profile_id && !enq.applicant_user_id)) return;
    const q = enq.applicant_profile_id
      ? supabase.from('profiles').select('*').eq('id', enq.applicant_profile_id).maybeSingle()
      : supabase.from('profiles').select('*').eq('user_id', enq.applicant_user_id).eq('type', enq.applicant_type || 'artist').maybeSingle();
    q.then(({ data }) => data && setProfile(data));
  }, [enq.applicant_profile_id, enq.applicant_user_id, enq.profile]);

  const displayStatus = normaliseStatus(enq);
  const enqDir        = (enq.direction || 'incoming').toLowerCase();
  /**
   * ⚠ THE IDENTITY OF THE PROFILE BEING DRAWN, not of the applicant.
   *
   * These are the same thing for a venue — who is never the applicant — and
   * different for a promoter reading an enquiry they SENT, where the card draws
   * the VENUE. Keyed on `applicant_type` it rendered a venue's row in the
   * host's magenta. `EnquiryDossierSheet` already resolved it this way; this
   * was the copy that had not caught up.
   */
  const accentPt      = PROFILE_TYPES[profile?.type || enq.applicant_type];
  const accent        = accentPt?.accent || '#00E5FF';
  const accentRgb     = accentPt?.rgb    || '0,229,255';
  const statusColor   = statusChipColor(displayStatus);
  // ⚠ WHITE INK ON A COLOURED EDGE. The colour was previously carried by the
  // border AND the label, which made a yellow chip read as yellow TEXT — thin
  // Bebas at 10px in #FFD700 is the least legible thing on the card. The edge
  // now carries the status and the label just says what it is.
  // `declined` keeps muted ink: it is the one status that should recede.
  const statusInk     = displayStatus === 'declined' ? 'var(--muted)' : '#fff';
  const nextStepsCopy = NEXT_STEPS[enqDir]?.[displayStatus] || '';

  async function respond(status) {
    if (busy) return;
    setBusy(true);
    await onRespond?.(enq.id, status);
    setBusy(false);
  }

  const p            = profile || {};
  const name         = p.name || enq.name || '—';
  const loc          = formatLocation(p);
  const avatar       = p.avatar || null;
  const allTags      = (p.card_pills || '').split(/[,·]/).map(s => s.trim()).filter(Boolean);
  const sound        = p.sound || p.genre_string?.split(/[·,]/).slice(0, 3).join(' · ') || '';

  /**
   * BOOKING READINESS — computed from the LIVE profile row, never snapshotted
   * onto the enquiry.
   *
   * This card is re-read days after the enquiry was sent and re-rendered on
   * every status change, and it already re-resolves the applicant profile on
   * each load. A number frozen at send time would sit inside a read-through
   * component and drift from the profile it claims to describe. So readiness
   * always means "as at now", and copies nothing into venue_enquiries — the
   * enquiry stays nine columns and a pointer.
   *
   * `completionFor` returns null for a type with no completion list, and we
   * pass null while the profile is still resolving. Both hide the badge
   * rather than rendering 0% — an unknown readiness is not a bad one (R1),
   * and a hidden row beats a misleading one (R3).
   */
  /**
   * ⛔ READINESS DESCRIBES THE PARTY BEING BOOKED — and on a promoter's own
   * outgoing enquiry the profile drawn is the VENUE, who is not being booked.
   * It rendered "23% READY" against Elbows Rest: not the venue's real
   * completeness (its own dashboard says 77%) but an artifact of the slim
   * column list an outgoing row is fetched with. A confident wrong number is
   * worse than no number (R3), and it was answering a question nobody asked.
   *
   * ⚠ Keyed on the SUBJECT — the type of profile being drawn — not on which
   * screen is rendering. A venue inviting an act still sees that act's
   * readiness, because there the subject really is the one being booked.
   */
  const readiness = profile && p.type !== 'venue' ? completionFor(p, p.type) : null;
  // The per-field "not supplied" list is deliberately NOT built here any more.
  // It told a venue which profile fields an applicant had left blank —
  // including their emergency contact, which is between the artist and the
  // platform. A host's business is what they asked for (Requirements) plus one
  // overall number. The full gap list belongs on the artist's own dashboard as
  // a to-do, not here as a character reference.

  /**
   * REQUIREMENTS — the verdict recorded at submission (P5), read as stored.
   *
   * NOT recomputed. Readiness above is live because "how complete is this act"
   * is a question about now; "did they meet what I asked" is a question about
   * a moment, and re-deriving it would silently rewrite what was submitted the
   * next time the applicant edits their profile.
   *
   * NULL is the ordinary case — a venue date enquiry has no event and so no
   * requirements, and an event that declared none produces no snapshot. Both
   * render nothing at all rather than "0/0" (R3).
   *
   * ⚠ NO "8/8 then · 7/8 now" COMPARISON YET, DELIBERATELY. A live re-evaluation
   * needs the applicant's ASSETS, and neither dashboard fetches them — every
   * asset key would resolve `absent` and the card would report a press kit as
   * deleted when it is merely unfetched. A wrong second number is worse than
   * one honest number (R4: broken ≠ sparse). It lands when the dashboards
   * batch-load assets.
   */
  const snap = enq.requirements_snapshot || null;
  const reqTotal = snap?.total ?? 0;
  const reqMet   = snap?.satisfied ?? 0;
  const reqComplete = reqTotal > 0 && reqMet === reqTotal;
  const reqColor = reqComplete ? '#00E5A0' : '#FFD700';

  const declineBtn = (
    <DecisionBtn tone="decline" icon={XIcon} label="DECLINE"
      onClick={() => respond('declined')} disabled={busy} />
  );

  /**
   * The sender's one decision, computed OUTSIDE `ActionButtons` so the JSX
   * below can put it in the same row as VIEW ENQUIRY. `null` on a settled
   * status (accepted/declined/booked) — nothing to cancel once it is over.
   * See the note on the outgoing branch of `ActionButtons` for why this
   * writes `declined` and why the recipient's controls do not apply here.
   */
  const cancelBtn = (enqDir === 'outgoing' && (displayStatus === 'awaiting' || displayStatus === 'interested'))
    ? <DecisionBtn tone="decline" icon={XIcon} label="CANCEL ENQUIRY"
        onClick={() => respond('declined')} disabled={busy} />
    : null;

  function ActionButtons() {
    if (enqDir === 'incoming') {
      /**
       * ⚠ `seen` BELONGS HERE, AND ITS ABSENCE WAS THE WHOLE PROBLEM.
       *
       * Opening a `new` enquiry auto-marks it `seen` — so the act of reading one
       * moved it into a status with NO branch in this function, and the buttons
       * disappeared at exactly the moment the host had finished reading and was
       * ready to decide. Every enquiry in the SEEN tab was a dead end: the only
       * way to act was the dossier sheet.
       *
       * `seen` offers the same three choices as `new` because it IS the same
       * decision, one read later. Nothing about having looked at an enquiry
       * narrows what you may do with it.
       */
      if (displayStatus === 'new' || displayStatus === 'seen') return (
        <div className="yp-decision-row">
          <DecisionBtn tone="shortlist" icon={StarIcon} label="SHORTLIST"
            onClick={() => respond('shortlisted')} disabled={busy} />
          <DecisionBtn tone="accept" icon={CheckIcon} label="ACCEPT"
            onClick={() => respond('accepted')} disabled={busy} />
          {declineBtn}
        </div>
      );
      if (displayStatus === 'shortlisted') return (
        <div className="yp-decision-row">
          <DecisionBtn tone="accept" icon={CheckIcon} label="ACCEPT"
            onClick={() => respond('accepted')} disabled={busy} />
          {declineBtn}
        </div>
      );
    }
    // ⚠ OUTGOING IS NOT A DECISION, IT IS A WAIT. The sender's one control
    // (`cancelBtn`, above) renders inline beside VIEW ENQUIRY rather than in
    // its own row here — see the JSX below and the note on `cancelBtn` for
    // why it writes `declined` and why the recipient's controls do not apply.
    return null;
  }

  const dateRaw = enq.date_requested || enq.preferred_date || null;

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        position: 'relative', overflow: 'hidden', minHeight: 100,
        border: `1px solid rgba(${accentRgb},.35)`, cursor: 'default', marginBottom: 0,
        borderRadius: (expanded || nextStepsCopy) ? '14px 14px 0 0' : 14,
        borderBottom: nextStepsCopy ? 'none' : `1px solid rgba(${accentRgb},.35)`,
      }}>
        {/* Background image — same technique as EventCard: absolutely-positioned
            cover image + gradient overlay, content sits on top. */}
        {/* ⚠ NOT ProfileAvatar, and deliberately so: this is a full-bleed
            BACKGROUND, not a face. A tinted initial stretched across the card
            would be nonsense, so when there is no artwork the image is simply
            omitted and the gradient overlay below becomes the whole treatment —
            which is what it already is wherever the photo is dark.
            It used to end `|| PROFILE_TYPES.artist.defaultImage`, so a type
            without artwork wore a DJ's photo across the card. */}
        {(avatar || accentPt?.defaultImage) && (
          <img src={avatar || accentPt.defaultImage} alt=""
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(10,10,20,.92) 0%, rgba(10,10,20,.55) 50%, rgba(10,10,20,.82) 100%)' }} />

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={ds.cardNameRow}>
              <span className={ds.cardName}>{name}</span>
              <span className={ds.cardBadge} style={{ color: accent, background: `rgba(${accentRgb},.15)`, borderColor: `rgba(${accentRgb},.3)` }}>
                {PROFILE_TYPES[(p.role || enq.applicant_type || 'artist').toLowerCase()]?.shortLabel || (p.role || enq.applicant_type || 'artist').toUpperCase()}
              </span>
            </div>
            {enq.event_name && (
              <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, marginTop: 2 }}>
                {enq.event_name}
              </div>
            )}
            {loc   && <div className={ds.cardLoc}>{loc}</div>}
            {sound && <div className={ds.cardSound} style={{ color: accent }}>{sound}</div>}
            {/* Their curated "Your 5 Tags" (card_pills), moved up from the
                expansion — this is their own final self-description, the same
                signal a host reads on every other card in the app, and it
                belongs beside sound rather than a tap away.
                .spot-tag: the Spotlight rail's own pill (FeaturedEventCard's
                .tag) over this card's own hero photo, gradient border in
                place of the rail's solid cyan one — see index.css. */}
            {allTags.length > 0 && (
              <div className="spot-tags" style={{ marginTop: 6 }}>
                {allTags.slice(0, 5).map(g => (
                  <span key={g} className="spot-tag">{g}</span>
                ))}
              </div>
            )}
          </div>
          {/* ── THE CORNER (owner, 2026-08-13) ────────────────────────────
              Status to the left; the date and the expand toggle stacked on the
              right, date on top.

              ⛔⛔ THE DATE CHIP SIZE IS LOCKED AT `md` — OWNER SIGNED OFF.
              It arrived there through several passes: `sm` in a crowded column
              read as tiny, and a full-height `fill` version read as a stretched
              rail rather than a chip. `md` at its NATURAL height is the answer.
              Do not change the size, and do not reintroduce `fill`. Putting the
              toggle back underneath is a layout change ONLY — the chip keeps
              its own dimensions, which is what `flexShrink: 0` below protects.

              ⛔ DateBox itself stays untouched by this card. It is shared with
              five other cards and none of them asked for any of this. */}
          {/* ⚠ `alignSelf: stretch` TAKES THE HEADER'S HEIGHT so `space-between`
              has somewhere to push to: status and date at the top, the toggle
              at the bottom — level with the genre pills, which are the last
              thing in the column to the left. The parent row is `center`, so
              without this the corner would size to its own content and the
              toggle would float mid-card.
              ⛔ Stretching the CONTAINER is not stretching the CHIP. The date
              keeps its own dimensions; see the lock above. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignSelf: 'stretch', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
            {/* ⚠ ONE RIGHT EDGE. Everything in this column is `flex-end`, so the
                date chip and the toggle below it share a right edge rather than
                being centred against each other at different widths. */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexShrink: 0 }}>
              {/* Status, and readiness DIRECTLY BENEATH IT — one stack, kept to
                  the left of the date so neither crowds the chip.

                  ⚠ READINESS IS BACK OUTSIDE THE EXPANSION (owner, 2026-08-13).
                  It spent one pass in the dropdown, which put it behind the
                  toggle that auto-marks an enquiry `seen` — so ranking a list
                  meant consuming every enquiry in it. Requirements can live
                  inside because they are a detail you read once you care;
                  readiness is a SCANNING signal and has to be legible closed.

                  One neutral treatment, no red/amber/green ladder: this is an
                  incentive for the act to finish their profile, not a grade
                  handed to a venue. */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
                <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: statusInk, border: `1px solid ${statusColor}`, borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                  {STATUS_CHIP_LABEL[displayStatus] || displayStatus.toUpperCase()}
                </span>
                {readiness && (
                  <span title="How complete this profile is right now"
                    style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.2, color: 'var(--muted)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                    <span style={{ color: accent }}>{Math.round(readiness.pct)}%</span> READY
                  </span>
                )}
              </div>
              {dateRaw && <DateBox date={dateRaw} size="md" />}
            </div>
            {/* ── READINESS AND REQS MOVED INTO THE EXPANSION (owner, 2026-08-13)
                Both numbers used to sit here, and the REQS one was near
                tautological: requirements gate submission (`canSubmit`), so an
                enquiry that arrived at all had almost always met them, and the
                chip restated the panel directly beneath it. Two chips saying
                "this is fine" is a corner that reads as busy without ever
                changing a decision.

                ⚠ WHAT THIS COSTS, RECORDED SO IT IS A CHOICE AND NOT A
                REGRESSION: expanding auto-writes 'seen' (see the toggle below),
                so both numbers are now behind an action that consumes the
                enquiry. Ranking sixteen incoming without marking them all seen
                is no longer possible from the list alone. Decoupling that is a
                separate decision about what `seen` means. */}
            <HoverProfileBtn expanded={expanded} onClick={() => {
              const next = !expanded;
              setExpanded(next);
              // Mark as seen the moment the enquiree actually opens a brand-new
              // incoming enquiry — reuses the same onRespond callback every
              // dashboard already wires up for accept/decline/shortlist, so
              // this works everywhere EnquiryCard is used with no new prop.
              if (next && enqDir === 'incoming' && displayStatus === 'new') respond('seen');
            }} />
          </div>
        </div>
      </div>

      {nextStepsCopy && (
        <div style={{
          fontSize: 11, color: 'var(--muted)', padding: '6px 14px',
          background: 'rgba(255,255,255,.02)',
          border: `1px solid rgba(${accentRgb},.35)`, borderTop: 'none',
          borderRadius: expanded ? 0 : '0 0 14px 14px',
        }}>
          {nextStepsCopy}
        </div>
      )}

      {expanded && profile && (
        <div ref={expandRef} style={{ background: 'var(--card)', border: `1px solid rgba(${accentRgb},.35)`, borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '12px 18px' }}>
          {/* The 5 tags now sit on the collapsed card, under sound — this
              expansion no longer repeats them. */}
          {/* THEIR MESSAGE, in preview. The full text and a REPLY button live
              in the dossier sheet; here it is one line so a host scanning the
              list can see whether they wrote anything worth opening. */}
          {enq.note && (
            <div
              onClick={() => setSheetOpen(true)}
              style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)', cursor: 'pointer' }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 70, paddingTop: 2 }}>MESSAGE</div>
              <div style={{ fontSize: 13, color: 'var(--text)', flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {enq.note}
              </div>
            </div>
          )}
          {/* ── THE TWO NUMBERS, ON ONE LINE (owner, 2026-08-13) ──────────
              Both kept as CHIPS and sat beside the REQUIREMENTS label rather
              than each claiming a labelled row of its own. Stacked, they pushed
              the message preview below the fold and the expansion opened with
              two headings and no content.

              ⚠ THEY ANSWER DIFFERENT QUESTIONS AND ARE ALLOWED TO DISAGREE.
              REQS is the verdict FROZEN at submission; READY is live and about
              now. An act can be 2/2 on what was asked in August and 60% ready
              today, and neither number is wrong. That is why REQS carries the
              colour and READY stays neutral, and why the date line below says
              "as submitted" out loud.

              ⚠ The row survives `reqTotal === 0` — a venue date enquiry has no
              event and so no requirements, but the act still has a readiness.
              The label and the item list go, the chip stays. */}
          {/* ⛔ NO READINESS-ONLY ROW. This block renders ONLY where the host
              actually asked for something. With readiness moved back to the
              corner, an enquiry with no requirements was left with a lone chip
              sitting on its own divider above VIEW FULL DETAILS — a labelled
              row containing one number that is already visible on the closed
              card. Gone entirely rather than left empty (owner, 2026-08-13). */}
          {reqTotal > 0 && (
            <div style={{ padding: '4px 0 9px', borderBottom: '1px solid rgba(255,255,255,.05)', marginBottom: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'var(--muted)' }}>REQUIREMENTS</span>
                <span title={`Met at submission, ${new Date(snap.evaluated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                  style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.2, color: reqColor, border: `1px solid ${reqColor}`, borderRadius: 4, padding: '2px 7px' }}>
                  {reqComplete ? '✓ ' : ''}{reqMet}/{reqTotal} REQS
                </span>
              </div>
              {/* ⚠ GUARDED ON `reqTotal`, NOT ON THE ROW. This block now also
                  renders for a readiness-only enquiry, where `snap` is null —
                  reading `snap.items` there would throw and take the whole card
                  down, on exactly the ordinary case (a venue date enquiry has
                  no event and so no requirements). */}
              {reqTotal > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                  {(snap.items || []).map(it => {
                    // 'withheld' is an answer, not a gap — 'N/A' means asked and
                    // declined (R1). It reads as met, exactly as the engine
                    // scored it at submission.
                    const met = it.state === 'satisfied' || it.state === 'withheld';
                    return (
                      <span key={it.key} style={{ fontSize: 11, color: met ? '#00E5A0' : 'var(--muted)' }}>
                        {met ? '✓' : '○'}&nbsp;{requirementLabel(it.key)}
                      </span>
                    );
                  })}
                </div>
              )}
              {reqTotal > 0 && (
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 7, opacity: .75 }}>
                  {/* Says "as submitted" out loud. Without it a host reads these
                      ticks as current, and they are not — that is the whole
                      reason the verdict is stored rather than recomputed. */}
                  As submitted {new Date(snap.evaluated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              )}
            </div>
          )}
          {/* Everything else — bio, fee, demo, contact, readiness, replying —
              moved to the dossier sheet. Cramming it in here produced 11px
              type over a photo, which a host summed up as "tells me nothing
              helpful and I can't read any of it". This expansion is the
              triage set only; the sheet is where a decision gets made. */}
          {/* ⚠ OUTGOING PAIRS VIEW ENQUIRY WITH CANCEL ON ONE LINE.
              Incoming keeps VIEW FULL DETAILS full-width above its own
              decision row, untouched — this only changes the outgoing case,
              where there is exactly one decision button and the two together
              read as one action bar rather than a full-width link with a
              second row underneath it. */}
          {enqDir === 'outgoing' ? (
            cancelBtn ? (
              // A live enquiry: the two side by side, equal width, one bar.
              <div className="yp-decision-row">
                {/* "VIEW ENQUIRY" WHEN IT IS MINE — the sheet shows the
                    enquiry I sent, not a dossier on an applicant. */}
                <DetailBtn accent={accent} label="VIEW ENQUIRY" onClick={() => setSheetOpen(true)} />
                {cancelBtn}
              </div>
            ) : (
              // Settled (accepted/booked/declined): nothing to cancel, so
              // VIEW ENQUIRY stands alone full-width rather than sharing a
              // grid track with an empty second column.
              <div style={{ padding: '10px 0 0' }}>
                <DetailBtn accent={accent} label="VIEW ENQUIRY" onClick={() => setSheetOpen(true)} />
              </div>
            )
          ) : (<>
            <div style={{ padding: '10px 0 0' }}>
              <DetailBtn accent={accent} onClick={() => setSheetOpen(true)} />
            </div>
            <ActionButtons />
          </>)}
        </div>
      )}

      {/* The bio "see more" modal is gone with the row that opened it — the
          sheet shows the bio in full, so a second overlay for one field was
          a surface with nothing left to do. */}
      {sheetOpen && (
        <EnquiryDossierSheet
          enq={{ ...enq, profile }}
          viewerProfile={viewerProfile}
          onClose={() => setSheetOpen(false)}
          onRespond={onRespond}
          onPlayDemo={onPlayDemo}
        />
      )}
    </div>
  );
}
