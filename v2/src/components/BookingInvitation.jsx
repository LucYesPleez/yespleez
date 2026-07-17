import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDisplayDate } from '../lib/dates';
import { formatLocation } from '../lib/formatLocation';
import { PROFILE_TYPES } from '../lib/profileTypes';
import DateBox from './DateBox';

// "20:00" + 60min -> "8:00–9:00pm (60 min)" for the quiet facts strip.
function fmtSlot(startHHMM, durationMin) {
  if (!startHHMM) return '';
  const fmt = d => d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined }).replace(' ', '').toLowerCase();
  const start = new Date(`2000-01-01T${startHHMM}`);
  if (!durationMin) return fmt(start);
  const end = new Date(start.getTime() + durationMin * 60000);
  return `${fmt(start)}–${fmt(end)} · ${durationMin} min`;
}

const ACCENT = PROFILE_TYPES.venue.accent;   // #00E5A0 — this is a venue's invite

/**
 * Level 2 — the full Booking Invitation an artist sees after tapping View Offer.
 * Human story first (the promoter's pitch), quiet facts second, built to give
 * the confidence to say "yeah, keen" — not to display every field.
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
  const [busy, setBusy]         = useState(false);
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
  const firstName = (artistName || '').split(' ')[0];
  const dateRaw   = offer.proposed_date || offer.date_requested || null;
  const slotLabel = fmtSlot(offer.proposed_time, offer.set_duration);
  const extras    = Array.isArray(offer.extras) ? offer.extras : [];
  const fee       = (offer.proposed_fee || '').trim();

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

  const rgb = PROFILE_TYPES.venue.rgb;

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
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: `rgba(${rgb},.15)`, border: `1.5px solid ${ACCENT}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', fontSize: 26, color: ACCENT }}>✓</div>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 26, letterSpacing: 2, color: '#fff', marginBottom: 8 }}>INVITATION ACCEPTED</div>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,.6)', lineHeight: 1.6, maxWidth: 320, margin: '0 auto 28px' }}>
              {venueName} has been notified that you're keen. Sort the final details together to lock the booking in.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button disabled style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, padding: '11px 22px', borderRadius: 10, border: `1px solid rgba(${rgb},.3)`, background: `rgba(${rgb},.06)`, color: 'rgba(255,255,255,.4)', cursor: 'not-allowed' }}>MESSAGE VENUE · SOON</button>
              <button onClick={onClose} style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, padding: '11px 22px', borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.55)', cursor: 'pointer' }}>DONE</button>
            </div>
          </div>
        ) : (
          <>
            {/* ── HERO — the venue's room, the event, the date ── */}
            <div style={{ position: 'relative', height: 190, overflow: 'hidden', borderRadius: '20px 20px 0 0' }}>
              <img src={heroImg} alt={venueName} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(15,15,22,.25) 0%, rgba(15,15,22,.55) 55%, #0f0f16 100%)' }} />
              {/* Grab handle over the image */}
              <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.4)' }} />
              <button onClick={onClose} style={{ position: 'absolute', top: 14, right: 16, background: 'rgba(0,0,0,.45)', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', lineHeight: 1, borderRadius: '50%', width: 30, height: 30 }}>✕</button>
              {dateRaw && <div style={{ position: 'absolute', top: 40, right: 16 }}><DateBox date={dateRaw} size="md" /></div>}
              <div style={{ position: 'absolute', left: 20, right: 20, bottom: 16 }}>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 30, letterSpacing: .5, color: '#fff', lineHeight: 1.05, textShadow: '0 2px 16px rgba(0,0,0,.8)' }}>
                  {offer.event_name || 'A Booking Invitation'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>{venueName}</span>
                  <span style={{ fontFamily: "'Bebas Neue'", fontSize: 9, letterSpacing: 1, color: ACCENT, border: `1px solid ${ACCENT}`, borderRadius: 20, padding: '1px 7px' }}>VENUE</span>
                  {loc && <span style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>· {loc}</span>}
                </div>
              </div>
            </div>

            <div style={{ padding: '20px 20px 28px' }}>

              {/* ── THE PITCH — the human story, front and centre ── */}
              {offer.message && (
                <div style={{ marginBottom: 22 }}>
                  <p style={{ fontSize: 16, lineHeight: 1.7, color: '#fff', margin: 0 }}>
                    <span style={{ fontWeight: 600 }}>Hey {firstName || 'there'} — </span>{offer.message}
                  </p>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,.4)', marginTop: 12, fontStyle: 'italic' }}>— {venueName}</div>
                </div>
              )}

              {/* ── QUIET FACTS — calm, reinforcing, never a spreadsheet ── */}
              <div style={{ border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, overflow: 'hidden', marginBottom: 8 }}>
                {offer.headliner && <Fact label="HEADLINING" value={offer.headliner} strong />}
                {(offer.slot_role || slotLabel) && <Fact label="YOUR SLOT" value={[offer.slot_role, slotLabel].filter(Boolean).join(' · ')} />}
                {(fee || extras.length > 0) && (
                  <div style={{ display: 'flex', gap: 12, padding: '14px 16px', borderTop: '1px solid rgba(255,255,255,.06)', alignItems: 'baseline' }}>
                    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, color: 'rgba(255,255,255,.45)', minWidth: 90 }}>THE OFFER</div>
                    <div style={{ flex: 1 }}>
                      {fee && <span style={{ fontFamily: "'Bebas Neue'", fontSize: 24, color: '#00E5A0', letterSpacing: .5 }}>{fee}</span>}
                      {extras.length > 0 && <div style={{ fontSize: 13, color: 'rgba(255,255,255,.75)', marginTop: fee ? 2 : 0 }}>{fee ? '+ ' : ''}{extras.join(' + ')}</div>}
                    </div>
                  </div>
                )}
                {availability && availability.status !== 'unknown' && (
                  <div style={{ display: 'flex', gap: 12, padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,.06)', alignItems: 'center', background: availability.status === 'clash' ? 'rgba(255,184,48,.05)' : 'rgba(0,229,160,.04)' }}>
                    <span style={{ fontSize: 15 }}>{availability.status === 'clash' ? '⚠' : '✓'}</span>
                    <span style={{ fontSize: 13, color: availability.status === 'clash' ? '#FFB830' : '#00E5A0' }}>
                      {availability.status === 'clash'
                        ? `Heads up — same night as ${availability.clashWith || 'another gig'}`
                        : "You're free that night"}
                    </span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginLeft: 'auto', fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>YESPLEEZ</span>
                  </div>
                )}
              </div>

              {offer.respond_by && (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', textAlign: 'center', marginBottom: 18 }}>
                  {venueName} is holding your spot until {formatDisplayDate(offer.respond_by)}
                </div>
              )}

              {/* ── ACTIONS — Accept opens the relationship (non-binding) ── */}
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
          </>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '14px 16px', alignItems: 'baseline' }}>
      <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, color: 'rgba(255,255,255,.45)', minWidth: 90 }}>{label}</div>
      <div style={{ flex: 1, fontSize: strong ? 15 : 14, color: '#fff', fontWeight: strong ? 600 : 400 }}>{value}</div>
    </div>
  );
}
