// EP-00 · extracted verbatim from EventScreen.jsx. Public-view only.
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getPerformerProfiles } from '../../lib/actingProfile';
import { track, EVENTS } from '../../lib/analytics';
import UnclaimedNotice from '../../components/UnclaimedNotice';
import s from '../EventScreen.module.css';

export default function ApplyButton({ eventId, userId, ownerProfile }) {
  const [status,        setStatus]        = useState(null);
  const [note,          setNote]          = useState('');
  const [open,          setOpen]          = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [checked,       setChecked]       = useState(false);
  const [performers,    setPerformers]    = useState([]);
  const [actingId,      setActingId]      = useState(null);

  useEffect(() => {
    if (!userId || !eventId) { setChecked(true); return; }
    supabase.from('applications').select('status').eq('event_id', eventId).eq('artist_id', userId).maybeSingle()
      .then(({ data }) => { setStatus(data?.status || null); setChecked(true); });
  }, [eventId, userId]);

  useEffect(() => {
    if (!userId) return;
    // M6: the acting profile comes from the one seam (actingProfile.js).
    // Auto-select ONLY when there is exactly one eligible profile; with
    // several the user chooses, because guessing the sender is precisely
    // what B2 cost us on every pre-M6 application row.
    getPerformerProfiles(userId).then(list => {
      setPerformers(list);
      setActingId(list.length === 1 ? list[0].id : null);
    });
  }, [userId]);

  if (!checked) return null;
  if (!userId)  return null;

  if (status) {
    const col = { accepted: 'var(--green)', pending: 'var(--gold)', rejected: 'var(--muted)' }[status] || 'var(--muted)';
    return (
      <div style={{ marginBottom: 16 }}>
        <p style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, color: col }}>
          APPLICATION {status.toUpperCase()}
        </p>
      </div>
    );
  }

  async function submit() {
    // R6.1: never write an application that cannot name its sender.
    if (!actingId) return;
    setLoading(true);
    const { error } = await supabase.from('applications').insert({
      event_id: eventId,
      artist_id: userId,
      from_profile_id: actingId,
      status: 'pending',
      note,
    });
    setLoading(false);
    if (!error) {
      setStatus('pending'); setOpen(false);
      // A1 · a genuine application. Accepting a slot OFFER (ArtistDashboard,
      // notifActions) also inserts into `applications`, but that is the host
      // asking and the artist agreeing — a different act, deliberately not
      // counted here.
      track(EVENTS.APPLIED, { has_note: !!(note && note.trim()) });
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {!open ? (
        <button className={s.applyBtn} onClick={() => setOpen(true)}>APPLY TO PLAY</button>
      ) : (
        <div className={s.applyForm}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 2, marginBottom: 8 }}>YOUR APPLICATION</p>
          {/* M6 · acting profile. One eligible profile is stated; several
              are chosen from. Nothing is pre-selected when it is ambiguous —
              a default here would be a guess wearing a confirmation. */}
          {performers.length === 1 && (
            <p style={{ fontSize: 12, color: 'var(--neon2)', marginBottom: 8, fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>
              APPLYING AS: {performers[0].name} · {performers[0].sound || performers[0].genre_string || ''}
            </p>
          )}
          {performers.length > 1 && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>APPLYING AS</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {performers.map(p => {
                  const on = p.id === actingId;
                  return (
                    <button key={p.id} type="button" onClick={() => setActingId(p.id)}
                      style={{
                        padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                        fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1,
                        border: `1px solid ${on ? 'var(--neon2)' : 'var(--border)'}`,
                        background: on ? 'rgba(0,229,255,.12)' : 'none',
                        color: on ? 'var(--neon2)' : 'var(--muted)',
                      }}>
                      {p.name || '(unnamed)'}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {performers.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              You need an artist, band or comedy profile before you can apply.
            </p>
          )}
          <textarea value={note} onChange={e => setNote(e.target.value)}
            placeholder="Add a note for the host (optional)…" rows={3}
            style={{ width: '100%', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '10px 12px', fontSize: 13, outline: 'none', resize: 'none', marginBottom: 10 }} />
          {/* N2 · immediately above SEND, the last thing read before acting.
              APPLY TO PLAY is gated on `!isHost && !isGuest && applications_open`
              and never on the owner's claim state, so an event imported for an
              organiser who has never joined is applyable — and said nothing. */}
          <UnclaimedNotice profile={ownerProfile} context="apply" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setOpen(false)}
              style={{ flex: 1, background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, padding: 10, borderRadius: 8 }}>CANCEL</button>
            <button onClick={submit} disabled={loading || !actingId} className={s.applyBtn}
              style={{ flex: 2, opacity: actingId ? 1 : .5 }}>
              {loading ? '…' : performers.length > 1 && !actingId ? 'CHOOSE A PROFILE' : 'SEND APPLICATION'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
