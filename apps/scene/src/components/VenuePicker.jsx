// THE VENUE — chosen from the list of real rooms, not typed into a box.
//
// ⚠ WHY THIS EXISTS. The venue used to be a free-text input, and
// `venue_profile_id` was only ever filled when the event's OWNER was itself a
// venue (see CreateEventScreen's M14c note, which says in as many words that
// resolving it properly "needs a venue picker"). So a promoter putting a night
// on at someone else's room typed the name and the event linked to nothing.
//
// That is not cosmetic. Without the link the event:
//   · never appears on the venue's own profile among its gigs
//   · has no coordinates, so no map, no directions, and it is invisible to
//     every distance/radius filter — `events.lat/lng` are empty on every row
//     and the venue profile is the only place coordinates live
//
// It also produced the duplicate that prompted this: a host typed
// "The Bellingen brewing co" AND added the brewery through the co-host picker,
// so one business drew two cards — an unlinked name with a placeholder image,
// beside its real profile. The view model has a guard for exactly that
// ("A VENUE THAT RUNS ITS OWN NIGHT IS ONE ENTITY, NOT TWO") but it compares
// `venue_profile_id`, so a NULL link disables the one check meant to stop it.
//
// ⛔ THERE IS NO "CREATE THIS VENUE" BUTTON, AND THAT IS DELIBERATE.
// `profiles`' INSERT policy is `WITH CHECK (auth.uid() = user_id)`: an
// authenticated user may only create profiles they own, so nobody can mint an
// unclaimed profile for someone else's room from here. Even setting RLS aside,
// UNIQUE (user_id, type) means an account can hold exactly one venue profile.
// A "create new venue" affordance would therefore either fail, or — if the
// policy were loosened — become the fastest way to fill the table with the
// duplicate venues this control exists to prevent. So the no-match branch
// CONFIRMS rather than creates, and says plainly what going without costs.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * @param value             the venue NAME as it will be stored in config.venue
 * @param onChange          (name) => void
 * @param profileId         the linked venue profile id, or null
 * @param onProfileIdChange (id | null) => void
 */
export default function VenuePicker({ value = '', onChange, profileId = null, onProfileIdChange }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [linked, setLinked]   = useState(null);   // the chosen profile row
  /* Set once the organiser has answered "are you sure this room has no
     profile?" — so the warning stops nagging after they have decided, without
     the app pretending the link exists. */
  const [unlistedOk, setUnlistedOk] = useState(false);
  // The query that produced `results`; without it a slow response can land
  // after a newer keystroke and repopulate the list with stale matches.
  const inFlight = useRef('');

  // An event being EDITED arrives with an id and no row — fetch the name so the
  // control opens showing what is actually linked rather than an empty box.
  useEffect(() => {
    if (!profileId || linked?.id === profileId) return;
    let cancelled = false;
    supabase.from('profiles').select('id, name, location, suburb, state, postcode')
      .eq('id', profileId).maybeSingle()
      .then(({ data }) => { if (!cancelled && data) setLinked(data); });
    return () => { cancelled = true; };
  }, [profileId, linked?.id]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return undefined; }
    inFlight.current = q;
    let cancelled = false;
    // 250ms — the same beat as CoHostPicker, so the two controls in this form
    // feel like one thing rather than two.
    const t = setTimeout(async () => {
      const { data } = await supabase.from('profiles')
        .select('id, name, location, suburb, state, postcode')
        .eq('type', 'venue')
        .ilike('name', `%${q}%`)
        .order('name')
        .limit(8);
      if (cancelled || inFlight.current !== q) return;
      setResults(data || []);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  function choose(p) {
    setLinked(p);
    setQuery('');
    setResults([]);
    setUnlistedOk(false);
    onChange?.(p.name);
    onProfileIdChange?.(p.id);
  }

  function clear() {
    setLinked(null);
    setUnlistedOk(false);
    onChange?.('');
    onProfileIdChange?.(null);
  }

  /* Keep the typed name, link nothing. The honest outcome when a room really
     has no profile — and the one the organiser has just confirmed. */
  function useUnlisted() {
    setUnlistedOk(true);
    onChange?.(query.trim());
    onProfileIdChange?.(null);
    setResults([]);
  }

  const where = p => [p.suburb || p.location, p.state].filter(Boolean).join(', ');

  // ── LINKED ─────────────────────────────────────────────────────────────
  if (profileId && linked) {
    return (
      <div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', borderRadius: 8,
          border: '1px solid var(--neon2)', background: 'rgba(0,229,255,.08)',
        }}>
          <span style={{ flex: 1, minWidth: 0, color: 'var(--text)', fontSize: 13 }}>
            {linked.name}
            {where(linked) && <span style={{ color: 'var(--muted)' }}> · {where(linked)}</span>}
          </span>
          <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: .8, color: 'var(--neon2)' }}>
            LINKED
          </span>
          <button type="button" onClick={clear} aria-label="Choose a different venue"
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 16 }}>
            ×
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
          This gig will show on {linked.name}&apos;s page, with their map and directions.
        </div>
      </div>
    );
  }

  // ── UNLISTED, and the organiser has said so ────────────────────────────
  if (unlistedOk && value) {
    return (
      <div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--card2)',
        }}>
          <span style={{ flex: 1, minWidth: 0, color: 'var(--text)', fontSize: 13 }}>{value}</span>
          <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: .8, color: 'var(--muted)' }}>
            NO PROFILE
          </span>
          <button type="button" onClick={clear} aria-label="Search for a venue instead"
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 16 }}>
            ×
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
          Saved as text. No map, and it won&apos;t appear on a venue&apos;s page.
        </div>
      </div>
    );
  }

  // ── SEARCHING ──────────────────────────────────────────────────────────
  const searched = query.trim().length >= 2;
  return (
    <div>
      <input
        className="yp-venue-search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search venues… e.g. The Bellingen Brewing Co"
        style={{
          width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--card2)',
          color: 'var(--text)', fontSize: 13, outline: 'none',
        }}
      />

      {results.length > 0 && (
        <div style={{ marginTop: 6, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {results.map(p => (
            <button key={p.id} type="button" onClick={() => choose(p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '9px 12px', background: 'none', border: 'none',
                borderBottom: '1px solid var(--border)', cursor: 'pointer',
                color: 'var(--text)', fontSize: 13, textAlign: 'left',
              }}>
              <span style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>{where(p)}</span>
            </button>
          ))}
        </div>
      )}

      {/* R1 · "no matches" is not the same as "hasn't searched", so this only
          appears once a real query has been made. */}
      {searched && results.length === 0 && (
        <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card2)' }}>
          <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 6 }}>
            Are you sure this venue doesn&apos;t have a profile?
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.5 }}>
            Try a shorter search — &ldquo;Brewing&rdquo; rather than &ldquo;The Bellingen Brewing Co&rdquo;.
            Picking the listed one keeps every gig at that room together.
          </div>
          <button type="button" onClick={useUnlisted}
            style={{
              fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1,
              padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid var(--border)', background: 'none', color: 'var(--text)',
            }}>
            Use &ldquo;{query.trim()}&rdquo; without a profile
          </button>
        </div>
      )}
    </div>
  );
}
