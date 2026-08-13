// CHECK YOUR VENUE — the one interruption between a typed venue and a public event.
//
// ⭐ WHY IT IS HERE AND NOT IN THE FORM. The venue field used to carry a
// paragraph explaining that a venue is a canonical record, which asked the
// promoter to understand the data model while they were still naming a pub.
// The question only actually matters at the moment of publishing, and only
// when the name matched nothing — and at that moment it can be asked
// concretely, with real candidates, instead of abstractly.
//
// ⚠ IT ASKS, IT DOES NOT ACCUSE. An unmatched venue is usually a real new room,
// occasionally a typo, and sometimes a room already on YesPleez under a name
// the promoter did not guess ("The Bellingen Brewing Co" vs "the brewery").
// Only the last is a defect, and it is the one that quietly creates duplicate
// records — so the sheet leads with candidates and keeps "none of these" a
// first-class answer rather than a discouraged one.

import { haversineKm, postcodeCoords, profileCoords } from '../lib/geo';

const norm = s => String(s || '').trim().toLowerCase();

/* Words that appear in half the venue names in the country and so identify
   nothing. Left in the stored name, ignored when matching. */
const NOISE = new Set(['the', 'a', 'of', 'and', 'co', 'inc', 'pty', 'ltd', 'hotel', 'club', 'bar', 'venue']);
const tokens = s => norm(s).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !NOISE.has(w));

/**
 * How much two venue names look like the same place.
 *
 * ⚠ PREFIX, NOT EQUALITY — this exists because "the brewery" and "The Bellingen
 * Brewing Co" are the same building, and every exact or containment test says
 * they are not. That miss is what created a duplicate. Four characters of a
 * shared prefix ("brew") is enough to raise a candidate; it is a RANKING hint
 * on a list the human then chooses from, never an automatic link.
 */
function nameScore(typed, candidate) {
  const a = tokens(typed), b = tokens(candidate);
  if (!a.length || !b.length) return 0;
  let hits = 0;
  for (const x of a) {
    if (b.some(y => x === y || x.slice(0, 4) === y.slice(0, 4))) hits++;
  }
  return hits;
}

/**
 * The five likeliest rooms the promoter actually meant.
 *
 * ⚠ GEOGRAPHY FIRST, THEN NAME — a pure string match is what misses "the
 * brewery" vs "The Bellingen Brewing Co", which is the exact case that created
 * a duplicate. Distance from the entered town does the heavy lifting; the name
 * only breaks ties and promotes an obvious near-match above a closer stranger.
 *
 * A venue with no coordinates is not dropped: unknown distance is not "far
 * away" (the same rule What's On applies to its radius filter). It sorts after
 * everything placeable, so it is still reachable.
 */
export function nearestVenues(venues, { town, postcode, state, name }, limit = 5) {
  const origin = postcodeCoords(postcode, state);
  const typed = norm(name);

  const scored = (venues || []).map(v => {
    const c = profileCoords(v);
    const km = origin && c ? haversineKm(origin.lat, origin.lng, c.lat, c.lng) : null;
    const sameTown = town && norm(v.suburb) === norm(town);
    return { venue: v, km, score: nameScore(typed, v.name), sameTown };
  });

  /* ⚠ NAME BEATS DISTANCE WHEN THERE IS A NAME SIGNAL, and this ordering was
     wrong first time round. Every venue in one town shares a postcode, so
     `postcodeCoords` gives them all the SAME centroid and every distance
     collapses to "<1 km" — sorting on distance alone left "The Bellingen
     Brewing Co" third in a list of five identical distances. Geography is what
     narrows the field to a town; the name is what picks the room inside it. */
  return scored
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.sameTown !== b.sameTown) return a.sameTown ? -1 : 1;
      if (a.km == null && b.km == null) return 0;
      if (a.km == null) return 1;          // unknown distance sorts last, never out
      if (b.km == null) return -1;
      return a.km - b.km;
    })
    .slice(0, limit);
}

export default function VenueCheckSheet({ typedName, town, candidates, onPick, onNoneOfThese, onCancel, busy }) {
  return (
    <div
      style={{ position:'fixed', inset:0, zIndex:9000, background:'rgba(0,0,0,.75)', display:'flex', alignItems:'flex-end', justifyContent:'center' }}
      onClick={onCancel}
    >
      <div onClick={e => e.stopPropagation()} style={{
        width:'100%', maxWidth:560, maxHeight:'86vh', overflowY:'auto',
        background:'var(--card)', borderTopLeftRadius:18, borderTopRightRadius:18,
        border:'1px solid var(--border)', borderBottom:'none',
        padding:'18px 18px calc(18px + var(--yp-safe-bottom))',
      }}>
        <div style={{ width:36, height:4, borderRadius:2, background:'rgba(255,255,255,.2)', margin:'0 auto 18px' }} />

        <p style={{ fontFamily:"'Bebas Neue'", fontSize:18, letterSpacing:2.5, color:'#fff', margin:'0 0 4px' }}>
          CHECK YOUR VENUE
        </p>
        <p style={{ fontSize:13, color:'var(--muted)', margin:'0 0 16px' }}>
          Is <span style={{ color:'var(--text)' }}>{typedName}</span> already on YesPleez
          {town ? <> near {town}</> : null}?
        </p>

        {candidates.length > 0 ? (
          <>
            <p style={{ fontFamily:"'Bebas Neue'", fontSize:11, letterSpacing:1.6, color:'var(--muted)', margin:'0 0 8px' }}>
              NEARBY VENUES
            </p>
            <div style={{ border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', marginBottom:16 }}>
              {candidates.map(({ venue, km }) => (
                <button key={venue.id} type="button" disabled={busy} onClick={() => onPick(venue)}
                  style={{
                    display:'flex', alignItems:'center', gap:10, width:'100%', textAlign:'left',
                    padding:'11px 12px', background:'none', border:'none',
                    borderBottom:'1px solid var(--border)', cursor:'pointer', color:'var(--text)',
                  }}>
                  <span style={{ flex:1, minWidth:0 }}>
                    <span style={{ display:'block', fontSize:13 }}>{venue.name}</span>
                    <span style={{ display:'block', fontSize:11, color:'var(--muted)' }}>
                      {[venue.suburb, venue.state].filter(Boolean).join(' · ')}
                      {/* ⚠ "distance unknown", never a fabricated 0 km. */}
                      {km != null ? ` · ${km < 1 ? '<1' : km.toFixed(1)} km` : ' · distance unknown'}
                    </span>
                  </span>
                  <span style={{ fontFamily:"'Bebas Neue'", fontSize:11, letterSpacing:1, color:'var(--neon2)' }}>
                    THIS IS IT
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p style={{ fontSize:12, color:'var(--muted)', margin:'0 0 16px' }}>
            No existing venues found near {town || 'that town'}.
          </p>
        )}

        <button type="button" onClick={onNoneOfThese} disabled={busy}
          style={{
            width:'100%', padding:'12px', borderRadius:10, cursor:'pointer',
            fontFamily:"'Bebas Neue'", fontSize:14, letterSpacing:1.4,
            border:'1px solid var(--border)', background:'none', color:'var(--text)',
          }}>
          {/* ⛔ NO EM DASH. User-facing copy never carries one (standing rule);
              a colon does the same work here. */}
          {busy ? 'WORKING…' : 'NONE OF THESE. IT’S A NEW VENUE'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}
          style={{
            width:'100%', padding:'10px', marginTop:8, borderRadius:10, cursor:'pointer',
            fontSize:12, border:'none', background:'none', color:'var(--muted)',
          }}>
          Back to the event
        </button>
      </div>
    </div>
  );
}
