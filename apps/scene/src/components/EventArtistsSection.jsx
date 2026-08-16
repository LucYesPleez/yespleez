import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import MessengerAvatar from './MessengerAvatar';
import { profileIdentity } from '../lib/profileTypes';
import { genreLabels } from '../lib/profileTaxonomy';
import {
  BOOKABLE_ACT_TYPES, planAddArtistToShortlist, addArtistToShortlist,
} from '../lib/shortlistFromArtist';
/* ⛔ TAKING SOMEBODY OFF IS A RULE, and the rules live there. ⚠ This component
   must not compose its own delete: removal is SOFT, it destroys performances,
   and it notifies only what was actually sent. */
import { planRemoveFromEvent, executeLineupPlan } from '../lib/lineupActions';
import { writeNotification } from '../lib/writeNotification';
import { resolvePerformerProfileId } from '../lib/actingProfile';

/**
 * THE EVENT EDITOR'S ARTISTS SECTION — the third entry into the shortlist.
 *
 * ⭐⭐ WHY IT EXISTS. The funnel has two ways in, and until now only the two
 * HOST surfaces (the dashboard and the event page) offered the direct one. The
 * person BUILDING the event could not put an artist on it at all, so an
 * organiser assembling a bill had to save the event, leave the editor, and go
 * find the same act on another screen. See `lib/shortlistFromArtist`.
 *
 * ⛔⛔ IT ADDS TO THE SHORTLIST, ⛔ NEVER STRAIGHT TO THE BILL. The ratified
 * model is `direct artist → SHORTLIST`, and the editor is the surface FURTHEST
 * from the booking decision: someone sketching an event is considering people,
 * not confirming them. Promoting to the bill stays where the bill is managed.
 *
 * ⛔ IT HOLDS NO RULES. Duplicate detection, who counts as a bookable act, and
 * the shape of the row are all in `lib/shortlistFromArtist` — this component
 * searches, calls the planner, and reports what it says. A fourth caller must
 * not have to remember any of it either.
 *
 * ⛔ NOT `ArtistPicker`. That control resolves to a NAME and deliberately
 * stores no profile id (owner, 2026-08-14) because it labels who else is on a
 * pitch. This one must produce a REAL reference, so it is a sibling rather than
 * a flag on that one. Its 250ms beat and two-character floor are copied on
 * purpose so the two feel like one app.
 *
 * @param eventId  the event being edited. ⛔ The editor renders this only when
 *                 the event already exists; there is nothing to attach a member
 *                 to before that.
 */
export default function EventArtistsSection({ eventId }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [members, setMembers] = useState([]);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const [loaded, setLoaded]   = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null); // { member, perfs }
  const inFlight = useRef('');
  const queryClient = useQueryClient();

  /**
   * ⚠⚠ EVERY STATUS, INCLUDING `removed`. This list is what the duplicate
   * guard is checked against, and `findArtistOnEvent` treats a removed row as
   * a match on purpose: `lineup_members` has NO uniqueness constraint, so
   * filtering the fetch would quietly re-enable the double-insert that put
   * eight junk rows into production on 2026-08-15.
   */
  const loadMembers = useCallback(async () => {
    if (!eventId) return;
    const { data, error: err } = await supabase.from('lineup_members')
      .select('id, artist_id, artist_profile_id, artist_name, sound, status')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });
    if (err) { setError(err.message); setLoaded(true); return; }
    setMembers(data || []);
    setLoaded(true);
  }, [eventId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return undefined; }
    inFlight.current = q;
    let cancelled = false;
    const t = setTimeout(async () => {
      /* ⛔⛔ A POSITIVE LIST, from the module that defines it. The shortlist
         search once excluded only `punter`, so venues, hosts and festivals were
         offered as bookable acts. ⛔ Do not restate the types here. */
      const { data } = await supabase.from('profiles')
        .select('id, user_id, name, type, avatar, avatar_thumb, sound, genre_string, location, suburb')
        .in('type', BOOKABLE_ACT_TYPES)
        .ilike('name', `%${q}%`)
        .order('name')
        .limit(8);
      if (cancelled || inFlight.current !== q) return;
      setResults(data || []);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  async function add(profile) {
    if (busy) return;
    setBusy(true);
    setError('');
    const plan = planAddArtistToShortlist(profile, eventId, members);
    if (!plan.ok) { setError(plan.reason); setBusy(false); return; }
    const { ok, error: err } = await addArtistToShortlist(supabase, plan);
    setBusy(false);
    /* ⚠ SURFACED, NEVER SWALLOWED. An INSERT blocked by RLS fails loudly, and
       showing it is what makes a policy regression look like a policy
       regression rather than a button that does nothing. */
    if (!ok) { setError(err || 'Could not add them.'); return; }
    setQuery('');
    setResults([]);
    await loadMembers();
    /**
     * ⚠⚠ THE EVENT PAGE CACHES ITS OWN COPY, AND THIS SCREEN IS NOT IT.
     *
     * Observed 2026-08-16: an artist added here did not appear in the event
     * page's SHORTLIST until a full reload — the tab read "Nobody on the
     * shortlist yet" while the row existed in the database. ⛔ That looks
     * exactly like the filter-trap bug this funnel was built to avoid, which
     * is the real cost: a stale cache and a broken read are indistinguishable
     * from the outside.
     *
     * ⭐ `EventHostView` already invalidates after its own add. Two writers
     * into one cached view means both must, ⛔ or the one that forgets makes
     * the other look broken.
     */
    queryClient.invalidateQueries({ queryKey: ['event', eventId] });
  }

  /**
   * ── TAKING SOMEBODY OFF THE EVENT ───────────────────────────────────────
   *
   * ⛔⛔ NOT A DELETE. `planRemoveFromEvent` writes `status = 'removed'` and
   * destroys the performances; the member row survives so the history does and
   * so the duplicate guard above still sees them.
   *
   * ⚠⚠ THE PERFORMANCES MUST BE FETCHED FIRST. Passing `[]` would leave
   * `deletePerformanceIds` empty, and a set time hanging off a removed member
   * is invisible to every read while still holding its slot in the unique index
   * on (slot_uuid, lineup_member_id) — so re-adding them to that slot later
   * would fail for no reason a host could see.
   */
  async function beginRemove(m) {
    setError('');
    const { data: perfs, error: perr } = await supabase.from('performances')
      .select('id, status, slot_uuid').eq('lineup_member_id', m.id);
    if (perr) { setError(perr.message); return; }
    const plan = planRemoveFromEvent(m, perfs || []);
    /**
     * ⭐ STATE-AWARE, ⛔ not a blanket "are you sure?". Most rows here are
     * SHORTLISTED: nobody was told, nothing was booked, and a dialog on that is
     * the kind that trains people to click through the one that matters.
     * ⚠ `notifyCount` is the honest test — it is non-zero only where a set time
     * was actually SENT, which is exactly when removal costs somebody something.
     */
    if (plan.notifyCount > 0) { setConfirmRemove({ member: m, perfs: perfs || [] }); return; }
    await doRemove(m, perfs || []);
  }

  async function doRemove(m, perfs) {
    setBusy(true);
    /* ⚠ The event's name and owner are for the NOTIFICATION, not for display —
       fetched here rather than held in state because this is the only path that
       needs them, and only when somebody is actually being told. */
    const { data: ev } = await supabase.from('events')
      .select('id, name, owner_profile_id').eq('id', eventId).maybeSingle();
    const { ok, error: err } = await executeLineupPlan(supabase, planRemoveFromEvent(m, perfs), {
      member: m,
      perfs,
      event: ev || { id: eventId },
      notify: writeNotification,
      resolveProfileId: resolvePerformerProfileId,
    });
    setBusy(false);
    setConfirmRemove(null);
    if (!ok) { setError(err || 'Could not remove them.'); return; }
    await loadMembers();
    /* ⚠ Same reason as the add path: the event page caches its own copy, and a
       stale read is indistinguishable from a broken one. */
    queryClient.invalidateQueries({ queryKey: ['event', eventId] });
  }

  /* ⛔ `removed` rows are counted by the guard but not DRAWN — they are not on
     this event, and listing them would read as a bill that includes people the
     organiser took off. */
  const visible = members.filter(m => m.status !== 'removed');

  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '0 0 10px' }}>
        Add acts you are considering. They go to your shortlist, so nobody is
        told and nothing is booked yet.
      </p>

      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search artists, bands, comedians…"
        style={{
          width: '100%', padding: '10px 12px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)',
          color: 'var(--text)', fontSize: 13,
        }}
      />

      {error && (
        <p style={{ fontSize: 12, color: 'var(--danger, #ff6b6b)', margin: '8px 0 0' }}>{error}</p>
      )}

      {results.length > 0 && (
        <div style={{ marginTop: 8, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {results.map(p => {
            const pt  = profileIdentity(String(p.type || '').toLowerCase());
            /* ⛔ `genreLabels`, ⛔ never the raw column — role keys live in it. */
            const sub = p.sound || genreLabels(p.genre_string).slice(0, 3).join(' · ');
            return (
              <button key={p.id} type="button" disabled={busy} onClick={() => add(p)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '9px 11px', background: 'none', border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,.06)',
                  color: 'var(--text)', cursor: busy ? 'default' : 'pointer', textAlign: 'left',
                }}>
                <MessengerAvatar profile={p} size={30} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13 }}>{p.name}</span>
                  {sub && (
                    <span style={{ display: 'block', fontSize: 11, color: pt.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sub}
                    </span>
                  )}
                </span>
                <span style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: 'var(--muted)' }}>
                  + SHORTLIST
                </span>
              </button>
            );
          })}
        </div>
      )}

      {loaded && visible.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {visible.map(m => (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
              borderBottom: '1px solid rgba(255,255,255,.06)',
            }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                {m.artist_name || 'Unnamed act'}
              </span>
              {/* ⚠ The two words the funnel uses, ⛔ not new ones. */}
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10.5, letterSpacing: 1.3, color: 'var(--muted)' }}>
                {m.status === 'on_bill' ? 'ON THE BILL' : 'SHORTLISTED'}
              </span>
              {/**
                * ⚠ TAKE THEM OFF THE EVENT. ⛔ Deliberately quiet: it is muted
                * until hovered, because the row's job is to show who is
                * attached and removal is the rarer act. ⛔ An X as loud as the
                * status beside it would make the list read as a delete queue.
                *
                * ⚠ 28px of target on a 13px glyph — the same reasoning as the
                * heart on the slot card.
                */}
              <button
                type="button"
                disabled={busy}
                onClick={() => beginRemove(m)}
                title={`Take ${m.artist_name || 'this act'} off the event`}
                aria-label={`Take ${m.artist_name || 'this act'} off the event`}
                style={{
                  width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, marginRight: -6, border: 'none', background: 'none', padding: 0,
                  color: 'rgba(255,255,255,.35)', cursor: busy ? 'default' : 'pointer', transition: 'color .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#FF2D78'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,.35)'; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
          {/**
            * ⭐ THE DIALOG APPEARS ONLY WHERE SOMETHING WAS SENT — see
            * `beginRemove`. ⚠ It names the COST rather than asking "are you
            * sure": the host is not being asked to confirm a click, they are
            * being told what the artist will hear.
            */}
          {confirmRemove && (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,45,120,.4)', background: 'rgba(255,45,120,.08)' }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text)' }}>
                {confirmRemove.member.artist_name || 'This act'} has a set time they were told about.
                Taking them off the event removes it and lets them know.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" disabled={busy} onClick={() => setConfirmRemove(null)}
                  style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.05)', fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2, color: 'var(--muted)', cursor: 'pointer' }}>
                  CANCEL
                </button>
                <button type="button" disabled={busy} onClick={() => doRemove(confirmRemove.member, confirmRemove.perfs)}
                  style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: '1px solid rgba(255,45,120,.5)', background: 'rgba(255,45,120,.12)', fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.2, color: '#FF2D78', cursor: 'pointer' }}>
                  TAKE THEM OFF
                </button>
              </div>
            </div>
          )}
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0 0' }}>
            Manage the bill and set times from the event page.
          </p>
        </div>
      )}

      {loaded && visible.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>
          Nobody attached to this event yet.
        </p>
      )}
    </div>
  );
}
