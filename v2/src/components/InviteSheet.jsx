import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { writeNotification } from '../lib/writeNotification';

const PERF_TYPES = ['DJ Set', 'Live Set', 'MC / Host', 'Band', 'Comedy / Spoken Word', 'Other'];

export default function InviteSheet({ artist, events = [], venueUserId, onClose }) {
  const navigate = useNavigate();
  const [eventId,   setEventId]   = useState('');
  const [message,   setMessage]   = useState('');
  const [perfType,  setPerfType]  = useState('');
  const [date,      setDate]      = useState('');
  const [time,      setTime]      = useState('');
  const [fee,       setFee]       = useState('');
  const [notes,     setNotes]     = useState('');
  const [showDetails, setShowDetails] = useState(true);
  const [sending,   setSending]   = useState(false);
  const [sent,      setSent]      = useState(false);
  const [error,     setError]     = useState('');

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const selectedEvent = events.find(e => e.id === eventId);

  async function handleSend() {
    setSending(true);
    setError('');
    const payload = {
      venue_user_id:    venueUserId,
      applicant_user_id: artist.user_id,
      applicant_type:   artist.type || 'artist',
      applicant_name:   artist.name,
      event_id:         eventId || null,
      event_name:       selectedEvent?.name || null,
      message:          message.trim() || null,
      performance_type: perfType || null,
      proposed_date:    date || null,
      proposed_time:    time || null,
      proposed_fee:     fee || null,
      notes:            notes.trim() || null,
      direction:        'outgoing',
      status:           'new',
    };
    const { error: err } = await supabase.from('venue_enquiries').insert(payload);
    setSending(false);
    if (err) { setError('Something went wrong. Please try again.'); return; }
    // Notify the artist
    await writeNotification(
      artist.user_id,
      'event_invite',
      `You've received an invite to perform${selectedEvent ? ` at ${selectedEvent.name}` : ''}.`,
      { event_id: eventId || null, event_name: selectedEvent?.name || null, host_id: venueUserId, proposed_date: date || null, proposed_fee: fee || null }
    );
    setSent(true);
  }

  const type   = (artist.type || 'artist').toLowerCase();
  const sound  = artist.sound || artist.genre_string?.split(' · ').slice(0,3).join(' · ') || '';
  const loc    = [artist.suburb || artist.location, artist.state].filter(Boolean).join(', ');
  const img    = artist.avatar_thumb || artist.avatar || null;

  const TYPE_COL = { artist: '#00E5FF', host: '#FF3399', band: '#FF8C42', standup: '#FF88AA', venue: '#00E5A0' };
  const accent = TYPE_COL[type] || '#00E5FF';

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)', zIndex: 9000, display: 'flex', alignItems: 'flex-end', paddingBottom: 67 }}
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
                  style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, padding: '10px 24px', borderRadius: 10, border: `1px solid ${accent}`, background: `rgba(${accent === '#00E5FF' ? '0,229,255' : '255,51,153'},.12)`, color: accent, cursor: 'pointer' }}
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                  <div style={{ fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: 2, color: '#fff' }}>INVITE ARTIST</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', letterSpacing: 1, marginTop: 1 }}>SEND AN INVITATION TO PERFORM</div>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 4 }}>✕</button>
              </div>

              {/* ── Artist chip ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, padding: '10px 14px', marginBottom: 24 }}>
                {img
                  ? <img src={img} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', objectPosition: 'center top', border: `1.5px solid ${accent}`, flexShrink: 0 }} />
                  : <div style={{ width: 44, height: 44, borderRadius: 8, background: `rgba(0,229,255,.1)`, border: `1.5px solid ${accent}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🎧</div>
                }
                <div>
                  <div style={{ fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: 1, color: '#fff' }}>{artist.name}</div>
                  {(sound || loc) && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>{[sound, loc].filter(Boolean).join(' • ')}</div>}
                </div>
              </div>

              {/* ── Which event? ── */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, color: 'rgba(255,255,255,.6)', display: 'block', marginBottom: 8 }}>WHICH EVENT?</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {events.slice(0, 6).map(ev => (
                    <label key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: eventId === ev.id ? `rgba(${accent === '#00E5FF' ? '0,229,255' : '255,51,153'},.1)` : 'rgba(255,255,255,.04)', border: `1px solid ${eventId === ev.id ? accent : 'rgba(255,255,255,.1)'}`, borderRadius: 10, padding: '10px 14px', cursor: 'pointer', transition: 'all .15s' }}>
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
              </div>

              {/* ── Message ── */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, color: 'rgba(255,255,255,.6)', display: 'block', marginBottom: 8 }}>MESSAGE <span style={{ opacity: .5, fontSize: 11 }}>(OPTIONAL)</span></label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder={`Hey ${artist.name.split(' ')[0]}, we'd love to have you perform at our event…`}
                  rows={3}
                  style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontFamily: "'DM Sans',sans-serif", fontSize: 13, resize: 'vertical', outline: 'none', lineHeight: 1.5 }}
                />
              </div>

              {/* ── Proposed details toggle ── */}
              <button
                onClick={() => setShowDetails(v => !v)}
                style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.2, color: showDetails ? accent : 'rgba(255,255,255,.4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: showDetails ? 14 : 20, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {showDetails ? '▾' : '▸'} PROPOSED DETAILS
              </button>

              {showDetails && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
                  {/* Performance type */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: 'rgba(255,255,255,.45)', display: 'block', marginBottom: 5 }}>PERFORMANCE TYPE</label>
                    <select value={perfType} onChange={e => setPerfType(e.target.value)} style={{ width: '100%', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, padding: '9px 12px', color: perfType ? '#fff' : 'rgba(255,255,255,.35)', fontFamily: "'DM Sans',sans-serif", fontSize: 13, outline: 'none' }}>
                      <option value="">Select…</option>
                      {PERF_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {/* Date */}
                  <div>
                    <label style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: 'rgba(255,255,255,.45)', display: 'block', marginBottom: 5 }}>DATE</label>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, padding: '9px 12px', color: '#fff', fontFamily: "'DM Sans',sans-serif", fontSize: 13, outline: 'none', colorScheme: 'dark' }} />
                  </div>
                  {/* Time */}
                  <div>
                    <label style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: 'rgba(255,255,255,.45)', display: 'block', marginBottom: 5 }}>TIME</label>
                    <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, padding: '9px 12px', color: '#fff', fontFamily: "'DM Sans',sans-serif", fontSize: 13, outline: 'none', colorScheme: 'dark' }} />
                  </div>
                  {/* Fee */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: 'rgba(255,255,255,.45)', display: 'block', marginBottom: 5 }}>PROPOSED FEE</label>
                    <input type="text" value={fee} onChange={e => setFee(e.target.value)} placeholder="e.g. $300 + door" style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, padding: '9px 12px', color: '#fff', fontFamily: "'DM Sans',sans-serif", fontSize: 13, outline: 'none' }} />
                  </div>
                  {/* Notes */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: 'rgba(255,255,255,.45)', display: 'block', marginBottom: 5 }}>NOTES</label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Load-in time, stage requirements, parking…" rows={2} style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, padding: '9px 12px', color: '#fff', fontFamily: "'DM Sans',sans-serif", fontSize: 13, resize: 'none', outline: 'none' }} />
                  </div>
                </div>
              )}

              {error && <div style={{ fontSize: 13, color: '#ff6b6b', marginBottom: 12 }}>{error}</div>}

              {/* ── Send button ── */}
              <button
                onClick={handleSend}
                disabled={sending}
                style={{ width: '100%', fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: 2, padding: '14px', borderRadius: 12, border: 'none', background: sending ? 'rgba(255,255,255,.1)' : `linear-gradient(135deg, ${accent}, ${accent === '#00E5FF' ? '#00B4D8' : '#FF69B4'})`, color: sending ? 'rgba(255,255,255,.4)' : '#0a0a14', cursor: sending ? 'not-allowed' : 'pointer', transition: 'opacity .15s', fontWeight: 700 }}
              >{sending ? 'SENDING…' : 'SEND INVITE'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
