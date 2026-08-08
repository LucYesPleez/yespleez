// CO-HOSTS — additional profiles billed alongside the event's owner.
//
// ⚠ ATTRIBUTION, NOT AUTHORIZATION (owner, 2026-08-04: "have one main host,
// then the other looks like they have equal representation, but only the main
// host can edit"). A co-host gets an equal-sized card in § 10 and nothing
// else: no edit rights, no applications, no notifications. That is enforced by
// `event_hosts`'s policies — INSERT and DELETE are gated on
// `is_event_main_host(event_id)`, and there is no UPDATE grant at all — so the
// rule holds even if some future caller forgets it. This component only has to
// be honest about it, not to police it.
//
// ⚠ THE OWNER IS NOT OFFERED AS A CO-HOST. Billing the main host twice would
// draw the same card twice in § 10; the view model drops such a row anyway,
// but offering it here would let someone save something that then silently
// does nothing, which is worse than not offering it.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PROFILE_TYPES } from '../lib/profileTypes';

/**
 * @param eventId    existing event, or null while one is being created
 * @param ownerId    the main host's profile id — excluded from results
 * @param value      profile rows already chosen (create mode buffers these)
 * @param onChange   (rows) => void
 */
export default function CoHostPicker({ eventId = null, ownerId = null, value = [], onChange }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  // The query that produced `results`. Without it a slow response can land
  // after a newer keystroke and repopulate the list with stale matches.
  const inFlight = useRef('');

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return undefined; }
    inFlight.current = q;
    let cancelled = false;
    // 250ms: long enough that typing a name is one request rather than eight,
    // short enough that the list feels attached to the keyboard.
    const t = setTimeout(async () => {
      const { data } = await supabase.from('profiles')
        .select('id, name, type, avatar_thumb, avatar, location, state')
        // Hosts and venues only. An artist on the bill is a LINEUP member —
        // billing them as a presenter would say they put the night on.
        .in('type', ['host', 'venue'])
        .ilike('name', `%${q}%`)
        .limit(8);
      if (cancelled || inFlight.current !== q) return;
      const taken = new Set([ownerId, ...value.map(v => v.id)].filter(Boolean));
      setResults((data || []).filter(p => !taken.has(p.id)));
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, ownerId, value]);

  const add = async (p) => {
    setError('');
    // Optimistic locally, but for a SAVED event the row is written now: an
    // editor that queued this until save would lose it if the tab closed, and
    // the write is the whole point of the control.
    if (eventId) {
      setBusy(true);
      const { error: err } = await supabase.from('event_hosts')
        .insert({ event_id: eventId, profile_id: p.id, position: value.length });
      setBusy(false);
      if (err) {
        // ⚠ SURFACED, NOT SWALLOWED. The insert is behind an RLS policy that
        // only the main host satisfies, so a failure here is meaningful —
        // "you are not this event's host" — and a silently absent chip would
        // read as the app being broken.
        setError(err.message || 'Could not add that co-host.');
        return;
      }
    }
    onChange?.([...value, p]);
    setQuery('');
    setResults([]);
  };

  const remove = async (p) => {
    setError('');
    if (eventId) {
      setBusy(true);
      const { error: err } = await supabase.from('event_hosts')
        .delete().eq('event_id', eventId).eq('profile_id', p.id);
      setBusy(false);
      if (err) { setError(err.message || 'Could not remove that co-host.'); return; }
    }
    onChange?.(value.filter(v => v.id !== p.id));
  };

  return (
    <div style={{ marginBottom: 14 }}>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {value.map(p => (
            <span key={p.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--card2)',
              fontSize: 12, color: 'var(--text)',
            }}>
              {p.name} · {PROFILE_TYPES[p.type]?.shortLabel || p.type}
              <button type="button" onClick={() => remove(p)} disabled={busy}
                aria-label={`Remove ${p.name} as a co-host`}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 15 }}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search a host or venue to co-host…"
        style={{
          width: '100%', padding: '10px 12px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--card2)',
          color: 'var(--text)', fontSize: 13,
        }}
      />

      {/* R1 · no matches is not the same as not having searched, so the empty
          note only appears once a real query has been made. */}
      {query.trim().length >= 2 && !results.length && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
          No host or venue profiles match that.
        </div>
      )}

      {results.length > 0 && (
        <div style={{ marginTop: 6, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {results.map(p => (
            <button key={p.id} type="button" onClick={() => add(p)} disabled={busy}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '9px 12px', background: 'none', border: 'none',
                borderBottom: '1px solid var(--border)', cursor: 'pointer',
                color: 'var(--text)', fontSize: 13, textAlign: 'left',
              }}>
              <span style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                {PROFILE_TYPES[p.type]?.shortLabel || p.type}
              </span>
            </button>
          ))}
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: 'var(--neon)', marginTop: 6 }}>{error}</div>}
    </div>
  );
}
