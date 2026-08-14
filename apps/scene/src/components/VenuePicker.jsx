// THE VENUE — chosen from the list of real rooms, and pinned to a town.
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
// ⭐ AND A NAME IS NOT AN ADDRESS. "The Coast Hotel" is several pubs in several
// states; without a town the record cannot say which, the reader cannot tell,
// and two different rooms with one name collapse into a single ambiguous
// string. The town is asked for HERE, next to the name, because that is the
// moment the answer is known.
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
import { suggestLocations, resolveLocationToPostcodes, STATE_OPTIONS } from '../lib/auLocations';
import { postcodeState, isKnownPostcode } from '../lib/geo';

const norm = s => String(s || '').trim().toLowerCase();

/**
 * @param value             the venue NAME as stored in config.venue
 * @param onChange          (name) => void
 * @param profileId         the linked venue profile id, or null
 * @param onProfileIdChange (id | null) => void
 * @param town              config.suburb — the town the room is in
 * @param onTownChange      (town, { state, postcode }) => void
 * @param stateCode         config.state
 * @param postcode          config.postcode — what the town map is keyed on
 */
export default function VenuePicker({
  value = '', onChange,
  profileId = null, onProfileIdChange,
  town = '', onTownChange, stateCode = '', postcode = '',
  venueRequest = false, onVenueRequestChange,
}) {
  const [results, setResults] = useState([]);
  const [linked, setLinked]   = useState(null);
  /**
   * ⭐⭐ TWO ANSWERS, AND THE FORM SAYS WHICH ONE YOU GAVE.
   *
   * An event either references a CANONICAL venue (`venue_profile_id`) or
   * carries an UNLISTED, event-only location (`config.venue` + town). Both are
   * legitimate — secret parties, private addresses, paddocks and rooms nobody
   * has made a profile for are real events, not bad data.
   *
   * ⛔ TYPING A NAME NEVER CREATES A VENUE, and could not: the app contains no
   * `profiles` insert at all, and that table's RLS is
   * `WITH CHECK (auth.uid() = user_id)`, so a host cannot mint a record for
   * someone else's room. The catalogue stays Studio-controlled. This mode only
   * makes the existing distinction VISIBLE, instead of leaving it to be
   * inferred from whether a dropdown happened to match.
   *
   * ⚠ DERIVED ON LOAD, NOT STORED. An event arriving with a name and no
   * `venue_profile_id` IS unlisted; that is what those two columns already
   * mean together, so there is nothing new to persist.
   */
  const [mode, setMode] = useState(() => {
    if (profileId)    return 'search';       // already a catalogue venue
    if (venueRequest) return 'create';       // a real room, awaiting Studio
    if (value)        return 'event-only';   // a name this event alone uses
    return 'search';
  });
  const pending   = !profileId && mode === 'create';
  const eventOnly = !profileId && mode === 'event-only';
  const named     = pending || eventOnly;

  /* CREATE and EVENT-ONLY store the SAME thing — a name on this event. They
     differ only in whether the organiser asked for it to become a catalogue
     venue, which is the one bit Studio reads. */
  function pick(next) {
    setMode(next);
    onVenueRequestChange?.(next === 'create');
    if (next === 'search') { onChange?.(''); onProfileIdChange?.(null); }
  }

  const [townQuery, setTownQuery]   = useState('');
  /* Towns that ALREADY have venues. Offered first, and labelled, because
     picking one is what keeps every gig in that town filed together — the
     whole reason this control exists. The AU list behind it is what lets a
     town nobody has used yet (Wollongong, until today) be entered correctly
     rather than approximately. */
  const [knownTowns, setKnownTowns] = useState([]);
  const inFlight = useRef('');

  useEffect(() => {
    let cancelled = false;
    // ⚠ `postcode` IS PART OF THE ANSWER, not decoration — without it the town
    // carries no centroid and the venue map never loads. Selecting the columns
    // the mapping below actually reads is the whole fix.
    supabase.from('profiles').select('suburb, location, state, postcode')
      .eq('type', 'venue')
      .then(({ data }) => {
        if (cancelled || !data) return;
        /* ⚠ THE POSTCODE COMES WITH THE TOWN. A town the platform already uses
           is not necessarily in the AU suburb list — "Thora" is not, yet
           Elbows Rest sits there on 2454 and 2454.png exists. Taking the
           postcode from the AU lookup alone left such a town with no postcode,
           so `geo.js` had no centroid and the venue map silently never
           appeared. The record we already hold is the better source. */
        const seen = new Map();
        data.forEach(p => {
          const t = (p.suburb || '').trim();
          if (t && !seen.has(norm(t))) {
            seen.set(norm(t), { name: t, state: p.state || '', postcode: p.postcode || '' });
          }
        });
        setKnownTowns([...seen.values()].sort((a, b) => a.name.localeCompare(b.name)));
      });
    return () => { cancelled = true; };
  }, []);

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
    // The field IS the query — what is typed is what gets stored, and the
    // matches are offered underneath it rather than in a separate search box.
    const q = String(value || '').trim();
    // ⛔ No searching while unlisted: the host has said this room is not in the
    // catalogue, so offering catalogue matches argues with their own answer.
    if (profileId || named || q.length < 2) { setResults([]); return undefined; }
    inFlight.current = q;
    let cancelled = false;
    // 250ms — the same beat as CoHostPicker, so the two controls in this form
    // feel like one thing rather than two.
    const t = setTimeout(async () => {
      const { data } = await supabase.from('profiles')
        .select('id, name, location, suburb, state, postcode')
        .eq('type', 'venue')
        .ilike('name', `%${q}%`)
        .limit(12);
      if (cancelled || inFlight.current !== q) return;
      /* ⚠ THE TOWN ORDERS, IT DOES NOT FILTER. Two rooms can share a name, and
         the town is how a reader tells them apart — but a venue whose suburb
         was recorded differently (or not at all) must not become invisible
         because of it. Same-town first, everything else still reachable. */
      const wanted = norm(town);
      const rows = (data || []).slice().sort((a, b) => {
        const am = wanted && norm(a.suburb) === wanted ? 0 : 1;
        const bm = wanted && norm(b.suburb) === wanted ? 0 : 1;
        return am - bm || String(a.name).localeCompare(String(b.name));
      });
      setResults(rows);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [value, profileId, named, town]);

  function setTown(name) {
    const codes = resolveLocationToPostcodes(name);
    const known = knownTowns.find(t => norm(t.name) === norm(name));
    // Our own record first, the AU list second. See the knownTowns loader.
    onTownChange?.(name, {
      state: known?.state || stateCode || '',
      postcode: known?.postcode || codes[0] || '',
    });
    // Clearing the query is what closes the list — there is no open/closed
    // flag to keep in step with it.
    setTownQuery('');
  }

  function choose(p) {
    setLinked(p);
    setMode('search');
    setResults([]);
    onChange?.(p.name);
    onProfileIdChange?.(p.id);
    // The room knows where it is; stop asking.
    if (p.suburb) onTownChange?.(p.suburb, { state: p.state || '', postcode: p.postcode || '' });
  }

  const where = p => [p.suburb || p.location, p.state].filter(Boolean).join(', ');

  /* Town suggestions: what the system already uses, then the AU list.
     ⚠ NOTHING UNTIL SOMETHING IS TYPED. This briefly listed every known town
     on focus, which put a permanent four-item menu under the field and read as
     the form's content rather than as a response to the reader. A typeahead
     answers; it does not sit there. */
  const tq = townQuery.trim();
  const townMatches = tq.length >= 1
    ? knownTowns.filter(t => norm(t.name).includes(norm(tq)))
    : [];
  const auMatches = tq.length >= 2
    ? suggestLocations(tq).filter(n => !townMatches.some(t => norm(t.name) === norm(n)))
    : [];

  const townField = (
    <div style={{ marginBottom: 12 }}>
      {/**
        * ⭐ ONE LINE, because it is ONE ANSWER: where the night is. Town, state
        * and postcode stacked read as three separate questions and invited
        * answering only the first, which is the state that costs the map and
        * every radius filter.
        *
        * ⚠ `alignItems: start` is load-bearing. The town's suggestion list is
        * in normal flow, so a stretched row would make state and postcode grow
        * as tall as the open dropdown.
        * ⚠ `minmax(0, 1fr)` likewise: a bare `1fr` refuses to shrink below its
        * content's min-width, and the town column would push the other two off
        * a 375px screen.
        */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px 96px',
        gap: 8, alignItems: 'start',
      }}>
      <div style={{ minWidth: 0 }}>
      <SubLabel>TOWN</SubLabel>
      {town ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 12px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--card2)',
        }}>
          {/* ⛔ THE TOWN, AND ONLY THE TOWN. This used to append " · NSW",
              which was right when the state had nowhere else to appear and is
              now the same value printed twice, side by side, in adjacent
              fields. Two copies of one fact invite the question of which is
              authoritative, and the STATE control is the one that can be
              edited. */}
          <span style={{ flex: 1, minWidth: 0, color: 'var(--text)', fontSize: 13,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {town}
          </span>
          {/* ⚠ CLEARS THE TOWN ONLY. It used to wipe state and postcode too,
              which was harmless while they were invisible and is now data loss:
              the postcode is its own field, it carries the map and every
              radius filter, and nobody changing a town name expects to lose
              it. Both are still editable directly below. */}
          <button type="button" onClick={() => onTownChange?.('', { state: stateCode, postcode })}
            aria-label="Change town"
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 16 }}>
            ×
          </button>
        </div>
      ) : (
        <>
          <input
            className="yp-venue-town"
            value={townQuery}
            onChange={e => setTownQuery(e.target.value)}
            /* Shortened with the column: "Search town..." truncated mid-word
               at 375px, and the TOWN label above already names the field. */
            placeholder="Search..."
            style={{
              width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--card2)',
              color: 'var(--text)', fontSize: 13, outline: 'none',
            }}
          />
          {(townMatches.length > 0 || auMatches.length > 0) && (
            <div style={{ marginTop: 6, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {townMatches.map(t => (
                <button key={`k-${t.name}`} type="button" onClick={() => setTown(t.name)}
                  style={rowStyle}>
                  <span style={{ flex: 1, minWidth: 0 }}>{t.name}</span>
                  <span style={{ color: 'var(--neon2)', fontSize: 10 }}>HAS VENUES</span>
                </button>
              ))}
              {auMatches.map(n => (
                <button key={`au-${n}`} type="button" onClick={() => setTown(n)} style={rowStyle}>
                  <span style={{ flex: 1, minWidth: 0 }}>{n}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 10 }}>{resolveLocationToPostcodes(n)[0] || ''}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      </div>

      {/**
        * ⭐⭐ STATE AND POSTCODE ARE VISIBLE, AND POSTCODE IS ENTERABLE ON ITS
        * OWN. Picking a town has always filled all three, but the other two
        * were invisible and unreachable, so an organiser who knew the postcode
        * and not a listed town had no way to say so. The postcode is what the
        * town map's filename is built from and what places the event for every
        * distance filter, so "no listed town" was silently costing both.
        *
        * ⛔ A POSTCODE BACK-FILLS THE STATE, NEVER THE TOWN. A postcode names
        * exactly one state and many towns: 2450 is Coffs Harbour AND Coramba
        * AND Karangi AND Ulong. Choosing one would put a locality on the event
        * that nobody typed, and it would look authoritative. See
        * `postcodeState` in lib/geo for the same rule stated where it lives.
        *
        * ⚠ The state stays editable after back-filling. The ranges cover
        * Australia only, and STATE_OPTIONS offers NZ and International on
        * purpose — a derived value must never lock out the case it cannot
        * derive.
        */}
        <div style={{ minWidth: 0 }}>
          <SubLabel>STATE</SubLabel>
          <select
            className="yp-venue-state"
            value={stateCode || ''}
            onChange={e => onTownChange?.(town, { state: e.target.value, postcode })}
            style={fieldStyle}
          >
            <option value="">Not set</option>
            {STATE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 0 }}>
          <SubLabel>POSTCODE</SubLabel>
          <input
            className="yp-venue-postcode"
            value={postcode || ''}
            inputMode="numeric"
            maxLength={4}
            /* Just the number: "e.g. 2450" does not fit the column, and the
               label above already says what the field is. */
            placeholder="2450"
            onChange={e => {
              const pc = e.target.value.replace(/\D/g, '').slice(0, 4);
              // The town is passed through untouched — this field answers the
              // postcode question and nothing else. Only the state follows,
              // and only when the code is long enough to imply one.
              const derived = pc.length === 4 ? postcodeState(pc) : '';
              onTownChange?.(town, {
                state: derived || stateCode || '',
                postcode: pc,
              });
            }}
            style={fieldStyle}
          />
        </div>
      </div>

      {/* ⚠ Says WHICH thing is missing, and what it costs. A postcode the app
          cannot place is not an error — NZ and International are real answers —
          but it silently removes the town map and every radius filter, and
          that is worth one quiet line rather than a surprise later. */}
      {postcode.length === 4 && !isKnownPostcode(postcode, stateCode) && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          We cannot place {postcode} on a map, so this event will not show an area map or appear in distance searches.
        </div>
      )}
    </div>
  );
  /* ── ONE FIELD. Type a name; matches appear; picking one links the record.
     ⛔ NO "are you sure this isn't on the list?" HERE — that question belongs
     at GO LIVE, where an unmatched venue is worth interrupting for, and where
     the nearby-venue candidates can actually be shown. Asking mid-typing made
     the promoter reason about the venue database while naming a pub. */
  return (
    <div>
      {/**
        * ⭐⭐ VENUE FIRST. The section used to open with TOWN / STATE /
        * POSTCODE and only then offer the venue search, which is backwards:
        * most events are at a room that already exists, and that room already
        * knows its own town, state and postcode. Asking for the locality first
        * made every organiser hand-type three fields the catalogue was about
        * to supply, and invited them to disagree with it.
        *
        * ⛔ So the location fields are NOT rendered while a canonical venue is
        * linked. Not disabled, not pre-filled and greyed — absent. A read-only
        * copy of the venue's own postcode is a second place for it to live and
        * a second thing to drift; `choose()` already writes the inherited
        * values through onTownChange, and eventViewModel reads the VENUE's
        * locality ahead of the event's regardless.
        */}
      <SubLabel>VENUE</SubLabel>
      <div style={{ position: 'relative' }}>
        <input
          className="yp-venue-search"
          value={value}
          onChange={e => {
            onChange?.(e.target.value);
            // Typing away from a linked room unlinks it — the text and the
            // record must never disagree about which venue this is.
            if (profileId) onProfileIdChange?.(null);
          }}
          placeholder={named ? 'Venue name' : 'Search existing venues...'}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
            border: `1px solid ${profileId ? 'var(--neon2)' : 'var(--border)'}`,
            background: 'var(--card2)', color: 'var(--text)', fontSize: 13, outline: 'none',
            paddingRight: (profileId || named) ? 92 : 12,
          }}
        />
        {(profileId || named) && (
          <span style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            fontFamily: "'DM Sans',sans-serif", fontSize: 9, fontWeight: 700,
            letterSpacing: .8, pointerEvents: 'none',
            color: profileId ? 'var(--neon2)' : pending ? '#FFD700' : 'var(--muted)',
          }}>
            {profileId ? 'ON YESPLEEZ' : pending ? 'PENDING' : 'THIS EVENT ONLY'}
          </span>
        )}
      </div>

      {!profileId && !named && results.length > 0 && (
        <div style={{ marginTop: 6, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {results.map(p => (
            <button key={p.id} type="button" onClick={() => choose(p)} style={rowStyle}>
              <span style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
              <span style={{
                fontSize: 11,
                color: town && norm(p.suburb) === norm(town) ? 'var(--neon2)' : 'var(--muted)',
              }}>{where(p)}</span>
            </button>
          ))}
        </div>
      )}

      {/* ⭐ THE FORK, and it is a question about the PLACE, not about privacy.
          "Is this a real room the world should be able to find, or a one-off?"
          Location visibility is asked separately, because a secret party can be
          at a real new venue and a public gig can be somewhere nobody should
          ever catalogue. */}
      {!profileId && !named && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Can&apos;t find it?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" onClick={() => pick('create')} style={choiceStyle}>
              {/* ⚠ "USE AN UNLISTED VENUE", ⛔ never "CREATE VENUE" (owner,
                  2026-08-14). The organiser is not creating anything: they are
                  naming a room that exists in the world but not yet in the
                  catalogue, and whether it joins is Studio's decision, not
                  theirs. A verb that promises creation would make a declined
                  submission read as a broken promise. The behaviour behind this
                  button is unchanged — it still sets venueRequest. */}
              <span style={choiceTitle}>+ USE UNLISTED VENUE</span>
              <span style={choiceSub}>
                A real venue that isn&apos;t on YesPleez yet. We&apos;ll check it and add
                it, so the venue can claim their page later.
              </span>
            </button>
            <button type="button" onClick={() => pick('event-only')} style={choiceStyle}>
              <span style={choiceTitle}>USE FOR THIS EVENT ONLY</span>
              <span style={choiceSub}>
                A one-off spot. Nothing is added to YesPleez and no venue page is made.
              </span>
            </button>
          </div>
        </div>
      )}

      {named && (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ flex: 1, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
            {pending
              ? 'We’ll check this venue and add it to YesPleez. Your event works straight away, and doesn’t wait for us.'
              : 'Used on this event only. Nothing is added to YesPleez and no venue page is made.'}
          </span>
          <button type="button" onClick={() => pick('search')}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, fontSize: 11, textDecoration: 'underline', flexShrink: 0 }}>
            start over
          </button>
        </div>
      )}

      {/* ⚠ ONLY ONCE THE VENUE IS UNLISTED. `named` is true for both branches
          of the fork — a room awaiting Studio and a one-off spot — because
          both store their locality on the EVENT and both need somewhere to put
          it. A linked catalogue venue never reaches here; it brought its own.
          ⭐ Editing an older event still works: `mode` initialises to
          'event-only' whenever there is a venue name and no profile id, so a
          pre-existing unlisted venue opens with its location visible. */}
      {named && <div style={{ marginTop: 12 }}>{townField}</div>}
    </div>
  );
}

const choiceStyle = {
  display: 'flex', flexDirection: 'column', gap: 3, width: '100%', textAlign: 'left',
  padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
  border: '1px dashed var(--border)', background: 'none',
};
const choiceTitle = {
  fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1, color: 'var(--text)',
};
const choiceSub = { fontSize: 11, color: 'var(--muted)', lineHeight: 1.45 };

/* TOWN and VENUE are two answers to one question, so they read as two labelled
   fields inside the one section rather than as two sections. */
function SubLabel({ children }) {
  return (
    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.4, color: 'var(--muted)', marginBottom: 4 }}>
      {children}
    </div>
  );
}

/* The town search input's own styling, shared by the state and postcode
   controls so the three read as one address block rather than three widgets. */
const fieldStyle = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--card2)',
  color: 'var(--text)', fontSize: 13, outline: 'none',
};

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
  padding: '9px 12px', background: 'none', border: 'none',
  borderBottom: '1px solid var(--border)', cursor: 'pointer',
  color: 'var(--text)', fontSize: 13, textAlign: 'left',
};
