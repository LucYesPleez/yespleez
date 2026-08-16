import { useState, useEffect, useRef } from 'react';
import UnclaimedNotice from './UnclaimedNotice';
import { supabase } from '../lib/supabase';
import { genreLabels } from '../lib/profileTaxonomy';
/* ⭐ THE ONE WRITER for putting somebody on a slot. ⛔ This component may not
   compose its own insert — it did, and it wrote the wrong column. */
import { assignMemberToSlot } from '../lib/lineupActions';
/* ⛔ THE CAP LIVES WITH THE BILL. This sheet asks; it does not decide. */
import { billCapacity, billFullMessage } from '../lib/hostLineup';

export default function FillSlotModal({ slot, eventId, eventName = '', hostId, acceptedArtists = [], acceptedProfiles = {}, onFilled, onClose }) {
  const [view,    setView]    = useState('menu');
  const [filter,  setFilter]  = useState('');
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [busy,    setBusy]    = useState(false);
  /* ⛔⛔ THE FAILURE WAS SILENT. Both fill paths ended `if (!error) onFilled()`,
     so a write RLS filtered simply left the sheet open with no explanation —
     indistinguishable from a slow network, and the exact failure mode this
     codebase keeps being bitten by. */
  const [err,     setErr]     = useState(null);
  const [name,    setName]    = useState('');
  const [email,   setEmail]   = useState('');
  const [phone,   setPhone]   = useState('');
  const timer = useRef(null);

  const timeLabel = [slot.time, slot.ampm].filter(Boolean).join(' ');

  useEffect(() => {
    if (view !== 'search') return;
    clearTimeout(timer.current);
    if (!query.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setBusy(true);
      const { data } = await supabase
        .from('profiles')
        .select('id, user_id, name, avatar, sound, genre_string, type')
        .ilike('name', `%${query.trim()}%`)
        .neq('type', 'punter')
        .limit(20);
      setResults(data || []);
      setBusy(false);
    }, 300);
    return () => clearTimeout(timer.current);
  }, [query, view]);

  /**
   * ⛔⛔ REPLACE WAS THE HOLE IN THE CAP, and it is how a bill reaches 7/5.
   *
   * ⚠⚠ Replacing an act deletes the previous occupant's PERFORMANCE but leaves
   * their MEMBER row on the bill — that is deliberate, they stay as "needs set
   * time" — so a replace ADDS one to the lineup and removes none. Every other
   * route is guarded by `planAddToBill` or `promoteMemberToBill`; this one
   * targets an existing slot and slipped past both.
   *
   * ⚠ CHECKED ONLY WHERE A NEW MEMBER IS CREATED. Putting somebody who is
   * ALREADY on the bill onto a slot moves them; it does not grow the bill, and
   * refusing that would block a straight swap for no reason.
   *
   * ⛔ IT READS THE DATABASE, ⛔ not a prop. This component is mounted by two
   * screens and a count passed in by one of them is a count the other can
   * forget — the rule has to hold for whoever opened the sheet.
   */
  async function billHasRoom() {
    const [{ count: onBill }, { count: slots }] = await Promise.all([
      supabase.from('lineup_members').select('id', { count: 'exact', head: true })
        .eq('event_id', eventId).eq('status', 'on_bill'),
      supabase.from('event_slots').select('id', { count: 'exact', head: true })
        .eq('event_id', eventId),
    ]);
    const cap = billCapacity(onBill || 0, slots || 0);
    if (cap.full) { setErr(billFullMessage(cap.total)); setBusy(false); return false; }
    return true;
  }

  async function fillFromProfile(prof) {
    setBusy(true);
    setErr(null);
    // Upsert lineup_member for this artist on this event
    let { data: memberData } = await supabase.from('lineup_members').select('id').eq('event_id', eventId).eq('artist_id', prof.user_id).eq('status', 'on_bill').maybeSingle();
    if (!memberData) {
      if (!await billHasRoom()) return;
      const { data: nm } = await supabase.from('lineup_members').insert({
        event_id: eventId, artist_id: prof.user_id, artist_profile_id: prof.id,
        artist_name: prof.name, sound: prof.sound || null, genre: prof.genre_string || null, status: 'on_bill',
      }).select('id').single();
      memberData = nm;
    }
    /* ⛔⛔ ONE WRITER, and it writes `slot_uuid`. This wrote the legacy TEXT
       `slot_id` column with a UUID, so the L3 trigger could not resolve the FK
       and the row was invisible to every read. See `assignMemberToSlot`. */
    const { ok, error } = await assignMemberToSlot(supabase, {
      slotId: slot.id, eventId, memberId: memberData.id, status: 'draft',
    });
    setBusy(false);
    if (ok) onFilled(); else setErr(error);
  }

  async function fillManual() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    /* ⚠ ALWAYS a new member — a typed-in name has no row to reuse, so this path
       always grows the bill and is always subject to the cap. */
    if (!await billHasRoom()) return;
    const { data: memberData } = await supabase.from('lineup_members').insert({
      event_id: eventId, artist_name: name.trim(), status: 'on_bill',
    }).select('id').single();
    /* ⚠ `accepted`, ⛔ not `draft` — a hand-entered act has no account to offer
       anything to, so writing them down IS the booking. Same rule `toClaim`
       states for display. */
    const { ok, error } = await assignMemberToSlot(supabase, {
      slotId: slot.id, eventId, memberId: memberData.id, status: 'accepted',
    });
    setBusy(false);
    if (ok) onFilled(); else setErr(error);
  }

  const filtered = acceptedArtists.filter(app => {
    // M6 · acceptedProfiles is keyed by applications.id (lib/applicantProfiles.js).
    const prof = acceptedProfiles[app.id];
    return (prof?.name || app.artist_name || '').toLowerCase().includes(filter.toLowerCase());
  });

  const hasContact = email.trim() || phone.trim();

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', zIndex: 2000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 'var(--yp-safe-bottom)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, minHeight: '50vh', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 -4px 40px rgba(0,0,0,.6)', border: '1px solid rgba(255,255,255,.07)', borderBottom: 'none' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {view !== 'menu' && (
              <button onClick={() => setView('menu')} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 24, cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0 }}>‹</button>
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 2 }}>
                FILL {timeLabel} SLOT
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                {view === 'menu'     ? 'How do you want to fill this slot?' :
                 view === 'accepted' ? 'Select from your accepted artists' :
                 view === 'search'   ? 'Search YesPleez artists' :
                                      'Enter artist details'}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 24, cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
          </div>
          {err && (
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,45,120,.4)', background: 'rgba(255,45,120,.1)', color: '#FF2D78', fontSize: 12 }}>
              {err}
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px 32px' }}>

          {/* MENU */}
          {view === 'menu' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <MenuOption
                label={`SHORTLISTED ARTISTS${acceptedArtists.length ? ` (${acceptedArtists.length})` : ''}`}
                sub="Artists shortlisted for this event"
                accent
                disabled={acceptedArtists.length === 0}
                onClick={() => setView('accepted')}
              />
              <MenuOption
                label="SEARCH YESPLEEZ"
                sub="Find any artist on the platform"
                onClick={() => setView('search')}
              />
              <MenuOption
                label="NOT ON YESPLEEZ YET"
                sub="Enter their name, send an invite via email or SMS"
                onClick={() => setView('manual')}
              />
            </div>
          )}

          {/* ACCEPTED LIST */}
          {view === 'accepted' && (
            <div>
              <SearchInput value={filter} onChange={setFilter} placeholder="Filter artists…" />
              {filtered.length === 0
                ? <Empty>No accepted artists match.</Empty>
                : filtered.map(app => {
                    const prof = acceptedProfiles[app.id] || {};
                    const n    = prof.name || app.artist_name || 'Unknown';
                    return (
                      <ArtistRow
                        key={app.id}
                        avatar={prof.avatar}
                        name={n}
                        /* ⛔⛔ `genreLabels`, ⛔ never the raw column — role keys live
                       in it. ⚠ Sliced to three like every other card; this row
                       printed the WHOLE genre list. */
                    sub={prof.sound || genreLabels(prof.genre_string).slice(0, 3).join(' · ')}
                        disabled={busy}
                        // M6 · `id` was missing here, so every slot filled from
                        // a shortlisted application wrote a lineup_member with
                        // artist_profile_id UNDEFINED — a new row carrying only
                        // the legacy account key. The resolved profile has it.
                        onSelect={() => fillFromProfile({ id: prof.id, user_id: app.artist_id, name: n, sound: prof.sound, genre_string: prof.genre_string })}
                      />
                    );
                  })
              }
            </div>
          )}

          {/* SEARCH */}
          {view === 'search' && (
            <div>
              <SearchInput value={query} onChange={setQuery} placeholder="Search by name…" autoFocus />
              {busy && <Empty>Searching…</Empty>}
              {/* N2 · host-facing disclosure at the point of choosing. This
                  search has no claim filter (only `.neq('type','punter')`), so
                  unclaimed profiles are selectable — and `fillFromProfile`
                  writes `artist_id: prof.user_id`, which is NULL for them. The
                  performer lands on the lineup and no invitation goes out, so
                  a host who is not told will wait for a reply nobody was asked
                  for. `prof` is a canonical profiles row from the query above,
                  which is what isProfileUnclaimed requires.

                  key is `prof.id`, not `prof.user_id`: user_id is NULL for
                  every unclaimed profile, so two of them in one result set
                  collided on the same null key — precisely the rows this
                  disclosure exists to surface. */}
              {!busy && results.map(prof => (
                <div key={prof.id ?? prof.user_id}>
                  <ArtistRow
                    avatar={prof.avatar}
                    name={prof.name}
                    /* ⛔⛔ `genreLabels`, ⛔ never the raw column — role keys live
                       in it. ⚠ Sliced to three like every other card; this row
                       printed the WHOLE genre list. */
                    sub={prof.sound || genreLabels(prof.genre_string).slice(0, 3).join(' · ')}
                    disabled={busy}
                    onSelect={() => fillFromProfile(prof)}
                  />
                  <UnclaimedNotice profile={prof} context="slot" />
                </div>
              ))}
              {!busy && query && results.length === 0 && (
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>No one found on YesPleez.</p>
                  <button
                    onClick={() => { setName(query); setView('manual'); }}
                    style={ghostBtn}
                  >ENTER MANUALLY INSTEAD</button>
                </div>
              )}
            </div>
          )}

          {/* MANUAL / INVITE */}
          {view === 'manual' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="DJ / ARTIST NAME *" value={name} onChange={setName} placeholder="e.g. DJ Flames" />
              <Field label="EMAIL (OPTIONAL)" value={email} onChange={setEmail} placeholder="artist@email.com" type="email" />
              <Field label="PHONE (OPTIONAL)" value={phone} onChange={setPhone} placeholder="+61 400 000 000" type="tel" />
              {hasContact && (
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>
                  An invite will be sent. They can claim this slot when they join YesPleez.
                </p>
              )}
              <button
                onClick={fillManual}
                disabled={!name.trim() || busy}
                style={{
                  width: '100%', padding: 13, borderRadius: 12, border: 'none', marginTop: 4,
                  cursor: !name.trim() || busy ? 'default' : 'pointer',
                  fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: 2,
                  background: !name.trim() || busy ? 'rgba(255,255,255,.08)' : 'var(--neon)',
                  color:      !name.trim() || busy ? 'var(--muted)'          : '#fff',
                  transition: 'background .15s',
                }}
              >
                {busy ? 'SAVING…' : hasContact ? 'FILL SLOT + SEND INVITE' : 'FILL SLOT'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuOption({ label, sub, onClick, disabled, accent }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%', textAlign: 'left', padding: '14px 16px', borderRadius: 12,
        border:      `1px solid ${accent ? 'rgba(0,229,255,.25)' : 'rgba(255,255,255,.1)'}`,
        background:  accent ? 'rgba(0,229,255,.05)' : 'rgba(255,255,255,.03)',
        cursor:      disabled ? 'default' : 'pointer',
        opacity:     disabled ? 0.4 : 1,
        display:     'flex', alignItems: 'center', justifyContent: 'space-between',
        transition:  'border-color .15s',
      }}
    >
      <div>
        <div style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, color: accent ? 'var(--neon2)' : 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>
      </div>
      <span style={{ color: 'var(--muted)', fontSize: 20, marginLeft: 8, flexShrink: 0 }}>›</span>
    </button>
  );
}

function ArtistRow({ avatar, name, sub, onSelect, disabled }) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,.05)', cursor: disabled ? 'default' : 'pointer', textAlign: 'left' }}
    >
      <div style={{ width: 42, height: 42, borderRadius: 10, background: 'var(--card2)', flexShrink: 0, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {avatar && <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
      <span style={{ color: 'var(--muted)', fontSize: 20, flexShrink: 0 }}>›</span>
    </button>
  );
}

function SearchInput({ value, onChange, placeholder, autoFocus }) {
  return (
    <input
      autoFocus={autoFocus}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width: '100%', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontFamily: 'inherit', fontSize: 14, boxSizing: 'border-box', marginBottom: 12, outline: 'none' }}
    />
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, color: 'var(--muted)', marginBottom: 5 }}>{label}</div>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontFamily: 'inherit', fontSize: 14, boxSizing: 'border-box', outline: 'none' }}
      />
    </div>
  );
}

function Empty({ children }) {
  return <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>{children}</p>;
}

const ghostBtn = {
  fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5,
  padding: '10px 20px', borderRadius: 8,
  border: '1px solid rgba(255,255,255,.2)', background: 'none',
  color: 'var(--text)', cursor: 'pointer',
};
