import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDisplayDate } from '../lib/dates';
import { socialProfileUrl, ensureHttps } from '../lib/socialLinks';
import { openDirectConversation } from '../lib/messaging';
import { requestedFeeAmount, formatFee } from '../lib/bookingAgreement';
import { useConversationUi } from '../lib/conversationUi';
import { completionFor, requirementLabel } from '@yespleez/requirements';
import { DecisionBtn, StarIcon, CheckIcon, XIcon } from './DecisionButtons';
import { askCategoryLabel } from '@yespleez/ask-categories';
import { PROFILE_TYPES } from '../lib/profileTypes';
import { normaliseStatus } from '../lib/enquiryUtils';
import ProfileCard from './ProfileCard';

/**
 * THE BOOKING DOSSIER — everything needed to decide, in one readable place.
 *
 * ── WHY A SHEET AND NOT A BIGGER CARD ──
 *
 * The collapsed enquiry card is good at triage: scan six, rank them, act. It
 * is hopeless for deciding — 10px type over a photo in a 200px strip. Rather
 * than grow the card until it does both badly, the card stays a card and this
 * carries the depth. Same split the app already uses for InviteSheet and
 * MessageAsSheet, and it keeps your place in the list.
 *
 * ── WHAT MOVED, AND WHAT WAS SIMPLY MISSING ──
 *
 * `enq.note` — the applicant's own message — was rendered NOWHERE. The one
 * free-text field the entire enquiry flow is built around, the actual thing
 * the person wrote to you, never reached the venue. It is now the first and
 * largest thing on this sheet, because it is the only part written by a human
 * for this specific reader.
 *
 * ── WHY THE "NOT SUPPLIED" LIST IS GONE FROM THE HOST'S VIEW ──
 *
 * The card used to list every unfilled profile field, which meant telling a
 * venue that an applicant had not entered their EMERGENCY CONTACT. That is
 * between the artist and the platform. A host's business is what they asked
 * for — the Requirements block — plus one overall readiness number as a
 * general signal. The full gap list belongs on the artist's own dashboard as
 * a to-do, not here as a character reference.
 */
export default function EnquiryDossierSheet({ enq, viewerProfile, onClose, onRespond, onPlayDemo }) {
  const navigate = useNavigate();
  /* ⛔⛔ `open`, RENAMED — the context has no `openConversation` key.
     Destructuring it plain yielded `undefined`, so REPLY and MESSAGE closed
     the sheet (that line runs first) and then threw
     "openConversation is not a function" into an async void: no dock, no
     chat, no error on screen. Every other call site already renames `open`;
     this was the one that did not. */
  const { open: openConversation } = useConversationUi();
  const [busy,    setBusy]    = useState(false);
  const [msgBusy, setMsgBusy] = useState(false);

  // ⚠ Derived, never stored — the same row is incoming to one side and
  // outgoing to the other, so there is no correct column for it.
  const enqDir   = (enq.direction || 'incoming').toLowerCase();
  /* ⚠ CANCEL IS TWO STEPS — the middle one. See the decision row below. */
  const [confirming, setConfirming] = useState(false);
  /* ⭐ ONE RULE, SHARED WITH THE CARD — derived through `normaliseStatus` so
     the raw spellings (`booked`, `confirmed`, `pending`) resolve exactly as
     they do there rather than being re-listed here and drifting. */
  const cancellable = ['awaiting', 'interested', 'accepted'].includes(normaliseStatus(enq));
  const p        = enq.profile || {};
  const pt       = PROFILE_TYPES[p.type || enq.applicant_type];
  const accent   = pt?.accent || '#00E5FF';
  const rgb      = pt?.rgb    || '0,229,255';
  const name     = p.name || enq.name || '—';
  const snap     = enq.requirements_snapshot || null;
  /**
   * ⛔ READINESS DESCRIBES THE PARTY BEING BOOKED, and a venue never is.
   *
   * This sheet scored whoever it happened to be drawing. On a promoter's own
   * outgoing enquiry that is the VENUE, so it rendered "BOOKING READY 23%"
   * against Elbows Rest — not the venue's real completeness (its own dashboard
   * says 77%) but an artifact of the slim column list an outgoing row is
   * fetched with. A confident wrong number is worse than no number.
   *
   * ⚠ THE CARD ALREADY HAD THIS GUARD; this surface never got it, so the same
   * wrong figure survived one tap away from where it had been removed. Keyed
   * on the SUBJECT being drawn, not on the direction — a venue inviting an act
   * still sees that act's readiness, because there the subject really is the
   * one being booked.
   */
  const readiness = (p.type && p.type !== 'venue') ? completionFor(p, p.type) : null;
  const demoUrl  = ensureHttps(p.mix_link) || socialProfileUrl('soundcloud', p.soundcloud) || socialProfileUrl('mixcloud', p.mixcloud);
  const dateRaw  = enq.date_requested || enq.preferred_date || null;
  // ⛔ Read from the registry, never written here — the third copy of a
  // category vocabulary is the mistake the registry exists to prevent.
  const askLabel = askCategoryLabel(enq.ask_category);

  /**
   * ⛔⛔ "$450 — PAID" WAS A LIE, AND THE WORST KIND: a true-looking one.
   *
   * Both halves came from the PROFILE, not from this enquiry. `p.fee` is the
   * act's rate card and `p.fee_type: 'paid'` means "I want paid work" — ⛔ NOT
   * "this booking has been paid". Joined with a dash under a heading reading
   * FEE, on a row about one specific night, it read as a settled payment on a
   * booking where no money had been discussed, let alone moved.
   *
   * ⭐ THREE FEES, THREE FACTS (lib/bookingAgreement):
   *     the act's RATE      what they charge in general — this, below
   *     the REQUESTED fee   what this enquiry asked for — enq.proposed_fee
   *     the AGREED fee      what the parties settled — the agreement
   * ⛔ And PAID is a fourth, which nothing here can know.
   */
  const rate = [
    p.fee ? `$${p.fee}` : null,
    /* ⚠ Said as a PREFERENCE, because that is what the field is. */
    p.fee_type === 'paid' ? 'paid work only' : p.fee_type === 'exposure' ? 'open to exposure / door deals' : null,
  ].filter(Boolean).join(' — ');

  /* ⭐ What THIS enquiry asked for. ⛔ Never labelled agreed: nobody has
     agreed it, and the requested amount stays requested however long it sits. */
  const requestedFee = formatFee(requestedFeeAmount(enq)) || (enq.proposed_fee || '').trim() || null;

  /**
   * Open the conversation between these two profiles and hand over to
   * messaging. Both REPLY (beside their message) and MESSAGE (in the action
   * bar) land here — one path, so the two buttons can never drift into
   * meaning different things.
   *
   * Profile-to-profile, never account-to-account: `viewerProfile` is the
   * venue or host reading this, `p.id` the act that wrote. That is the
   * messaging architecture's rule, and it is also what makes a reply arrive
   * from the venue rather than from whoever happens to own it.
   */
  async function reply() {
    if (!viewerProfile?.id || !p.id || msgBusy) return;
    setMsgBusy(true);
    try {
      const { conversationId, error } = await openDirectConversation(viewerProfile.id, p.id);
      if (error || !conversationId) return;
      onClose?.();
      /* ⭐ `asProfileId` — this sheet KNOWS which identity is reading, and the
         drawer cannot work it out when both profiles belong to one account. */
      openConversation(conversationId, {
        profile: { id: p.id, name, type: p.type },
        asProfileId: viewerProfile.id,
      });
    } finally {
      setMsgBusy(false);
    }
  }

  async function respond(status) {
    if (busy) return;
    setBusy(true);
    await onRespond?.(enq.id, status);
    setBusy(false);
    onClose?.();
  }

  const Row = ({ label, children }) => (
    <div style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
      <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, color: 'var(--muted)', minWidth: 96, paddingTop: 2 }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--text)', flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );

  const Action = ({ onClick, disabled, bg, border, color, flex = 1, children }) => (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{
        flex, padding: '13px 8px', borderRadius: 10, cursor: disabled ? 'default' : 'pointer',
        fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5,
        background: bg, border, color, opacity: disabled ? .5 : 1, transition: 'opacity .15s',
      }}>{children}</button>
  );

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#13131f', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 560, margin: '0 auto', maxHeight: '92dvh', display: 'flex', flexDirection: 'column' }}>

        <div style={{ padding: '14px 20px 0', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.2)', borderRadius: 2, margin: '0 auto 16px' }} />
        </div>

        {/* Scrolls; the actions below never do. */}
        <div style={{ overflowY: 'auto', padding: '0 20px', flex: 1 }}>
          {/**
            * ⭐ THE CANONICAL CARD — the same one every other enquiry surface
            * draws (owner, 2026-08-11). This header used to be a bespoke
            * avatar + name + location + genre block: the fourth hand-built
            * rendering of a profile in the enquiry flow, and the one that got
            * left behind when the other three were unified on 2026-08-10
            * (`32eb713`). It had already drifted — a square avatar where the
            * card draws a ringed circle, four genre segments where the card
            * shows the curated pills, and no type badge at all, so a venue
            * could not see at a glance whether a HOST or a DJ was asking.
            *
            * ⛔ Not `cover` — that variant is the event page's Presented By and
            * nothing else. The compact 72px row is what a header wants.
            */}
          <div style={{ marginBottom: 18 }}>
            <ProfileCard item={p.id ? p : { ...p, id: enq.applicant_profile_id }} />
          </div>

          {/**
            * THE ENQUIRY'S OWN NOTE — first, and the largest text on the sheet.
            *
            * ⛔⛔ `enq.note` IS ALWAYS THE APPLICANT'S, so the label depends on
            * WHICH SIDE is reading. It said "THEIR MESSAGE" unconditionally,
            * which told a promoter reading the enquiry they had just sent that
            * their own words belonged to the venue — and offered to REPLY to
            * them. ⚠ Same class as every other direction-blind string on this
            * pair of surfaces: the row is one record and the two readers are
            * not interchangeable.
            */}
          {enq.note && (
            <div style={{ background: `rgba(${rgb},.07)`, border: `1px solid rgba(${rgb},.25)`, borderRadius: 14, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, color: 'var(--muted)', marginBottom: 8 }}>
                {enqDir === 'outgoing' ? 'YOUR MESSAGE' : 'THEIR MESSAGE'}
              </div>
              <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text)', margin: 0 }}>{enq.note}</p>
              <button type="button" onClick={reply} disabled={msgBusy || !viewerProfile?.id || !p.id}
                style={{
                  marginTop: 12, background: `linear-gradient(135deg,${accent},${pt?.accent2 || accent})`,
                  color: '#0a0a14', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5,
                  padding: '9px 18px', border: 'none', borderRadius: 9,
                  cursor: msgBusy ? 'default' : 'pointer', opacity: msgBusy ? .6 : 1,
                /* ⛔ You do not REPLY to your own message. Both labels open the
                   same thread in the messenger — only the word changes. */
                }}>{msgBusy ? 'OPENING…' : enqDir === 'outgoing' ? 'MESSAGE →' : 'REPLY →'}</button>
            </div>
          )}

          {/**
            * ⭐ WHAT THEY ARE ASKING FOR — and the venue could not see it.
            *
            * P12 stores `ask_category` at creation, the sender sees it as a
            * chip on their outgoing row, and the picker shows it before the
            * send. The RECEIVING side rendered it nowhere, so the one party
            * whose decision it informs — the venue reading the enquiry — was
            * the only one it was hidden from.
            *
            * ⛔ Null renders NO ROW, never "None" and never the raw key. A
            * host asking for a room has no applicable category, a historical
            * row predates the column, and a key the registry no longer knows
            * is not a label — all three mean "this says nothing", which the
            * Rendering Contract answers by showing nothing (R3).
            */}
          {askLabel && (
            <Row label="ASKING FOR">
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1,
                             padding: '3px 10px', borderRadius: 20, color: accent,
                             border: `1px solid ${accent}`, opacity: .85 }}>
                {askLabel.toUpperCase()}
              </span>
            </Row>
          )}

          <Row label="ASKING ABOUT">
            {dateRaw ? formatDisplayDate(dateRaw) : 'No date specified'}
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
              {/* Says which kind of approach this is. A date enquiry has no
                  event and therefore no requirements — without this line the
                  missing Requirements block reads as a bug. */}
              {enq.event_name ? enq.event_name : 'Direct enquiry · no event attached'}
            </div>
          </Row>

          {snap?.total > 0 && (
            <Row label="REQUIREMENTS">
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: .5, color: snap.satisfied === snap.total ? '#00E5A0' : '#FFD700' }}>
                {snap.satisfied === snap.total ? `✓ ${snap.satisfied}/${snap.total} COMPLETE` : `${snap.satisfied}/${snap.total}`}
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6 }}>
                {(snap.items || []).map(it => {
                  const met = it.state === 'satisfied' || it.state === 'withheld';
                  return (
                    <span key={it.key} style={{ fontSize: 12, color: met ? '#00E5A0' : 'var(--muted)' }}>
                      {met ? '✓' : '○'}&nbsp;{requirementLabel(it.key)}
                    </span>
                  );
                })}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, opacity: .75 }}>
                As submitted {new Date(snap.evaluated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            </Row>
          )}

          {readiness && (
            <Row label="BOOKING READY">
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: .5, color: accent }}>{Math.round(readiness.pct)}%</span>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>profile completeness</span>
            </Row>
          )}

          {/* R3 · a row appears only when it has something to say. "Not
              stated" is used for FEE alone, where the absence is itself
              decision-relevant to a venue. */}
          {/* ⭐ THE ENQUIRY'S OWN NUMBER FIRST, and named for what it is. */}
          <Row label="REQUESTED FEE">
            {requestedFee || <span style={{ color: 'var(--muted)' }}>Not stated</span>}
          </Row>
          {/* ⚠ The act's general rate, clearly a different fact and clearly
              about the ACT rather than about this night. ⛔ Never beside the
              requested fee under one FEE heading — that adjacency is what made
              a rate card read as a payment. */}
          {rate && <Row label="THEIR USUAL RATE">{rate}</Row>}
          {p.bio && <Row label="ABOUT">{p.bio}</Row>}
          {p.sound && <Row label="SOUND">{p.sound}</Row>}
          {p.years && <Row label="ACTIVE SINCE">{p.years}</Row>}
          {demoUrl && (
            <Row label="DEMO">
              <button type="button" onClick={() => onPlayDemo?.({ url: demoUrl, artistName: name })}
                style={{ background: 'none', border: 'none', padding: 0, fontSize: 14, color: accent, cursor: 'pointer' }}>▶ Play demo</button>
            </Row>
          )}
          {(p.contact_email || p.email) && <Row label="CONTACT">{p.contact_email || p.email}</Row>}
          {p.instagram && p.instagram !== 'N/A' && (
            <Row label="INSTAGRAM">
              <a href={socialProfileUrl('instagram', p.instagram)} target="_blank" rel="noopener" style={{ color: accent }}>Open</a>
            </Row>
          )}
          {/* ⚠ "RECEIVED" IS THE RECIPIENT'S WORD. Same timestamp either way —
              `created_at` is when the enquiry was written — but on an outgoing
              row it is the day I SENT it, and calling that "received" told the
              sender they had received their own enquiry. No data change; one
              label, read from the direction. */}
          {enq.created_at && (
            <Row label={enqDir === 'outgoing' ? 'SENT' : 'RECEIVED'}>{new Date(enq.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</Row>
          )}
          <div style={{ height: 12 }} />
        </div>

        {/* Action bar — pinned, so a decision is always one tap away however
            far down the sheet you have scrolled. */}
        <div style={{ padding: '12px 20px calc(16px + var(--yp-safe-bottom))', borderTop: '1px solid rgba(255,255,255,.08)', background: '#13131f', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {/* ⭐ IDENTICAL TO REPLY, because it IS reply — both call the same
                function and open the same conversation. A hollow outline
                beside a filled gradient read as two different weights of
                action, and the quieter-looking one was the primary. Same
                gradient, same ink (owner, 2026-08-11). */}
            <Action onClick={reply} disabled={msgBusy || !viewerProfile?.id || !p.id}
              bg={`linear-gradient(135deg,${accent},${pt?.accent2 || accent})`}
              border="none" color="#0a0a14">
              {msgBusy ? 'OPENING…' : 'MESSAGE'}
            </Action>
            <Action onClick={() => { onClose?.(); navigate(`/profile/${p.id || enq.applicant_profile_id}?type=${p.type || enq.applicant_type || 'artist'}`); }}
              bg="rgba(255,51,153,.12)" border="1px solid rgba(255,51,153,.4)" color="#fff">
              VIEW PROFILE
            </Action>
          </div>
          {/* ⭐ THE SAME CONTROLS THE CARD RENDERS, from the same module. They
              were built twice and drifted: different fills, different borders,
              and `★ ✓ ✗` text glyphs here against outline icons there — so a
              host saw one treatment while triaging and another while deciding,
              for literally the same action.

              ⚠ AND THE SAME DIRECTION RULE. This sheet offered SHORTLIST /
              ACCEPT / DECLINE on every enquiry, including ones the viewer had
              SENT — inviting a promoter to shortlist their own request to a
              venue. The card's fix stopped one tap short of here. */}
          <div className="yp-decision-row" style={{ marginTop: 0 }}>
            {enqDir === 'outgoing' ? (
              /**
               * ⛔⛔ `cancelled`, ⛔ NOT `declined`. This wrote the VENUE'S
               * verdict onto the asker's own withdrawal, filing "I changed my
               * mind" as "I was turned down" — the exact defect fixed on the
               * card on 2026-08-14, which stopped one tap short of this sheet.
               *
               * ⚠⚠ AND THE SAME STATUS GATE AS THE CARD. This sheet had NONE,
               * so it offered CANCEL ENQUIRY on every outgoing row including
               * settled ones. Two controls for one decision must read one rule.
               */
              /* ⭐⭐ TWO STEPS HERE TOO (owner, 2026-09-01). ⛔⛔ THIS SHEET IS
                 WHERE THE DOUBLE-FIRE HAPPENED: the card and the sheet both
                 offer cancel, and a one-tap control on each meant two writes
                 and two notices to the venue for one withdrawal. Guarding only
                 the card would have left the faster door unguarded. */
              cancellable ? (
                confirming ? (
                  <>
                    <DecisionBtn tone="neutral" icon={XIcon} label="KEEP IT"
                      onClick={() => setConfirming(false)} disabled={busy} />
                    <DecisionBtn tone="decline" icon={XIcon} label={busy ? 'CANCELLING…' : 'YES, CANCEL'}
                      onClick={() => respond('cancelled')} disabled={busy} />
                  </>
                ) : (
                  <DecisionBtn tone="decline" icon={XIcon} label="CANCEL ENQUIRY"
                    onClick={() => setConfirming(true)} disabled={busy} />
                )
              ) : null
            ) : (<>
              <DecisionBtn tone="shortlist" icon={StarIcon} label="SHORTLIST"
                onClick={() => respond('shortlisted')} disabled={busy} />
              <DecisionBtn tone="accept" icon={CheckIcon} label="ACCEPT"
                onClick={() => respond('accepted')} disabled={busy} />
              <DecisionBtn tone="decline" icon={XIcon} label="DECLINE"
                onClick={() => respond('declined')} disabled={busy} />
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}
