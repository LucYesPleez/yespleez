/**
 * SHORTLIST THIS ARTIST TO ONE OF YOUR EVENTS — from wherever you found them.
 *
 * ⭐⭐ THE MIRROR OF `ShortlistArtistSheet`. That one starts from an EVENT and
 * asks which artist; this starts from an ARTIST and asks which event. Same
 * write, same planner, same guard — ⛔ the rules are not restated here.
 *
 * ⚠ Discover is where a host actually meets artists, and until now the
 * shortlist only existed once you were already inside an event. This is the
 * bridge, and it is why the model's "direct artist" entry point stops being
 * theoretical.
 */
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ownedByFilter } from '../lib/eventOwnership';
import { planAddArtistToShortlist, addArtistToShortlist, findArtistOnEvent } from '../lib/shortlistFromArtist';
import { eventBucket, ARCHIVE } from '../lib/eventBuckets';

export default function ShortlistToEventSheet({ artist, userId, hostProfileId, onClose }) {
  const [rows, setRows]   = useState(null);   // null = loading
  const [busyId, setBusyId] = useState(null);
  const [errorId, setErrorId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [doneIds, setDoneIds] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const filter = ownedByFilter(userId, hostProfileId);
      /* ⛔ NO FILTER MEANS NO EVENTS, ⛔ not every event. An empty `.or()` string
         is not a no-op in PostgREST — guarding here is the difference between
         "you host nothing" and handing somebody the whole table. */
      if (!filter) { if (!cancelled) setRows([]); return; }
      const { data: evs } = await supabase
        .from('events').select('id, name, status, config').or(filter);
      /* ⚠ ARCHIVE IS EXCLUDED. Shortlisting somebody for a night that has
         already happened is not a thing, and the bucket rule is shared with the
         dashboard so the two cannot disagree about what "past" means. */
      const live = (evs || []).filter(e => eventBucket(e) !== ARCHIVE);
      const ids = live.map(e => e.id);
      /* ⚠ EVERY STATUS, because the guard counts `removed` too — see
         findArtistOnEvent. A per-event answer needs the per-event rows. */
      const { data: mem } = ids.length
        ? await supabase.from('lineup_members')
            .select('id, event_id, artist_id, artist_profile_id, status').in('event_id', ids)
        : { data: [] };
      if (cancelled) return;
      setRows(live.map(e => ({
        event: e,
        existing: findArtistOnEvent(artist, (mem || []).filter(m => m.event_id === e.id)),
      })));
    })();
    return () => { cancelled = true; };
  }, [artist?.id, userId, hostProfileId]);

  async function add(row) {
    if (busyId) return;
    setBusyId(row.event.id); setErrorId(null); setErrorMsg('');
    const { data: mem } = await supabase.from('lineup_members')
      .select('id, event_id, artist_id, artist_profile_id, status').eq('event_id', row.event.id);
    /* ⚠ RE-CHECKED AT WRITE TIME against freshly read rows, not against the
       list this sheet loaded. The sheet may have been open for a while, and
       `lineup_members` has no uniqueness constraint to catch a stale decision. */
    const plan = planAddArtistToShortlist(artist, row.event.id, mem || []);
    if (!plan.ok) { setBusyId(null); setErrorId(row.event.id); setErrorMsg(plan.reason); return; }
    const { ok, error } = await addArtistToShortlist(supabase, plan);
    setBusyId(null);
    if (!ok) { setErrorId(row.event.id); setErrorMsg(error || 'Could not add them.'); return; }
    setDoneIds(prev => [...prev, row.event.id]);
  }

  const name = artist?.name || 'this artist';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', zIndex: 2200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 'var(--yp-safe-bottom)' }}
      onClick={onClose}>
      <div style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, maxHeight: '74vh', display: 'flex', flexDirection: 'column', boxShadow: '0 -4px 40px rgba(0,0,0,.6)', border: '1px solid rgba(255,255,255,.07)', borderBottom: 'none' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 2 }}>SHORTLIST {String(name).toUpperCase()}</div>
            {/* ⚠ Says what this does NOT do, in the place somebody would
                otherwise assume it books them. */}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>
              Pick an event. Nobody is notified, and they are not on the bill until you add them to the lineup.
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 24, cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 20px 32px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows === null && <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12.5, padding: '20px 0' }}>Loading your events…</p>}
          {rows?.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12.5, padding: '20px 0', lineHeight: 1.6 }}>
              You are not hosting any upcoming events. Create one first, then you can shortlist artists for it.
            </p>
          )}
          {(rows || []).map(row => {
            const done = doneIds.includes(row.event.id);
            const state = done ? 'shortlisted' : row.existing?.status;
            const label = state === 'on_bill' ? 'ON LINEUP'
              : state === 'shortlisted' ? 'SHORTLISTED'
                : state === 'removed' ? 'REMOVED BEFORE'
                  : busyId === row.event.id ? 'ADDING…' : '+ SHORTLIST';
            const blocked = !!state || busyId === row.event.id;
            return (
              <div key={row.event.id}>
                <button disabled={blocked} onClick={() => add(row)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '11px 13px', borderRadius: 10, cursor: blocked ? 'default' : 'pointer', border: `1px solid ${done ? 'rgba(0,229,160,.4)' : 'var(--border)'}`, background: state ? 'rgba(255,255,255,.02)' : 'var(--card2)', opacity: state && !done ? .55 : 1 }}>
                  <span style={{ flex: 1, minWidth: 0, fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: .8, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.event.name || 'Untitled event'}
                  </span>
                  <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10.5, letterSpacing: 1.2, flexShrink: 0, color: done ? '#00E5A0' : state ? 'var(--muted)' : 'var(--neon2)' }}>
                    {done ? '✓ SHORTLISTED' : label}
                  </span>
                </button>
                {errorId === row.event.id && (
                  <div role="alert" style={{ fontSize: 12, color: '#FF2D78', padding: '6px 4px 0', lineHeight: 1.5 }}>{errorMsg}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
