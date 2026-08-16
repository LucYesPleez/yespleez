/**
 * FIND AN ARTIST AND PUT THEM ON THE SHORTLIST.
 *
 * ⭐ A SIBLING OF `ArtistPicker`, ⛔ NOT A MODE ON IT. Same gesture — type, see
 * who matches — but a different RESULT, and the consumer-identity rule makes a
 * new shape a sibling rather than a flag. `ArtistPicker` resolves to a NAME and
 * says so in capitals: it fills a text field on an offer, and its header
 * forbids resolving that name back to a profile because names collide and acts
 * rename. This resolves to a PROFILE, because a shortlisted artist has to be a
 * real reference — dedupe, MESSAGE and PROFILE all key on the id.
 *
 * ⚠ THE 250ms BEAT AND THE TWO-CHARACTER FLOOR ARE COPIED DELIBERATELY from
 * `ArtistPicker`, so the two searches in one product feel like one thing.
 */
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { profileIdentity } from '../lib/profileTypes';
import { findArtistOnEvent, BOOKABLE_ACT_TYPES } from '../lib/shortlistFromArtist';

export default function ShortlistArtistSheet({ members = [], onPick, onClose, busy = false, error = null }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const inFlight = useRef('');

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    inFlight.current = q;
    const t = setTimeout(async () => {
      setSearching(true);
      /* ⛔⛔ A POSITIVE TYPE FILTER. This shipped as `.neq(punter)`, which let
         venues, hosts and festivals into a list headed ADD ARTIST — the owner
         was offered Bellingen Shire Council and the Memorial Hall as acts. See
         BOOKABLE_ACT_TYPES: an exclusion list admits every future type by
         default. */
      const { data } = await supabase
        .from('profiles')
        .select('id, user_id, name, type, avatar, avatar_thumb, sound, genre_string, location, state')
        .ilike('name', `%${q}%`)
        .in('type', BOOKABLE_ACT_TYPES)
        .limit(20);
      /* ⚠ A STALE RESPONSE MUST NOT OVERWRITE A NEWER ONE. Two keystrokes in
         flight can land out of order, which shows results for a query the host
         has already moved past. */
      if (inFlight.current !== q) return;
      setResults(data || []);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', zIndex: 2000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 'var(--yp-safe-bottom)' }}
      onClick={onClose}>
      <div style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, maxHeight: '76vh', display: 'flex', flexDirection: 'column', boxShadow: '0 -4px 40px rgba(0,0,0,.6)', border: '1px solid rgba(255,255,255,.07)', borderBottom: 'none' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 2 }}>ADD ARTIST</div>
            {/* ⚠ Says what this does NOT do. "Add" next to a lineup reads as
                booking, and this books nobody. */}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>
              They go on your shortlist. Nobody is notified, and they are not on the bill until you add them to the lineup.
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 24, cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        <div style={{ padding: '12px 20px 0', flexShrink: 0 }}>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search artists…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '11px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card2)', color: 'var(--text)', fontSize: 14, outline: 'none' }}
          />
          {error && (
            /* ⚠ SURFACED HERE, beside the control that caused it. A refusal
               that appears somewhere else reads as the button doing nothing. */
            <div role="alert" style={{ marginTop: 10, fontSize: 12.5, color: '#FF2D78', lineHeight: 1.5 }}>{error}</div>
          )}
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 20px 32px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {query.trim().length < 2 && (
            <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12.5, padding: '20px 0' }}>Type at least two letters.</p>
          )}
          {query.trim().length >= 2 && !searching && results.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12.5, padding: '20px 0' }}>Nobody by that name.</p>
          )}
          {results.map(p => {
            const pt = profileIdentity(String(p.type || '').toLowerCase());
            /* ⭐ THE ANSWER IS GIVEN BEFORE THE PRESS, not after. Showing
               "already on the lineup" as a disabled row is kinder than letting
               someone tap and reading a refusal — and it is the same guard the
               planner enforces, so the two cannot disagree. */
            const already = findArtistOnEvent(p, members);
            const img = p.avatar_thumb || p.avatar || pt.defaultImage;
            return (
              <button key={p.id} disabled={!!already || busy}
                onClick={() => onPick(p)}
                style={{ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', padding: '9px 11px', borderRadius: 10, cursor: already || busy ? 'default' : 'pointer', border: '1px solid var(--border)', background: already ? 'rgba(255,255,255,.02)' : 'var(--card2)', opacity: already ? .55 : 1 }}>
                {img && <img src={img} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', border: `2px solid ${pt.muted}`, flexShrink: 0 }} />}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: .8, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {[pt.shortLabel, p.location].filter(Boolean).join('  ·  ')}
                  </span>
                </span>
                <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10.5, letterSpacing: 1.2, color: already ? 'var(--muted)' : '#00E5A0', flexShrink: 0 }}>
                  {already ? (already.status === 'on_bill' ? 'ON LINEUP' : already.status === 'shortlisted' ? 'SHORTLISTED' : 'REMOVED') : '+ ADD'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
