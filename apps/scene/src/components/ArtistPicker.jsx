import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import MessengerAvatar from './MessengerAvatar';
import { profileIdentity } from '../lib/profileTypes';

/**
 * WHO ELSE IS ON THE BILL — type a name, see the acts who match.
 *
 * ⭐ A SIBLING OF `VenuePicker`, NOT A PARAMETER ON IT. Same interaction —
 * type, match the catalogue, or keep what you typed — but a different SUBJECT,
 * and the consumer-identity rule says a new subject is a new component rather
 * than a `type` prop teaching one picker about two worlds. The 250ms beat and
 * the two-character floor are copied deliberately so the controls in one form
 * feel like one thing.
 *
 * ── ⚠ IT RESOLVES TO A NAME, AND ONLY A NAME ─────────────────────────
 *
 * Picking a result fills the text. Nothing about the match is stored (owner,
 * 2026-08-14: a profile id was proposed and declined). The search exists so
 * the promoter can find the act and spell it the way the act spells it, and
 * so they can see they mean THIS Flowidus — the cards do that work at the
 * moment of choosing.
 *
 * ⛔ DO NOT resolve the stored name back to a profile at read time to "restore"
 * the link. Names collide and acts rename, so that card would eventually point
 * at the wrong person and nothing would reveal it. If a real reference is ever
 * wanted, it is a stored id written at THIS moment, by the person who knows
 * which act they meant.
 *
 * ⛔ NOT THE LINEUP. This is a pitch detail on an offer, saying who else is
 * playing; `lineup_members` is the booked bill. Nothing typed here may be read
 * as the named act having agreed to anything.
 *
 * @param value     the typed name
 * @param onChange  (name) — called on every keystroke and on picking a result
 */
export default function ArtistPicker({ value = '', onChange, placeholder, style }) {
  const [results, setResults] = useState([]);
  // Suppresses the dropdown right after a pick, so choosing a name does not
  // immediately re-search for that same name and reopen the list underneath.
  const [dismissed, setDismissed] = useState(false);
  const inFlight = useRef('');

  useEffect(() => {
    const q = (value || '').trim();
    if (dismissed || q.length < 2) { setResults([]); return undefined; }
    inFlight.current = q;
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabase.from('profiles')
        .select('id, name, type, avatar_thumb, avatar, suburb, location')
        // ⛔ THE PRIVACY BOUNDARY, the same one MessengerSearch states: a name
        // never finds a stranger's personal profile. Performer types only —
        // they are published to be found, and they are the only ones that can
        // be on a bill.
        .in('type', ['artist', 'band', 'standup'])
        .ilike('name', `%${q}%`)
        .order('name')
        .limit(8);
      if (cancelled || inFlight.current !== q) return;
      setResults(data || []);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [value, dismissed]);

  return (
    <div style={{ position: 'relative', ...style }}>
      <input
        type="text"
        value={value}
        onChange={(e) => { setDismissed(false); onChange?.(e.target.value); }}
        placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.05)',
          border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '11px 12px',
          color: '#fff', fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: 'none',
        }}
      />

      {results.length > 0 && (
        <div style={{
          marginTop: 6, background: '#13131f', border: '1px solid rgba(255,255,255,.12)',
          borderRadius: 10, overflow: 'hidden',
        }}>
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange?.(p.name); setDismissed(true); setResults([]); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                padding: '8px 10px', background: 'none', border: 'none', cursor: 'pointer', color: '#fff',
              }}
            >
              <MessengerAvatar src={p.avatar_thumb || p.avatar} size={28} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span style={{ display: 'block', fontSize: 10.5, color: 'rgba(255,255,255,.45)', letterSpacing: 0.4 }}>
                  {[profileIdentity(p.type)?.shortLabel, p.suburb || p.location].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
