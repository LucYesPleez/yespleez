import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { looksLikeNumber, toE164, isoForE164, COUNTRIES, DEFAULT_COUNTRY } from '../lib/phoneNumber';
import { findByPhone } from '../lib/phoneKey';
import MessengerAvatar from './MessengerAvatar';
import { profileIdentity } from '../lib/profileTypes';

/**
 * MESSENGER SEARCH — one field at the top of Messages, results in groups.
 *
 * Owner, 2026-08-05: "fb and ig have it at the top really easy to see". It
 * replaces three overlapping surfaces — two copies of a name/number field
 * buried inside the contacts list (reachable only after expanding it, and
 * never at all on a phone) and FIND SOMEONE BY NUMBER inside the Find Friends
 * panel.
 *
 * ══ THE PRIVACY BOUNDARY, WHICH IS THE WHOLE DESIGN ══════════════════
 *
 * ⛔ A NAME NEVER FINDS A STRANGER'S PERSONAL PROFILE. `.neq('type','punter')`
 * below is not a tidiness filter — it is the line that makes phone discovery
 * mean anything. `find_by_phone` demands a COMPLETE number and honours WHO CAN
 * FIND ME precisely so personal profiles cannot be browsed; if typing a first
 * name listed every match, that setting would be decorative and the user base
 * would be enumerable. Industry profiles are published to be found; personal
 * ones are reachable only by someone who already has the number.
 *
 * The same `.neq('type','punter')` guard is in FillSlotModal — this follows it
 * rather than inventing a second rule.
 *
 * ⚠ THE GROUPS EXIST TO MAKE THAT LEGIBLE. Without headings, "why did my mate
 * not come up when their band did" looks like a bug. Labelled sections say
 * which question each answer is answering.
 *
 * ══ WHY A NUMBER IS NOT A FILTER ═════════════════════════════════════
 *
 * ⚠ A PARTIAL NUMBER MATCHES NOBODY, AND THAT CANNOT BE HIDDEN. Search
 * normally narrows as you type; this cannot, because the lookup is an exact
 * E.164 match against a hash. So a number query says so while it is still
 * incomplete rather than sitting silent and reading as "no results".
 *
 * ⚠ ROUTED, NOT BLENDED. `looksLikeNumber` tests INTENT, not validity — the
 * moment a query looks like a number, name results stop, because showing every
 * contact under a number search reads as "these matched" when none did.
 *
 * ⚠ RESULTS OPEN PROFILES, THEY DO NOT START CONVERSATIONS. Choosing a sender
 * when the user owns several profiles is `MessageAsSheet`'s job (U4: infer only
 * when there is exactly one candidate, otherwise ask). Re-implementing that
 * here would be a second copy of the subtlest rule in the app. People you
 * already talk to are the exception — that conversation already exists, so
 * tapping continues it.
 */
export default function MessengerSearch({ rows = [], onOpen }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const query = q.trim();
  const isNumber = looksLikeNumber(q);
  // `+` or `00` means the query carries its own country code, so nothing is
  // assumed — and the chip below has nothing left to decide.
  const typedInternational = /^\s*(\+|00)/.test(q);

  // ⚠ THE CHIP IS STATE, AND IT FEEDS THE LOOKUP. Owner, 2026-08-05: "as they
  // start entering a number the country code appears at the front. if they
  // enter a name the country code doesnt appear." So it is mounted only for a
  // number query — a name search never sees a control that could not affect it.
  const [searchIso, setSearchIso] = useState(DEFAULT_COUNTRY);
  const completeNumber = isNumber ? toE164(q, searchIso).e164 : null;

  // ⚠ THE CHIP MUST FOLLOW THE NUMBER. Typing +64… and leaving the chip on AU
  // would show two different countries for one query, and the one the user can
  // see would be the wrong one. Same rule PhoneNumberSettings applies on blur.
  useEffect(() => {
    if (!typedInternational || !completeNumber) return;
    const detected = isoForE164(completeNumber);
    if (detected && detected !== searchIso) setSearchIso(detected);
  }, [typedInternational, completeNumber, searchIso]);

  // People you already talk to, deduped, most recent first — `rows` arrives
  // ordered by last_message_at, so first-seen IS most-recent.
  const contacts = useMemo(() => {
    const seen = new Map();
    for (const c of rows) {
      const p = c?.others?.[0]?.profiles;
      if (!p?.id || seen.has(p.id)) continue;
      seen.set(p.id, { profile: p, conversationId: c.id });
    }
    return [...seen.values()];
  }, [rows]);

  const known = useMemo(() => {
    if (!query || isNumber) return [];
    const needle = query.toLowerCase();
    return contacts
      .filter(({ profile: p }) => p?.name?.toLowerCase?.().includes(needle))
      .slice(0, 8);
  }, [contacts, query, isNumber]);

  // ── INDUSTRY PROFILES ──────────────────────────────────────────────
  const [profiles, setProfiles] = useState([]);
  useEffect(() => {
    if (!query || isNumber || query.length < 2) { setProfiles([]); return undefined; }
    let dead = false;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, name, type, location, suburb, avatar, avatar_thumb')
        .ilike('name', `%${query}%`)
        // ⛔ THE BOUNDARY. See the header note — never remove this.
        .neq('type', 'punter')
        .order('name')
        .limit(8);
      if (!dead) setProfiles(data || []);
    }, 250);
    return () => { dead = true; clearTimeout(t); };
  }, [query, isNumber]);

  // ── EXACT NUMBER ───────────────────────────────────────────────────
  const [numberMatch, setNumberMatch] = useState(null);
  const [searchingNumber, setSearchingNumber] = useState(false);
  useEffect(() => {
    if (!completeNumber) { setNumberMatch(null); setSearchingNumber(false); return undefined; }
    let dead = false;
    setSearchingNumber(true);
    const t = setTimeout(async () => {
      // The chip's country, not the module default — that is the whole point
      // of showing it.
      const { matches } = await findByPhone([q], searchIso);
      if (dead) return;
      setNumberMatch(matches?.[0] ?? null);
      setSearchingNumber(false);
    }, 350);
    return () => { dead = true; clearTimeout(t); };
    // ⚠ `searchIso` BELONGS HERE even though `completeNumber` is derived from
    // it. Changing the chip usually changes the resolved number and would
    // re-run this anyway — but not always, and "usually re-runs" is a lookup
    // that silently keeps showing the previous country's answer.
  }, [q, completeNumber, searchIso]);

  const open = Boolean(query);
  const nothing = open && !known.length && !profiles.length && !numberMatch && !searchingNumber;

  return (
    /* ⚠ 20px, MATCHING THE TITLE'S OWN MARGIN. Briefly 28 (owner: "come in
       from the ends a bit"), reverted on sight — the extra inset bought a
       little breathing room and cost more width than it was worth, and the
       search bar lines up with MESSAGES again. */
    <div style={{ padding: '0 20px', marginBottom: open ? 14 : 20 }}>
      <div style={rowWrap}>
        {/* ⚠ IT POPS OUT TO THE LEFT OF THE FIELD, NOT INSIDE IT (owner,
            2026-08-05). Its own pill, so it reads as a separate control you
            can press rather than decoration printed on the field — which is
            what it looked like sitting inside the same border.

            ⚠ MOUNTED ONLY FOR A NUMBER QUERY. On a name search it is not
            greyed out or inert, it is ABSENT — a control that cannot affect
            the result should not be taking up the row.

            ⚠ DISABLED ONCE THE QUERY CARRIES ITS OWN CODE. With a leading +
            or 00, toE164 ignores this entirely, so leaving it pressable would
            be a control that visibly does nothing. It still SHOWS the detected
            country, because that is the useful half. */}
        {isNumber && (
          <select
            aria-label="Country the number belongs to"
            value={searchIso}
            disabled={typedInternational}
            onChange={(e) => setSearchIso(e.target.value)}
            style={{ ...isoChip, cursor: typedInternational ? 'default' : 'pointer',
              opacity: typedInternational ? 0.55 : 1 }}
          >
            {COUNTRIES.map((c) => (
              <option key={c.iso} value={c.iso}>+{c.dial}</option>
            ))}
          </select>
        )}

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or number…"
          aria-label="Search people, artists and venues"
          inputMode="text"
          style={fieldStyle}
        />
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          <Group title="PEOPLE YOU TALK TO" show={known.length > 0}>
            {known.map(({ profile, conversationId }) => (
              <Row
                key={profile.id}
                profile={profile}
                onClick={() => { setQ(''); onOpen?.(conversationId, profile); }}
              />
            ))}
          </Group>

          <Group title="ARTISTS & VENUES" show={profiles.length > 0}>
            {profiles.map((p) => (
              <Row key={p.id} profile={p} onClick={() => { setQ(''); navigate(`/profile/${p.id}`); }} />
            ))}
          </Group>

          {isNumber && (
            <Group title="FOUND BY NUMBER" show>
              {/* ⚠ SAYS IT IS WAITING FOR THE REST OF THE NUMBER. Silence here
                  is indistinguishable from "nobody found", which would be a
                  claim about a person rather than about the query. */}
              {!completeNumber && <Note>Enter the full number — a partial one matches nobody.</Note>}

              {/* ⚠ NO COUNTRY PICKER HERE, DELIBERATELY — AND THIS IS WHAT
                  REPLACES IT. Anything written with `+` or `00` identifies its
                  own country, so a picker would be dead UI for almost every
                  query. The exception is a LOCAL-format foreign number: `021
                  555 0199` meant as NZ resolves against the AU default to
                  +61215550199, which is a real number belonging to a different
                  human. Echoing the resolved E.164 makes that assumption
                  visible before the user reads a wrong answer as the truth.

                  ⚠ E.164, NOT formatDisplay. That helper writes a LOCAL form,
                  which would hide the country code — the one digit group this
                  line exists to show. */}
              {completeNumber && <div style={resolvedStyle}>{completeNumber}</div>}

              {completeNumber && searchingNumber && <Note>Searching…</Note>}
              {completeNumber && !searchingNumber && numberMatch && (
                <Row
                  profile={{ id: numberMatch.profileId, name: numberMatch.displayName, avatar: numberMatch.avatar }}
                  onClick={() => { setQ(''); navigate(`/profile/${numberMatch.profileId}`); }}
                />
              )}
              {/* ⚠ IDENTICAL COPY whether the number is unregistered or its
                  owner chose not to be found. Distinguishing them would leak
                  membership — the same wording PhoneNumberSettings uses. */}
              {completeNumber && !searchingNumber && !numberMatch && (
                <Note>
                  No match for that number. They might not be on YesPleez yet — or
                  they&rsquo;ve chosen not to be found.
                </Note>
              )}

              {/* ⚠ ONLY ON A MISS, AND ONLY WHEN A COUNTRY WAS ASSUMED. What is
                  stored is an HMAC of the E.164, so a match needs BOTH sides to
                  resolve to the identical number — there is no fuzzy or partial
                  matching to fall back on. A local-format overseas number
                  therefore does not "nearly" match; it resolves to a different
                  real number and finds nobody. Shown after the miss rather than
                  before, because the overwhelming majority of searches are
                  domestic and would not thank us for the lecture. */}
              {completeNumber && !searchingNumber && !numberMatch && !typedInternational && (
                <Note>
                  Overseas? Change the code at the front of the field, or start with{' '}
                  <strong style={{ color: 'var(--text)' }}>+</strong> — without either it is read
                  as {DEFAULT_COUNTRY}.
                </Note>
              )}
            </Group>
          )}

          {nothing && !isNumber && <Note>Nothing matched &ldquo;{query}&rdquo;.</Note>}
        </div>
      )}
    </div>
  );
}

function Group({ title, show, children }) {
  if (!show) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={groupTitleStyle}>{title}</div>
      {children}
    </div>
  );
}

function Row({ profile, onClick }) {
  // ⚠ `profileIdentity`, NOT A LOCAL MAP. `artist` displays as "DJ / PROD."
  // app-wide and lib/profileTypes is where that is decided; a second copy here
  // drifts the moment a label changes.
  const sub = profile.type && profile.type !== 'punter'
    ? [profileIdentity(profile.type)?.shortLabel, profile.suburb || profile.location]
        .filter(Boolean).join(' · ')
    : profile.suburb || profile.location || '';
  return (
    <button type="button" onClick={onClick} style={rowStyle}>
      <MessengerAvatar src={profile.avatar_thumb || profile.avatar} size={36} />
      <span style={{ minWidth: 0, textAlign: 'left' }}>
        <span style={{ display: 'block', fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {profile.name || 'Unnamed'}
        </span>
        {sub && (
          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', letterSpacing: 0.4 }}>{sub}</span>
        )}
      </span>
    </button>
  );
}

function Note({ children }) {
  return <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, padding: '6px 2px' }}>{children}</div>;
}


/* Two separate pills on one row. The gap is what makes the chip read as its
   own control rather than a prefix printed inside the field. */
const rowWrap = { display: 'flex', alignItems: 'center', gap: 8 };

/* ⚠ BOTH PILLS STATE `height`, THEY DO NOT DERIVE IT FROM PADDING. Given
   identical padding, border and font, a native <select> still came out 44px
   against the input's 42 and sat a pixel high — its line box is computed by the
   platform, not by the CSS above it. Vertical padding is therefore 0 and the
   height is declared, so the two cannot drift apart on another platform either. */
const PILL_HEIGHT = 42;

const isoChip = {
  flexShrink: 0, boxSizing: 'border-box', height: PILL_HEIGHT, lineHeight: 1,
  background: 'rgba(255,255,255,.06)', border: '1px solid var(--border)',
  borderRadius: 999, padding: '0 12px', outline: 'none',
  color: 'var(--text)', fontFamily: "'DM Sans', sans-serif", fontSize: 14,
  // Native control on a dark surface needs this or the dropdown renders white.
  colorScheme: 'dark',
};

const fieldStyle = {
  flex: 1, minWidth: 0, boxSizing: 'border-box', height: PILL_HEIGHT,
  background: 'rgba(255,255,255,.06)', border: '1px solid var(--border)',
  borderRadius: 999, padding: '0 16px', outline: 'none',
  color: 'var(--text)', fontFamily: "'DM Sans', sans-serif", fontSize: 14,
};

const groupTitleStyle = {
  fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, letterSpacing: 1.6,
  color: 'var(--muted)', margin: '10px 0 4px',
};

/* The number actually being looked up. Monospaced-ish tracking so the digit
   groups stay readable, and muted because it is a confirmation of what was
   typed rather than a result. */
const resolvedStyle = {
  fontFamily: "'DM Sans', sans-serif", fontSize: 12, letterSpacing: 0.8,
  color: 'var(--text)', opacity: 0.75, padding: '4px 2px',
};

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
  background: 'none', border: 'none', borderRadius: 10,
  padding: '7px 6px', cursor: 'pointer', textAlign: 'left',
};
