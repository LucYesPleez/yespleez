import { useState, useEffect, useRef } from 'react';
import UnclaimedNotice from './UnclaimedNotice';
import { supabase } from '../lib/supabase';
import { answerOpenRequests } from '../lib/answerOpenRequests';
import { writeNotification } from '../lib/writeNotification';
import { genreLabels } from '../lib/profileTaxonomy';
/* ⛔ ONE implementation of each share act, in lib/shareTarget. */
import { shareUrl, nativeShare, copyMessage, canNativeShare } from '../lib/shareTarget';
import { offerMessage, offerTarget } from '../lib/eventOffer';
/* ⭐ THE ONE WRITER for putting somebody on a slot. ⛔ This component may not
   compose its own insert — it did, and it wrote the wrong column. */
import { assignMemberToSlot } from '../lib/lineupActions';
/* ⛔ THE CAP LIVES WITH THE BILL, and so does the BOOKING GATE. This sheet asks;
   it does not decide. */
import { billCapacity, billFullMessage, placementCanCreateBooking } from '../lib/hostLineup';

/**
 * @param shortlist ⭐⭐ SHORTLIST ENTRIES from `lib/shortlist` — ⛔ NOT a bare
 *   row array. Each is `{ id, row, kind, booked }`, and `kind` is the whole
 *   point: this sheet has to write two DIFFERENT things.
 *
 * ⛔⛔ WHY THE SHAPE CHANGED. The prop was `acceptedArtists`, a mixed array of
 * applications AND member rows, and every row was fed to `fillFromProfile` —
 * which CREATES membership. For a member already on the bill that is wrong
 * twice: `acceptedProfiles` is keyed by application id so the profile came back
 * empty, and `artist_id` is NULL on a hand-typed act, so the lookup missed and
 * the insert branch ran. ⚠⚠ The observed result on Bass Heavy: picking `luc`
 * (already `on_bill`, no slot) would either duplicate him or be refused by the
 * 5/5 cap — being told "the lineup is full" about somebody already in it.
 *
 * ⭐ A member needs a PLACEMENT. An applicant needs MEMBERSHIP and then a
 * placement. One sheet, two writes, chosen by `kind`.
 *
 * @param shortlistProfiles profiles for those entries, keyed by ENTRY id —
 *   application ids and member ids in one map. ⚠ Safe to merge: the two id
 *   spaces are distinct, and each caller already holds both maps.
 */
export default function FillSlotModal({ slot, eventId, event = null, eventName = '', eventDate = '', eventVenue = '', hostId, shortlist = [], shortlistProfiles = {}, onFilled, onClose }) {
  /* ⭐ WHICH CONTRACT THIS EVENT LIVES UNDER, asked once through the one reader.
     ⛔ Absent event reads as `legacy` (eventProvenance's fail-safe), which is the
     behaviour every existing event already has. */
  const canBookByPlacing = placementCanCreateBooking(event);
  const [view,    setView]    = useState('menu');
  const [filter,  setFilter]  = useState('');
  /* The free-text marker. ⚠ Separate from `filter` and `query` — a search box
     and a label field sharing one state is how a half-typed artist name ends up
     written onto a slot as its title. */
  const [labelText, setLabelText] = useState('');
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [busy,    setBusy]    = useState(false);
  /* ⛔⛔ THE FAILURE WAS SILENT. Both fill paths ended `if (!error) onFilled()`,
     so a write RLS filtered simply left the sheet open with no explanation —
     indistinguishable from a slow network, and the exact failure mode this
     codebase keeps being bitten by. */
  const [err,     setErr]     = useState(null);
  const [name,    setName]    = useState('');
  const [copied,  setCopied]  = useState(false);
  const timer = useRef(null);

  const timeLabel = [slot.time, slot.ampm].filter(Boolean).join(' ');

  /**
   * ⚠ THE OFFER POINTS AT THE EVENT, ⛔ never at the slot. `shareUrl` builds the
   * hash route the app actually serves, so the link opens the event page rather
   * than the app's front door. ⛔ No slot id and ⛔ no code ride along — see
   * `lib/eventOffer` for why both were dropped.
   */
  const offerArgs = {
    toName: name.trim(),
    eventName,
    date: eventDate,
    venue: eventVenue,
    url: shareUrl(`/event/${eventId}`),
  };

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

  /**
   * ⭐⭐ MARK THE TIME — write `event_slots.label`, and ⛔ book nobody.
   *
   * ⚠⚠ THIS IS THE ONE FILL PATH THAT CREATES NO PERFORMANCE AND NO MEMBER. A
   * welcome to country is not an act with an empty name; SlotCard already
   * renders a labelled slot as its own thing ("the time is SPOKEN FOR"), and
   * inventing a nameless `lineup_members` row to carry it would put a ghost on
   * the bill, in the tally, and in every count that reads the lineup.
   *
   * ⛔ NOTHING IS NOTIFIED. There is nobody to notify — that is the point.
   */
  async function saveLabel(text) {
    const label = String(text || '').trim();
    if (!label) { setErr('Give the slot something to say.'); return; }
    setBusy(true);
    setErr(null);
    const { error } = await supabase
      .from('event_slots')
      .update({ label })
      .eq('id', slot.id);
    setBusy(false);
    /* ⚠ REPORTED, NOT SWALLOWED — the failure this modal's header warns about:
       both fill paths once ended `if (!error) onFilled()` and said nothing when
       there WAS one. */
    if (error) { setErr(error.message || 'That could not be saved.'); return; }
    onFilled();
  }

  /**
   * ⭐⭐ ALREADY ON THE BILL — SO THIS IS A PLACEMENT AND NOTHING ELSE.
   *
   * ⛔ NO membership write: the row exists, and inserting another is how one act
   * becomes two.
   * ⛔ NO cap check: `billHasRoom` counts `on_bill` members, and this member is
   * already inside that count. Asking would refuse a legitimate placement on a
   * full bill — the exact "lineup is full" nonsense observed on Bass Heavy,
   * where the artist being placed was one of the five.
   *
   * ⭐ `status: 'draft'` and the same one writer as `doAssignMember` on the
   * event page, so a set time means the same thing wherever the host reaches it
   * from. ⛔ Drafting is silent; ⛔ nothing is notified here.
   */
  async function fillFromMember(member) {
    if (!member?.id) { setErr('That artist has no lineup row to place.'); return; }
    setBusy(true);
    setErr(null);
    const { ok, error } = await assignMemberToSlot(supabase, {
      slotId: slot.id, eventId, memberId: member.id, status: 'draft',
    });
    setBusy(false);
    if (ok) onFilled(); else setErr(error);
  }

  async function fillFromProfile(prof) {
    /**
     * ⛔⛔ ASKED BEFORE THE MEMBERSHIP IS WRITTEN, ⛔ never after. On a managed
     * event a slot cannot create a booking, and inserting the member first and
     * then being refused by `assignMemberToSlot` would leave an `on_bill` row
     * with no slot and no acceptance — invisible on every managed surface,
     * because that model's LINEUP is `accepted` performances.
     */
    if (!canBookByPlacing) {
      setErr('This event books artists by offering them a place and waiting for them to accept, so a set time cannot add somebody new. Offer them the event first.');
      return;
    }
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
    /**
     * ⭐⭐ THE FOURTH DOOR ONTO A BILL, and it owes the same answer as the other
     * three. Filling a slot from a profile puts somebody on the bill, so an
     * application or enquiry they had open for this night stops being a
     * question — see `lib/answerOpenRequests`.
     *
     * ⚠ NEEDS THE `event` OBJECT, not `eventId`: the enquiry match is by night
     * AND receiving side, and an enquiry naming no event is exactly the shape
     * that produced this bug. ⭐ The prop is already passed for
     * `placementCanCreateBooking`, so nothing new is threaded through.
     *
     * ⛔ `prof.id` IS THE SUBJECT, ⛔ never `prof.user_id` — that is the
     * ACCOUNT, shared across every profile on it.
     */
    await answerOpenRequests(supabase, {
      event,
      member: { id: memberData.id, artist_profile_id: prof.id, artist_id: prof.user_id },
      notify: writeNotification,
    });
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
    /* ⛔ Same gate, same reason as `fillFromProfile`. ⚠ A hand-typed act IS
       bookable on a managed event once on the bill (nobody can accept for them,
       see `canPlaceMember`), but ⛔ the SLOT still may not be what books them:
       the bill decision comes first, and it is not made from this sheet. */
    if (!canBookByPlacing) {
      setErr('This event books artists by offering them a place and waiting for them to accept, so a set time cannot add somebody new. Add them to the lineup first.');
      return;
    }
    setBusy(true);
    setErr(null);
    /* ⚠ ALWAYS a new member — a typed-in name has no row to reuse, so this path
       always grows the bill and is always subject to the cap. */
    if (!await billHasRoom()) return;
    const { data: memberData } = await supabase.from('lineup_members').insert({
      event_id: eventId, artist_name: name.trim(), status: 'on_bill',
    }).select('id').single();
    /**
     * ⛔ NO `answerOpenRequests` CALL HERE, AND THAT IS NOT AN OVERSIGHT. This
     * row carries no `artist_profile_id` by construction — a hand-typed act has
     * no profile and no account — and the profile is the ONLY key a request may
     * be matched on (`requestSubjectId`; the account is shared and the name is
     * not unique). So the call could only ever be a no-op.
     *
     * ⛔ Never "fix" this by matching on the typed NAME. Two acts legitimately
     * share one, and resolving somebody else's application because the letters
     * agree is a far worse failure than the one being closed.
     */
    /* ⚠ `accepted`, ⛔ not `draft` — a hand-entered act has no account to offer
       anything to, so writing them down IS the booking. Same rule `toClaim`
       states for display. */
    const { ok, error } = await assignMemberToSlot(supabase, {
      slotId: slot.id, eventId, memberId: memberData.id, status: 'accepted',
    });
    setBusy(false);
    if (ok) onFilled(); else setErr(error);
  }

  /**
   * ⭐⭐ ONLY ARTISTS WHO CAN LEGITIMATELY BE SCHEDULED (ratified 2026-08-17).
   *
   * ⛔⛔ SET TIMES DOES NOT BOOK. A member entry qualifies only when it is
   * BOOKED, and `entry.booked` is already `isBooked` computed under this event's
   * contract by `lib/shortlist` — ⛔ so no second opinion is formed here.
   *
   * ⚠⚠ THIS IS THE DOOR BVP CAME THROUGH. They were listed because they were on
   * the shortlist, picked because the row looked selectable, and placed because
   * nothing downstream checked. `assignMemberToSlot` now refuses it outright;
   * this stops the host being offered a choice that will be refused.
   *
   * ⚠ An APPLICATION is not booked either, and on a managed event it cannot be
   * booked by being scheduled — so it is only offered where writing somebody
   * down has always been the booking. ⛔ Grandfathered behaviour preserved on
   * legacy and imported; ⛔ the confirmation contract preserved on managed.
   */
  const placeable = shortlist.filter(e => e.kind === 'member' ? !!e.booked : canBookByPlacing);

  /* ⚠ Filters on the ENTRY, and reads the name the same way the row renders it —
     a filter that looks somewhere else than the label is a filter that hides
     rows the host can see. */
  const filtered = placeable.filter(e => {
    const prof = shortlistProfiles[e.id];
    return (prof?.name || e.row?.artist_name || '').toLowerCase().includes(filter.toLowerCase());
  });

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
                /* ⚠⚠ THE COUNT IS WHAT THE LIST WILL ACTUALLY SHOW. Counting
                   the whole shortlist promised five and delivered one, and a
                   number that disagrees with its own list is worse than none. */
                label={`ARTISTS FOR THIS SLOT${placeable.length ? ` (${placeable.length})` : ''}`}
                sub="Booked artists who still need a set time"
                accent
                disabled={placeable.length === 0}
                onClick={() => setView('accepted')}
              />
              <MenuOption
                label="SEARCH YESPLEEZ"
                sub="Find any artist on the platform"
                onClick={() => setView('search')}
              />
              <MenuOption
                label="NOT ON YESPLEEZ YET"
                /* ⛔ WAS "send an invite via email or SMS" — a send path that does
                   not exist and that this platform has ratified it will never
                   build. See the manual view. */
                sub="Add them by name, then copy an invite to send yourself"
                onClick={() => setView('manual')}
              />
              {/**
                * ⭐⭐ NOT EVERY SLOT IS AN ACT (owner, 2026-08-28). A welcome to
                * country, the doors opening, a stage closing — the time is
                * SPOKEN FOR, and SlotCard has always known how to draw that:
                * `event_slots.label` is what "STAGE CLOSE" and "WELCOME TO
                * COUNTRY / CHOIR" already render from on Neverland.
                *
                * ⚠⚠ NOTHING IN THE APP HAS EVER WRITTEN THAT COLUMN. Every
                * label in production arrived through the importer, so a host
                * building an event by hand could not mark a moment at all —
                * their only options were three flavours of "book an artist".
                */}
              <MenuOption
                label="MARK THE TIME"
                sub="Welcome to Country, stage open or close, or your own words"
                onClick={() => setView('label')}
              />
            </div>
          )}

          {/* MARK THE TIME */}
          {view === 'label' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/**
                * ⭐ THE PRESETS ARE A HEAD START, ⛔ not a closed vocabulary.
                * They are the three that recur on real running orders, and the
                * free field beneath is the actual feature — an organiser's
                * event says whatever their event says. ⛔ Do not turn this into
                * an enum: the moment it is one, "Smoking Ceremony" and "Kids'
                * Disco" become impossible.
                */}
              {['Welcome to Country', 'Stage open', 'Stage close'].map(preset => (
                <MenuOption
                  key={preset}
                  label={preset.toUpperCase()}
                  sub="Marks the time on the running order"
                  disabled={busy}
                  onClick={() => saveLabel(preset)}
                />
              ))}

              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, letterSpacing: 1, fontFamily: "'Bebas Neue'" }}>
                  OR YOUR OWN WORDS
                </div>
                <input
                  value={labelText}
                  onChange={e => setLabelText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && labelText.trim()) saveLabel(labelText); }}
                  placeholder="e.g. Smoking ceremony, Doors, Raffle draw"
                  maxLength={60}
                  style={{
                    width: '100%', boxSizing: 'border-box', background: 'var(--card2)',
                    border: '1px solid var(--border)', borderRadius: 10, padding: '11px 13px',
                    color: 'var(--text)', fontSize: 14, outline: 'none',
                  }}
                />
                <button
                  onClick={() => saveLabel(labelText)}
                  /* ⛔ A blank label is not a marker, it is an empty slot that
                     LOOKS filled — the one outcome this must not produce. */
                  disabled={busy || !labelText.trim()}
                  style={{
                    marginTop: 10, width: '100%', padding: '12px', borderRadius: 10, border: 'none',
                    cursor: busy || !labelText.trim() ? 'default' : 'pointer',
                    opacity: busy || !labelText.trim() ? 0.4 : 1,
                    fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.4, color: '#0a0a0f',
                    background: 'linear-gradient(135deg, var(--neon2), var(--purple))',
                  }}
                >
                  MARK THIS SLOT
                </button>
              </div>
            </div>
          )}

          {/* ACCEPTED LIST */}
          {view === 'accepted' && (
            <div>
              <SearchInput value={filter} onChange={setFilter} placeholder="Filter artists…" />
              {filtered.length === 0
                /* ⚠ Says WHY the list is short, ⛔ not merely that it is. A host
                   looking for somebody they can see on the shortlist needs to
                   know the lineup comes first. */
                ? <Empty>{filter ? 'No booked artists match.' : 'Nobody is booked and waiting for a set time. Add an artist to the lineup first.'}</Empty>
                : filtered.map(e => {
                    const app  = e.row || {};
                    const prof = shortlistProfiles[e.id] || {};
                    const n    = prof.name || app.artist_name || 'Unknown';
                    return (
                      <ArtistRow
                        key={e.id}
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
                        /* ⭐⭐ THE FORK. A member is PLACED; an applicant is made
                           a member and then placed. ⛔ One handler for both is
                           what created a second `luc`. */
                        onSelect={() => e.kind === 'member'
                          ? fillFromMember(app)
                          : fillFromProfile({ id: prof.id, user_id: app.artist_id, name: n, sound: prof.sound, genre_string: prof.genre_string })}
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
              {/**
                * ⛔⛔ THE EMAIL AND PHONE FIELDS ARE GONE, AND SO IS THE PROMISE.
                *
                * ⚠⚠ THEY WERE COLLECTED AND DISCARDED. `fillManual` inserted
                * `event_id, artist_name, status` and ⛔ NEVER READ `email` or
                * `phone` — nothing was sent, nothing was even stored. The sheet
                * said "An invite will be sent" and the button said "FILL SLOT +
                * SEND INVITE", so the host believed the artist had been told.
                * ⛔ A promise the app cannot keep is worse than a missing
                * feature: the artist is never contacted and nobody finds out.
                *
                * ⛔⛔ AND IT IS A PROMISE THIS PLATFORM HAS RATIFIED IT WILL
                * NEVER KEEP. Phone Discovery §6, restated in `InviteRows`:
                * **YesPleez does not send messages on a user's behalf, ever.**
                * So the fix is ⛔ not to wire up a mailer — it is to hand off,
                * exactly as every other invite in the app does: the message is
                * sent BY the host, FROM their own app, with them looking at it.
                */}
              <Field label="DJ / ARTIST NAME *" value={name} onChange={setName} placeholder="e.g. DJ Flames" />
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>
                They go straight onto the slot. Nobody is contacted automatically.
                {' '}You can copy an invite to send them yourself once they are on.
              </p>
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
                {busy ? 'SAVING…' : 'FILL SLOT'}
              </button>

              {/**
                * ⭐⭐ THE COPY-TO-PASTE PATH (owner, 2026-08-17: "this should be
                * a copy to paste in a text").
                *
                * ⚠ Native share where the OS has one, clipboard where it does
                * not, and it SAYS which it did — a control that appears to do
                * nothing is worse than one that admits it copied. ⛔ A cancelled
                * share sheet must NOT fall through to copying; dismissing a
                * share is not a request to put something on the clipboard.
                *
                * ⛔ Share mechanics come from `lib/shareTarget`, ⛔ never a
                * second implementation here — the same rule `InviteRows` states.
                */}
              {/**
                * ⛔⛔ THE OFFER IS FOR THE EVENT, ⛔ NOT THIS SLOT (owner,
                * 2026-08-17). V1 minted a claim code locked to one slot; that
                * is dropped deliberately — see `lib/eventOffer`. A link that
                * promises the 9pm slot cannot stay true while the host is still
                * moving the running order around.
                *
                * ⚠ `copyMessage`, ⛔ not `copyLink`. A bare URL from a number
                * they may not recognise is not an offer; the composed text is.
                */}
              <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 12, padding: 12 }}>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.4, color: 'var(--muted)', marginBottom: 7 }}>
                  SEND THEM AN INVITE
                </div>
                {/* ⭐ THE MESSAGE IS SHOWN BEFORE IT IS SENT — V1 did this and it
                    is the whole reason the flow is trustworthy: the host reads
                    exactly what the artist will read. ⛔ Never a silent copy. */}
                <p style={{ fontSize: 11.5, color: 'var(--text)', margin: '0 0 9px', lineHeight: 1.55, whiteSpace: 'pre-wrap', opacity: .8 }}>
                  {offerMessage(offerArgs)}
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    const target = offerTarget(offerArgs);
                    /* ⚠ Native first where it exists, and a CANCEL must not fall
                       through to copying — dismissing a share sheet is not a
                       request to put something on the clipboard. */
                    if (canNativeShare()) { await nativeShare(target); return; }
                    if (await copyMessage(target)) {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    }
                  }}
                  style={{ width: '100%', padding: '10px 0', borderRadius: 10, cursor: 'pointer', fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5, border: '1px solid rgba(0,229,255,.35)', background: 'rgba(0,229,255,.06)', color: 'var(--neon2)' }}
                >
                  {copied ? 'COPIED' : canNativeShare() ? 'SHARE INVITE' : 'COPY INVITE'}
                </button>
                <p style={{ fontSize: 10, color: 'var(--muted)', margin: '7px 0 0', lineHeight: 1.5 }}>
                  Paste it into a text, Messenger, Instagram, wherever you already talk to them.
                </p>
              </div>
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
