import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { writeNotification } from '../lib/writeNotification';
import { resolveProfileId } from '../lib/resolveProfileId';
import { formatLocation } from '../lib/formatLocation';
import { profileIdentity } from '../lib/profileTypes';

const SLOT_ROLES = ['Opener', 'Support', 'Headline'];
const DURATIONS  = [30, 45, 60, 90, 120];
const EXTRAS     = ['Accommodation', 'Meals', 'Travel'];

// Turn "20:00" + 60min into "8:00–9:00pm" for the live preview / card facts.
function fmtSlot(startHHMM, durationMin) {
  if (!startHHMM) return '';
  const fmt = d => d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined }).replace(' ', '').toLowerCase();
  const start = new Date(`2000-01-01T${startHHMM}`);
  if (!durationMin) return fmt(start);
  const end = new Date(start.getTime() + durationMin * 60000);
  return `${fmt(start)}–${fmt(end)}`;
}

export default function InviteSheet({ artist, events = [], venueUserId, initialDate = '', onClose }) {
  const navigate = useNavigate();
  const [eventId,   setEventId]   = useState('');
  const [headliner, setHeadliner] = useState('');
  const [message,   setMessage]   = useState('');
  const [slotRole,  setSlotRole]  = useState('');
  // initialDate prefills the proposed date when the sheet is opened by tapping
  // a date on the performer's availability calendar (11C.3 revision). Still
  // fully editable via the DATE field below.
  const [date,      setDate]      = useState(initialDate || '');
  const [time,      setTime]      = useState('');
  const [duration,  setDuration]  = useState('');
  const [fee,       setFee]       = useState('');
  const [extras,    setExtras]    = useState(new Set());
  const [respondBy, setRespondBy] = useState('');
  const [sending,   setSending]   = useState(false);
  const [sent,      setSent]      = useState(false);
  const [error,     setError]     = useState('');

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const selectedEvent = events.find(e => e.id === eventId);

  // Prefill the date from the chosen event (still overridable) — one less thing
  // to type, and it keeps the invite's date honest to the event.
  useEffect(() => {
    if (selectedEvent?.config?.date && !date) setDate(selectedEvent.config.date);
  }, [eventId]);

  function toggleExtra(x) {
    setExtras(prev => {
      const next = new Set(prev);
      next.has(x) ? next.delete(x) : next.add(x);
      return next;
    });
  }

  async function handleSend() {
    setSending(true);
    setError('');
    const [venueProfileId, applicantProfileId] = await Promise.all([
      resolveProfileId(venueUserId, 'venue'),
      resolveProfileId(artist.user_id, artist.type || 'artist'),
    ]);
    // Every key here is a real column (verified against the live schema,
    // 2026-07-17). Names match the table, not the UI's vocabulary:
    //   date_requested — the proposed date. NOT NULL, no default: the insert
    //                    fails with 23502 without it. The old payload sent
    //                    `proposed_date`, which never existed, and omitted this
    //                    entirely. Renaming the field is NOT sufficient on its
    //                    own — `date` is optional in the form, so the value can
    //                    still be null; `canSend` is what actually guarantees
    //                    the constraint is met.
    //   note           — the message body. The column has always been `note`.
    //   initiated_by   — absolute, not viewer-relative. 'venue' here because
    //                    this sheet is the venue inviting an artist.
    // applicant_name/event_name are deliberately NOT stored — both are derived
    // from applicant_profile_id / event_id at read time.
    const payload = {
      venue_user_id:    venueUserId,
      applicant_user_id: artist.user_id,
      applicant_type:   artist.type || 'artist',
      event_id:         eventId && eventId !== '__new__' ? eventId : null,
      date_requested:   date || null,
      proposed_time:    time || null,
      proposed_fee:     fee.trim() || null,
      note:             message.trim() || null,
      initiated_by:     'venue',
      status:           'pending',
      venue_profile_id:     venueProfileId,
      applicant_profile_id: applicantProfileId,
      headliner:        headliner.trim() || null,
      slot_role:        slotRole || null,
      set_duration:     duration ? parseInt(duration) : null,
      extras:           extras.size ? [...extras] : null,
      respond_by:       respondBy || null,
    };
    const { error: err } = await supabase.from('venue_enquiries').insert(payload);
    setSending(false);
    if (err) {
      // Surface the real reason. This flow has been silently broken more than
      // once behind "Something went wrong" — most recently a 42501 from the
      // applicant-side-only INSERT policy (S4), which is expected until M6
      // replaces it with can_act_as().
      console.error('venue_enquiries insert failed:', err.code, err.message, err.details, err.hint);
      setError(
        err.code === '42501'
          ? "Venues can't send invites yet — this is a known limitation."
          : `Couldn't send the invite (${err.code || 'error'}). Please try again.`
      );
      return;
    }
    // Notify the artist
    await writeNotification(
      artist.user_id,
      'event_invite',
      `You've received an invite to perform${selectedEvent ? ` at ${selectedEvent.name}` : ''}.`,
      { event_id: eventId || null, event_name: selectedEvent?.name || null, host_id: venueUserId, proposed_date: date || null, proposed_fee: fee || null }
    );
    setSent(true);
  }

  const sound  = artist.sound || artist.genre_string?.split(' · ').slice(0, 3).join(' · ') || '';
  const loc    = formatLocation(artist);
  const img    = artist.avatar_thumb || artist.avatar || null;

  // 10F (S35): all four identity values come from one resolver. This screen used
  // to derive `accent` from the token and then infer everything else from it with
  // `accent === '#00E5FF' ? cyan : pink` — a TWO-way test for FIVE types. Every
  // non-artist fell to the else branch, so a Band (#FFB830) rendered orange
  // borders on pink fills with an orange->pink SEND button, and Host's rgb came
  // out as #FF3399's rather than its own. rgb/accent2 were on the token the whole
  // time; the ternary was inferring what it could have looked up.
  const pt         = profileIdentity(artist.type);
  const accent     = pt.accent;
  const accentRgb  = pt.rgb;
  const accent2    = pt.accent2;

  // Always the full name — these are act names, not people's names. Splitting
  // "Daddy Longlegs" to a first word gives you "Hey Daddy", which is nonsense.
  const actName    = (artist.name || '').trim();
  const slotLabel  = fmtSlot(time, duration ? parseInt(duration) : null);
  const extrasList = [...extras];
  // Enough of a pitch to be worth sending — the message is the one thing a
  // form can't fake, so it's the only hard requirement here.
  // `date` is required, not optional polish: it maps to venue_enquiries
  // .date_requested, which is NOT NULL with no default, so sending without one
  // is a guaranteed 23502. Gating here rather than failing at the insert. The
  // DATE field prefills from the selected event, so picking an event satisfies
  // this without extra typing.
  const canSend    = message.trim().length > 0 && !!date && !sending;

  const labelStyle = { fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, color: 'rgba(255,255,255,.6)', display: 'block', marginBottom: 8 };
  const subLabel   = { fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: 'rgba(255,255,255,.45)', display: 'block', marginBottom: 5 };
  const inputStyle = { width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, padding: '10px 12px', color: '#fff', fontFamily: "'DM Sans',sans-serif", fontSize: 13, outline: 'none' };
  const sectionGap = { marginBottom: 22 };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)', zIndex: 9000, display: 'flex', alignItems: 'flex-end', paddingBottom: 'var(--yp-safe-bottom)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="yp-invite-sheet"
        style={{ width: '100%', maxWidth: 680, margin: '0 auto', background: '#13131a', borderRadius: '20px 20px 0 0', borderTop: `2px solid ${accent}`, paddingBottom: 'env(safe-area-inset-bottom,0)', maxHeight: 'calc(92vh - 67px)', overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <style>{`.yp-invite-sheet::-webkit-scrollbar{display:none}`}</style>
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.15)' }} />
        </div>

        <div style={{ padding: '16px 20px 32px' }}>

          {sent ? (
            /* ── Success state ── */
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 26, letterSpacing: 2, color: '#fff', marginBottom: 6 }}>INVITE SENT</div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,.55)', marginBottom: 28 }}>{artist.name} has been notified.</div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => { onClose(); navigate('/venue?section=enquiries&dir=OUTGOING&status=NEW'); }}
                  style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, padding: '10px 24px', borderRadius: 10, border: `1px solid ${accent}`, background: `rgba(${accentRgb},.12)`, color: accent, cursor: 'pointer' }}
                >VIEW OUTGOING ENQUIRIES</button>
                <button
                  onClick={onClose}
                  style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, padding: '10px 24px', borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.5)', cursor: 'pointer' }}
                >DISMISS</button>
              </div>
            </div>
          ) : (
            <>
              {/* ── Header ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                <div>
                  <div style={{ fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: 2, color: '#fff' }}>INVITE ARTIST</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', letterSpacing: 1, marginTop: 1 }}>MAKE THEM A BOOKING OFFER</div>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 4 }}>✕</button>
              </div>

              {/* ── Artist chip ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, padding: '10px 14px', marginBottom: 18 }}>
                {img
                  ? <img src={img} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', objectPosition: 'center top', border: `1.5px solid ${accent}`, flexShrink: 0 }} />
                  : <div style={{ width: 44, height: 44, borderRadius: 8, background: `rgba(0,229,255,.1)`, border: `1.5px solid ${accent}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🎧</div>
                }
                <div>
                  <div style={{ fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: 1, color: '#fff' }}>{artist.name}</div>
                  {(sound || loc) && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>{[sound, loc].filter(Boolean).join(' • ')}</div>}
                </div>
              </div>

              {/* ── LIVE PREVIEW — what the artist will actually receive.
                    Builds itself as the promoter types; a thin pitch reads thin,
                    which nudges them to fill the gaps without a single mandatory
                    field. ── */}
              <div style={{ border: `1px solid rgba(${accentRgb},.3)`, borderRadius: 12, padding: '14px 16px', marginBottom: 24, background: 'rgba(255,255,255,.02)' }}>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: accent, marginBottom: 10 }}>{actName ? `WHAT ${actName.toUpperCase()} WILL SEE` : 'WHAT THEY WILL SEE'}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.65, color: '#fff' }}>
                  <span style={{ fontWeight: 600 }}>Hey {actName || 'there'} — </span>
                  {message.trim()
                    ? message.trim()
                    : <span style={{ color: 'rgba(255,255,255,.3)', fontStyle: 'italic' }}>your pitch appears here as you write it…</span>}
                </div>
                {(slotLabel || slotRole || fee || extrasList.length > 0 || headliner) && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.08)', fontSize: 12.5, color: 'rgba(255,255,255,.7)', lineHeight: 1.7 }}>
                    {selectedEvent && <div>{selectedEvent.name}{date ? ` · ${new Date(date + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}</div>}
                    {headliner && <div>Headlining: <span style={{ color: '#fff' }}>{headliner}</span></div>}
                    {(slotRole || slotLabel) && <div>Your slot: <span style={{ color: '#fff' }}>{[slotRole, slotLabel].filter(Boolean).join(' · ')}</span></div>}
                    {(fee || extrasList.length > 0) && <div>Offer: <span style={{ color: '#00E5A0' }}>{[fee, ...extrasList].filter(Boolean).join(' + ')}</span></div>}
                  </div>
                )}
              </div>

              {/* ══ THE NIGHT ══ */}
              <div style={sectionGap}>
                <label style={labelStyle}>WHICH EVENT?</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {events.slice(0, 6).map(ev => (
                    <label key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: eventId === ev.id ? `rgba(${accentRgb},.1)` : 'rgba(255,255,255,.04)', border: `1px solid ${eventId === ev.id ? accent : 'rgba(255,255,255,.1)'}`, borderRadius: 10, padding: '10px 14px', cursor: 'pointer', transition: 'all .15s' }}>
                      <input type="radio" name="invite-event" value={ev.id} checked={eventId === ev.id} onChange={() => setEventId(ev.id)} style={{ accentColor: accent, flexShrink: 0 }} />
                      <span style={{ fontFamily: "'DM Sans'", fontSize: 13, color: '#fff' }}>{ev.name}</span>
                      {ev.config?.date && <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginLeft: 'auto' }}>{ev.config.date}</span>}
                    </label>
                  ))}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, background: eventId === '__new__' ? 'rgba(0,229,160,.08)' : 'rgba(255,255,255,.04)', border: `1px solid ${eventId === '__new__' ? '#00E5A0' : 'rgba(255,255,255,.1)'}`, borderRadius: 10, padding: '10px 14px', cursor: 'pointer', transition: 'all .15s' }}>
                    <input type="radio" name="invite-event" value="__new__" checked={eventId === '__new__'} onChange={() => setEventId('__new__')} style={{ accentColor: '#00E5A0', flexShrink: 0 }} />
                    <span style={{ fontFamily: "'DM Sans'", fontSize: 13, color: 'rgba(255,255,255,.6)' }}>+ Create New Event</span>
                  </label>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={subLabel}>WHO'S HEADLINING / ALSO PLAYING <span style={{ opacity: .6 }}>(the pull)</span></label>
                  <input type="text" value={headliner} onChange={e => setHeadliner(e.target.value)} placeholder="e.g. Flowidus" style={inputStyle} />
                </div>
              </div>

              {/* ══ YOUR PITCH ══ */}
              <div style={sectionGap}>
                <label style={labelStyle}>YOUR PITCH <span style={{ opacity: .5, fontSize: 11 }}>— WHY THEM?</span></label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder={`Talk to ${actName || 'them'} like a person. What's the night about, and why do you want them on it? "We've been deep in your recent mixes — that rolling jungle sound is exactly the energy we want to open the room…"`}
                  rows={4}
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                />
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 6 }}>This is the one thing that turns an invite into a real offer. Make it personal.</div>
              </div>

              {/* ══ THE SLOT ══ */}
              <div style={sectionGap}>
                <label style={labelStyle}>THE SLOT</label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                  {SLOT_ROLES.map(r => (
                    <button key={r} type="button" onClick={() => setSlotRole(slotRole === r ? '' : r)}
                      style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1, padding: '7px 16px', borderRadius: 20, cursor: 'pointer', transition: 'all .15s',
                        background: slotRole === r ? `rgba(${accentRgb},.15)` : 'rgba(255,255,255,.04)',
                        border: `1px solid ${slotRole === r ? accent : 'rgba(255,255,255,.12)'}`,
                        color: slotRole === r ? accent : 'rgba(255,255,255,.6)' }}>{r}</button>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={subLabel}>DATE</label>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark' }} />
                  </div>
                  <div>
                    <label style={subLabel}>START</label>
                    <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark' }} />
                  </div>
                  <div>
                    <label style={subLabel}>LENGTH</label>
                    <select value={duration} onChange={e => setDuration(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark', color: duration ? '#fff' : 'rgba(255,255,255,.35)' }}>
                      <option value="">—</option>
                      {DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* ══ THE OFFER ══ */}
              <div style={sectionGap}>
                <label style={labelStyle}>THE OFFER</label>
                <input type="text" value={fee} onChange={e => setFee(e.target.value)} placeholder="e.g. $900, or $300 + door split" style={{ ...inputStyle, marginBottom: 10 }} />
                <label style={subLabel}>WHAT'S COVERED</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {EXTRAS.map(x => (
                    <button key={x} type="button" onClick={() => toggleExtra(x)}
                      style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1, padding: '7px 16px', borderRadius: 20, cursor: 'pointer', transition: 'all .15s',
                        background: extras.has(x) ? 'rgba(0,229,160,.12)' : 'rgba(255,255,255,.04)',
                        border: `1px solid ${extras.has(x) ? '#00E5A0' : 'rgba(255,255,255,.12)'}`,
                        color: extras.has(x) ? '#00E5A0' : 'rgba(255,255,255,.6)' }}>
                      {extras.has(x) ? '✓ ' : '+ '}{x}
                    </button>
                  ))}
                </div>
              </div>

              {/* ══ HOLDING THE SPOT ══ */}
              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>HOLD THE SPOT UNTIL <span style={{ opacity: .5, fontSize: 11 }}>(OPTIONAL)</span></label>
                <input type="date" value={respondBy} onChange={e => setRespondBy(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark' }} />
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 6 }}>Gives {actName || 'them'} an honest deadline — and keeps your night moving.</div>
              </div>

              {error && <div style={{ fontSize: 13, color: '#ff6b6b', marginBottom: 12 }}>{error}</div>}

              {/* ── Send button ── */}
              <button
                onClick={handleSend}
                disabled={!canSend}
                style={{ width: '100%', fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: 2, padding: '14px', borderRadius: 12, border: 'none', background: !canSend ? 'rgba(255,255,255,.08)' : `linear-gradient(135deg, ${accent}, ${accent2})`, color: !canSend ? 'rgba(255,255,255,.35)' : '#0a0a14', cursor: !canSend ? 'not-allowed' : 'pointer', transition: 'opacity .15s', fontWeight: 700 }}
              >{sending ? 'SENDING…' : 'SEND INVITATION'}</button>
              {!message.trim() && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginTop: 8, textAlign: 'center' }}>Add a pitch to send</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
