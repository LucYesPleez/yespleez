import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDisplayDate } from '../lib/dates';
import { formatLocation } from '../lib/formatLocation';
import { PROFILE_TYPES } from '../lib/profileTypes';
import DateBox from './DateBox';

const fmtTime = d => d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined }).replace(' ', '').toLowerCase();

// "20:00" + 60 -> "8–9pm"
function timeRange(startHHMM, durationMin) {
  if (!startHHMM) return '';
  const start = new Date(`2000-01-01T${startHHMM}`);
  if (!durationMin) return fmtTime(start);
  return `${fmtTime(start)}–${fmtTime(new Date(start.getTime() + durationMin * 60000))}`;
}

const ACCENT = PROFILE_TYPES.venue.accent;   // #00E5A0 — this is a venue's invite
const RGB    = PROFILE_TYPES.venue.rgb;

/**
 * Level 2 — the full Booking Invitation an artist sees after tapping View Offer.
 *
 * Human story first: the promoter's pitch is the hero of the screen. The facts
 * (set, offer, clash-check) sit beneath it as quiet reinforcement, and the
 * actions come last — the artist should understand what they're being offered
 * before they're asked to answer. Built to give the confidence to say "yeah,
 * keen", not to display every field.
 *
 * Props:
 *   offer        – venue_enquiries row + { venueProfile, venue_name }
 *   artistName   – for the "Hey X —" greeting
 *   availability – { status: 'free'|'clash'|'unknown', clashWith?: string }
 *   onRespond    – (id, status) => void
 *   onClose      – () => void
 */
export default function BookingInvitation({ offer, artistName, availability, onRespond, onClose }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  // Reopening an offer you've already accepted shows the accepted state — it
  // must never re-offer Accept on something that's already been said yes to.
  const [accepted, setAccepted] = useState(
    ['accepted', 'booked', 'confirmed'].includes((offer.status || '').toLowerCase())
  );

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const vp        = offer.venueProfile || {};
  const venueName = offer.venue_name || vp.name || 'A venue';
  const heroImg   = vp.avatar_hero || vp.avatar || PROFILE_TYPES.venue.defaultImage;
  const loc       = formatLocation(vp);
  // Full act name, never a first word — "Daddy Longlegs" is not "Daddy".
  const actName   = (artistName || '').trim();
  const dateRaw   = offer.proposed_date || offer.date_requested || null;
  const extras    = Array.isArray(offer.extras) ? offer.extras : [];
  const fee       = (offer.proposed_fee || '').trim();
  const pitch     = (offer.message || '').trim();
  const slotTime  = timeRange(offer.proposed_time, offer.set_duration);

  const hasSet   = !!(offer.slot_role || slotTime || offer.set_duration);
  const hasOffer = !!(fee || extras.length);
  // An invite with no pitch, no offer and no slot is genuinely empty — say so
  // plainly rather than presenting a handsome frame around nothing.
  const isThin   = !pitch && !hasOffer && !hasSet;

  async function respond(status) {
    if (busy) return;
    setBusy(true);
    await onRespond?.(offer.id, status);
    setBusy(false);
    if (status === 'accepted') setAccepted(true);
    else onClose?.();
  }

  function viewVenue() {
    const pid = vp.id || offer.venue_profile_id;
    navigate(pid ? `/profile/${pid}?type=venue` : `/profile/${offer.venue_user_id}?type=venue`);
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)', zIndex: 9000, display: 'flex', alignItems: 'flex-end', paddingBottom: 'var(--yp-safe-bottom)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="yp-booking-sheet"
        style={{ width: '100%', maxWidth: 680, margin: '0 auto', background: '#0f0f16', borderRadius: '20px 20px 0 0', maxHeight: 'calc(94vh - 40px)', overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <style>{`.yp-booking-sheet::-webkit-scrollbar{display:none}`}</style>

        {accepted ? (
          /* ── Model A accept: the invitation is accepted, the booking isn't.
                Opens the relationship, nothing binding. ── */
          <div style={{ padding: '48px 24px 40px', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: `rgba(${RGB},.15)`, border: `1.5px solid ${ACCENT}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', fontSize: 26, color: ACCENT }}>✓</div>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 26, letterSpacing: 2, color: '#fff', marginBottom: 8 }}>INVITATION ACCEPTED</div>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,.6)', lineHeight: 1.6, maxWidth: 320, margin: '0 auto 28px' }}>
              {venueName} has been notified that you're keen. Sort the final details together to lock the booking in.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button disabled style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, padding: '11px 22px', borderRadius: 10, border: `1px solid rgba(${RGB},.3)`, background: `rgba(${RGB},.06)`, color: 'rgba(255,255,255,.4)', cursor: 'not-allowed' }}>MESSAGE VENUE · SOON</button>
              <button onClick={onClose} style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, padding: '11px 22px', borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.55)', cursor: 'pointer' }}>DONE</button>
            </div>
          </div>
        ) : (
          <>
            {/* ── HERO — what the night is, who's on, where and when ── */}
            <div style={{ position: 'relative', minHeight: 200, overflow: 'hidden', borderRadius: '20px 20px 0 0' }}>
              <img src={heroImg} alt={venueName} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(15,15,22,.3) 0%, rgba(15,15,22,.6) 50%, #0f0f16 100%)' }} />
              <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.4)' }} />
              <button onClick={onClose} style={{ position: 'absolute', top: 14, right: 16, background: 'rgba(0,0,0,.45)', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', lineHeight: 1, borderRadius: '50%', width: 30, height: 30 }}>✕</button>
              {dateRaw && <div style={{ position: 'absolute', top: 40, right: 16 }}><DateBox date={dateRaw} size="md" /></div>}

              <div style={{ position: 'relative', padding: '68px 20px 18px' }}>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 2, color: ACCENT, marginBottom: 6 }}>BOOKING INVITATION</div>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 30, letterSpacing: .5, color: '#fff', lineHeight: 1.05, textShadow: '0 2px 16px rgba(0,0,0,.8)' }}>
                  {offer.event_name || `A night at ${venueName}`}
                </div>
                {offer.headliner && (
                  <div style={{ fontSize: 14, color: '#fff', marginTop: 5, textShadow: '0 1px 8px rgba(0,0,0,.8)' }}>
                    <span style={{ color: 'rgba(255,255,255,.55)' }}>with </span>
                    <span style={{ fontWeight: 600 }}>{offer.headliner}</span>
                    <span style={{ color: 'rgba(255,255,255,.55)' }}> headlining</span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>{venueName}</span>
                  <span style={{ fontFamily: "'Bebas Neue'", fontSize: 9, letterSpacing: 1, color: ACCENT, border: `1px solid ${ACCENT}`, borderRadius: 20, padding: '1px 7px' }}>VENUE</span>
                  {loc && <span style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>· {loc}</span>}
                </div>
              </div>
            </div>

            <div style={{ padding: '4px 20px 28px' }}>

              {/* ── THE PITCH — the hero of the screen ── */}
              {pitch && (
                <div style={{ marginBottom: 26 }}>
                  <p style={{ fontSize: 16, lineHeight: 1.7, color: '#fff', margin: 0, whiteSpace: 'pre-line' }}>
                    <span style={{ fontWeight: 600 }}>Hey {actName || 'there'} — </span>{pitch}
                  </p>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,.4)', marginTop: 12, fontStyle: 'italic' }}>— {venueName}</div>
                </div>
              )}

              {isThin && (
                <div style={{ marginBottom: 24, padding: '14px 16px', borderRadius: 12, background: 'rgba(255,184,48,.06)', border: '1px solid rgba(255,184,48,.2)' }}>
                  <div style={{ fontSize: 13.5, color: '#FFB830', lineHeight: 1.6 }}>
                    {venueName} didn't include any details with this invitation — no pitch, set time or offer.
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', marginTop: 6 }}>
                    Worth asking them what they have in mind before you commit.
                  </div>
                </div>
              )}

              {/* ── YOUR SET ── */}
              {hasSet && (
                <Section label="YOUR SET">
                  {offer.slot_role && <div style={{ fontFamily: "'Bebas Neue'", fontSize: 21, letterSpacing: .5, color: '#fff' }}>{offer.slot_role}</div>}
                  {slotTime && <div style={{ fontSize: 15, color: '#fff', marginTop: 3 }}>{slotTime}</div>}
                  {offer.set_duration && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{offer.set_duration} minutes</div>}
                </Section>
              )}

              {/* ── YOUR OFFER — the deal, not just a number ── */}
              {hasOffer && (
                <Section label="YOUR OFFER">
                  {fee && <div style={{ fontFamily: "'Bebas Neue'", fontSize: 34, letterSpacing: .5, color: ACCENT, lineHeight: 1 }}>{fee}</div>}
                  {extras.length > 0 && (
                    <div style={{ marginTop: fee ? 10 : 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {extras.map(x => (
                        <div key={x} style={{ fontSize: 14, color: 'rgba(255,255,255,.85)' }}>
                          <span style={{ color: ACCENT, marginRight: 7 }}>✓</span>{x}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {/* ── The one thing no email can tell you ── */}
              {availability && availability.status !== 'unknown' && (
                <Section label="YESPLEEZ">
                  <div style={{ fontSize: 14, color: availability.status === 'clash' ? '#FFB830' : ACCENT }}>
                    {availability.status === 'clash'
                      ? `⚠ Same night as ${availability.clashWith || 'another gig'}`
                      : "✓ You're free that night"}
                  </div>
                </Section>
              )}

              {offer.respond_by && (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', textAlign: 'center', margin: '20px 0 16px' }}>
                  {venueName} is holding your spot until {formatDisplayDate(offer.respond_by)}
                </div>
              )}

              {/* ── ACTIONS — last, once the offer has spoken for itself ── */}
              <div style={{ marginTop: 24 }}>
                <button
                  onClick={() => respond('accepted')}
                  disabled={busy}
                  style={{ width: '100%', fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: 2, padding: '15px', borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${ACCENT}, #00B4D8)`, color: '#0a0a14', cursor: busy ? 'default' : 'pointer', fontWeight: 700, opacity: busy ? .6 : 1, marginBottom: 10 }}
                >{busy ? '…' : 'ACCEPT INVITATION'}</button>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled style={{ flex: 1, fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2, padding: '11px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.02)', color: 'rgba(255,255,255,.35)', cursor: 'not-allowed' }}>MESSAGE · SOON</button>
                  <button onClick={viewVenue} style={{ flex: 1, fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2, padding: '11px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.7)', cursor: 'pointer' }}>VIEW VENUE</button>
                  <button onClick={() => respond('declined')} disabled={busy} style={{ flex: 1, fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2, padding: '11px 0', borderRadius: 10, border: '1px solid rgba(255,80,80,.25)', background: 'none', color: 'rgba(255,120,120,.8)', cursor: 'pointer' }}>DECLINE</button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div style={{ padding: '16px 0', borderTop: '1px solid rgba(255,255,255,.07)' }}>
      <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 2, color: 'rgba(255,255,255,.4)', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}
