import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDisplayDate } from '../lib/dates';
import { formatLocation } from '../lib/formatLocation';
import { socialProfileUrl, ensureHttps } from '../lib/socialLinks';
import { openDirectConversation } from '../lib/messaging';
import { useConversationUi } from '../lib/conversationUi';
import { completionFor, requirementLabel } from '../lib/requirements';
import { PROFILE_TYPES } from '../lib/profileTypes';

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
  const { openConversation } = useConversationUi();
  const [busy,    setBusy]    = useState(false);
  const [msgBusy, setMsgBusy] = useState(false);

  const p        = enq.profile || {};
  const pt       = PROFILE_TYPES[p.type || enq.applicant_type];
  const accent   = pt?.accent || '#00E5FF';
  const rgb      = pt?.rgb    || '0,229,255';
  const name     = p.name || enq.name || '—';
  const snap     = enq.requirements_snapshot || null;
  const readiness = p.type ? completionFor(p, p.type) : null;
  const demoUrl  = ensureHttps(p.mix_link) || socialProfileUrl('soundcloud', p.soundcloud) || socialProfileUrl('mixcloud', p.mixcloud);
  const dateRaw  = enq.date_requested || enq.preferred_date || null;

  const fee = [
    p.fee ? `$${p.fee}` : null,
    p.fee_type === 'paid' ? 'Paid' : p.fee_type === 'exposure' ? 'Exposure / door deal' : null,
  ].filter(Boolean).join(' — ');

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
      openConversation(conversationId, { profile: { id: p.id, name, type: p.type } });
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
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 18 }}>
            <img src={p.avatar || pt?.defaultImage || PROFILE_TYPES.artist.defaultImage} alt={name}
              style={{ width: 60, height: 60, borderRadius: 12, objectFit: 'cover', border: `2px solid ${accent}`, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 24, letterSpacing: 1, color: '#fff', lineHeight: 1.1 }}>{name}</div>
              {formatLocation(p) && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{formatLocation(p)}</div>}
              {p.genre_string && <div style={{ fontSize: 12, color: accent, marginTop: 2 }}>{p.genre_string.split(' · ').slice(0, 4).join(' · ')}</div>}
            </div>
          </div>

          {/* THEIR MESSAGE — first, and the largest text on the sheet. */}
          {enq.note && (
            <div style={{ background: `rgba(${rgb},.07)`, border: `1px solid rgba(${rgb},.25)`, borderRadius: 14, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, color: 'var(--muted)', marginBottom: 8 }}>THEIR MESSAGE</div>
              <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text)', margin: 0 }}>{enq.note}</p>
              <button type="button" onClick={reply} disabled={msgBusy || !viewerProfile?.id || !p.id}
                style={{
                  marginTop: 12, background: `linear-gradient(135deg,${accent},${pt?.accent2 || accent})`,
                  color: '#0a0a14', fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5,
                  padding: '9px 18px', border: 'none', borderRadius: 9,
                  cursor: msgBusy ? 'default' : 'pointer', opacity: msgBusy ? .6 : 1,
                }}>{msgBusy ? 'OPENING…' : 'REPLY →'}</button>
            </div>
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
          <Row label="FEE">{fee || <span style={{ color: 'var(--muted)' }}>Not stated</span>}</Row>
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
          {enq.created_at && (
            <Row label="RECEIVED">{new Date(enq.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</Row>
          )}
          <div style={{ height: 12 }} />
        </div>

        {/* Action bar — pinned, so a decision is always one tap away however
            far down the sheet you have scrolled. */}
        <div style={{ padding: '12px 20px calc(16px + var(--yp-safe-bottom))', borderTop: '1px solid rgba(255,255,255,.08)', background: '#13131f', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <Action onClick={reply} disabled={msgBusy || !viewerProfile?.id || !p.id}
              bg={`rgba(${rgb},.14)`} border={`1px solid rgba(${rgb},.5)`} color={accent}>
              {msgBusy ? 'OPENING…' : 'MESSAGE'}
            </Action>
            <Action onClick={() => { onClose?.(); navigate(`/profile/${p.id || enq.applicant_profile_id}?type=${p.type || enq.applicant_type || 'artist'}`); }}
              bg="rgba(255,51,153,.12)" border="1px solid rgba(255,51,153,.4)" color="#fff">
              VIEW PROFILE
            </Action>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Action onClick={() => respond('shortlisted')} disabled={busy}
              bg="rgba(0,180,216,.12)" border="1px solid rgba(0,180,216,.45)" color="#00B4D8">SHORTLIST ★</Action>
            <Action onClick={() => respond('accepted')} disabled={busy}
              bg="rgba(0,229,160,.12)" border="1px solid rgba(0,229,160,.45)" color="#00E5A0">ACCEPT ✓</Action>
            <Action onClick={() => respond('declined')} disabled={busy}
              bg="rgba(255,80,80,.08)" border="1px solid rgba(255,80,80,.3)" color="var(--muted)">DECLINE ✗</Action>
          </div>
        </div>
      </div>
    </div>
  );
}
