import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { suggestClaimable, MIN_QUERY } from '../lib/claimSuggest';

/**
 * "IS THIS YOU?" — shown while somebody types their own name into a profile
 * editor, when an unclaimed profile of the same kind already answers to it.
 *
 * ⭐⭐ THE MOMENT IS THE POINT. Most of this catalogue was imported, so a
 * promoter signing up usually already exists here — with their gigs, their
 * history and the audience that follows them attached to a row they do not
 * own. The only cheap moment to say so is while they are typing the name;
 * afterwards they have a finished second profile and the scene has two of
 * them, split down the middle.
 *
 * ⛔ IT SUGGESTS, IT NEVER CLAIMS. Tapping goes to that profile, where §07's
 * manual-review flow already lives behind "Is this you? Claim this profile".
 * A second claim path would be a second set of rules about who owns what.
 *
 * ⛔ IT NEVER BLOCKS. The form underneath stays live and savable throughout.
 * Someone genuinely starting a new promoter called Freedom Machine is allowed
 * to do exactly that, and a modal in their way would be the tool insisting it
 * knows better.
 */
export default function ClaimSuggestion({ name, type, excludeId = null }) {
  const navigate = useNavigate();
  const [matches, setMatches] = useState([]);
  /* Dismissal is per NAME, not per mount: clearing the field and typing a
     different name is a different question and deserves to be asked again. */
  const [dismissed, setDismissed] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    const term = String(name || '').trim();
    if (term.length < MIN_QUERY || !type) { setMatches([]); return undefined; }

    /* ⚠ DEBOUNCED, AND THE RESULT IS SEQUENCED. Typing "Freedom Machine" fires
       several queries and they can land out of order; without the guard a slow
       answer for "Free" could overwrite the right answer for the full name. */
    const mine = ++seq.current;
    const t = setTimeout(() => {
      suggestClaimable({ typed: term, type, excludeId }).then(rows => {
        if (mine === seq.current) setMatches(rows);
      });
    }, 350);
    return () => clearTimeout(t);
  }, [name, type, excludeId]);

  if (!matches.length) return null;
  if (dismissed && dismissed === String(name || '').trim()) return null;

  return (
    <div style={{
      marginTop: 8, padding: '10px 12px', borderRadius: 12,
      background: 'rgba(255,184,48,.07)', border: '1px solid rgba(255,184,48,.28)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text)' }}>
          {matches.length === 1
            ? 'This one is already here, waiting to be claimed.'
            : 'These are already here, waiting to be claimed.'}
        </div>
        {/* Dismissible because it can be wrong, and an assist you cannot put
            down becomes an obstacle. ⛔ Not the same as the attention
            dashboard, which must never be dismissible — that reports facts
            about YOUR events; this offers a guess about your identity. */}
        <button type="button"
          onClick={() => setDismissed(String(name || '').trim())}
          style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 11.5, cursor: 'pointer', padding: 0, flexShrink: 0 }}>
          Not mine
        </button>
      </div>

      {matches.map(m => (
        <button key={m.id} type="button"
          onClick={() => navigate(`/profile/${m.id}`)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            marginTop: 8, padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)',
            color: 'var(--text)', textAlign: 'left', fontFamily: 'inherit',
          }}>
          {m.avatar_thumb || m.avatar
            ? <img src={m.avatar_thumb || m.avatar} alt="" style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
            : <span style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(255,255,255,.08)', flexShrink: 0 }} />}
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.name}
            </span>
            {(m.suburb || m.location) && (
              <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{m.suburb || m.location}</span>
            )}
          </span>
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, letterSpacing: 1, color: 'var(--gold, #FFB830)', flexShrink: 0 }}>
            IS THIS YOU?
          </span>
        </button>
      ))}
    </div>
  );
}
