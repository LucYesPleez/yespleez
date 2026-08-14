import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { writeNotification } from '../lib/writeNotification';
import { resolveProfileId } from '../lib/resolveProfileId';
import { formatLocation } from '../lib/formatLocation';
import { profileIdentity } from '../lib/profileTypes';
import ArtistPicker from './ArtistPicker';

const SLOT_ROLES = ['Opener', 'Support', 'Headline'];
const DURATIONS  = [30, 45, 60, 90, 120];
const EXTRAS     = ['Accommodation', 'Meals', 'Travel'];
const HOLD_PRESETS = [{ label: '1 WEEK', days: 7 }, { label: '2 WEEKS', days: 14 }, { label: '1 MONTH', days: 30 }];

// Local YYYY-MM-DD for "n days from today" — used by the HOLD-THE-SPOT quick
// presets. Built from local getFullYear/Month/Date (not toISOString/UTC) so the
// deadline can't roll a day near midnight in AU time.
const dateInDays = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Turn "20:00" + 60min into "8:00–9:00pm" for the live preview / card facts.
function fmtSlot(startHHMM, durationMin) {
  if (!startHHMM) return '';
  const fmt = d => d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined }).replace(' ', '').toLowerCase();
  const start = new Date(`2000-01-01T${startHHMM}`);
  if (!durationMin) return fmt(start);
  const end = new Date(start.getTime() + durationMin * 60000);
  return `${fmt(start)}–${fmt(end)}`;
}

/**
 * ⭐ `venueProfileId` is PASSED IN, and the applicant's profile id is taken from
 * the `artist` row itself. Both used to be looked up with
 * `resolveProfileId(user_id, type)`, which returns null whenever the account is
 * unknown — and an UNCLAIMED artist has no `user_id` at all, which is what
 * unclaimed means. So inviting exactly the acts a venue is most likely to
 * discover produced a row with no applicant profile on it.
 *
 * The callers already hold both ids (VenueDashboard's `profile.id`,
 * ProfileScreen's `venueCtx.id`, and the artist row being invited), so the
 * lookup was converting known facts into unknown ones.
 *
 * ⚠ This matters beyond tidiness: `venue_enquiries.applicant_profile_id` is
 * about to become NOT NULL and part of the uniqueness key, so a null here stops
 * being an incomplete row and becomes a rejected write.
 */
export default function InviteSheet({ artist, events = [], venueUserId, venueProfileId = null, venueProfiles = null, initialDate = '', onClose }) {
  const navigate = useNavigate();
  /**
   * ── ⭐⭐ WHO IS SENDING THIS OFFER — STATED, ALWAYS (owner, 2026-08-14:
   * "must always know whos sending the offer") ─────────────────────────
   *
   * ⚠ U4, THE APP'S EXISTING RULE, APPLIED TO THE ONE PATH THAT SKIPPED IT.
   * Messaging (`MessageAsSheet`) and the ASK path (ProfileScreen's date
   * picker) both infer the acting profile only when there is exactly one
   * candidate and ask otherwise. This sheet used to take a single id from its
   * caller and never say what it was — the offer went out signed by a profile
   * the sender was never shown.
   *
   * ⚠ ONE OWNER MAY RUN SEVERAL VENUES, and that is a supported shape, not an
   * edge case: different rooms, different projects, different promotional
   * hosts all live under one login. `venueProfiles` is therefore a LIST.
   * ProfileScreen previously resolved it with `.maybeSingle()`, which errors
   * on more than one row — so an owner with two venues got no invite button at
   * all, silently. The list is what fixes that, not a bigger limit.
   *
   * ⛔ NULL IS NOT "PICK ONE FOR THEM". With several candidates and none
   * chosen, `canSend` stays false: an offer carries a booking commitment from
   * a named room, so guessing which is worse than asking.
   */
  const senderOptions = venueProfiles?.length
    ? venueProfiles
    : (venueProfileId ? [{ id: venueProfileId, name: null }] : []);
  const [senderId, setSenderId] = useState(
    senderOptions.length === 1 ? senderOptions[0].id : (venueProfiles?.length ? '' : venueProfileId || '')
  );
  const [eventId,   setEventId]   = useState('');
  /* ⚠ TEXT, AND ONLY TEXT (owner, 2026-08-14). ArtistPicker below searches
     real profiles so the promoter can find the act and get the name right,
     but nothing about that match is stored: `headliner` is a name, the same
     column it has always been.

     ⛔ DO NOT ADD A PROFILE ID HERE without asking. It was proposed and
     declined. The consequence is deliberate and worth knowing: the offer the
     artist receives carries the NAME, so their copy cannot render a linked
     card. ⛔ And it must not be faked by matching the name at read time —
     names collide and acts rename, so that card would eventually point at the
     wrong person with no way to notice. */
  const [headliner, setHeadliner] = useState('');
  const [message,   setMessage]   = useState('');
  const [slotRole,  setSlotRole]  = useState('');
  // initialDate prefills the proposed date when the sheet is opened by tapping
  // a date on the performer's availability calendar (11C.3 revision). Still
  // fully editable via the DATE field below.
  const [date,      setDate]      = useState(initialDate || '');
  const [time,      setTime]      = useState('');
  const [duration,  setDuration]  = useState('');
  const [fee,       setFee]       = useState('');
  const [extras,    setExtras]    = useState(new Set());
  const [respondBy, setRespondBy] = useState('');
  const [sending,   setSending]   = useState(false);
  const [sent,      setSent]      = useState(false);
  const [error,     setError]     = useState('');

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const selectedEvent = events.find(e => e.id === eventId);

  // Prefill the date from the chosen event (still overridable) — one less thing
  // to type, and it keeps the invite's date honest to the event.
  useEffect(() => {
    if (selectedEvent?.config?.date && !date) setDate(selectedEvent.config.date);
  }, [eventId]);

  function toggleExtra(x) {
    setExtras(prev => {
      const next = new Set(prev);
      next.has(x) ? next.delete(x) : next.add(x);
      return next;
    });
  }

  async function handleSend() {
    setSending(true);
    setError('');
    /**
     * ⭐ Known facts, not lookups. `artist.id` IS the profile being invited —
     * the caller opened this sheet from that row. The venue's profile id comes
     * from the caller for the same reason.
     *
     * ⚠ The account-keyed fallbacks remain ONLY for a caller that has not been
     * updated, and they are the old failure mode: `resolveProfileId` returns
     * null for an unclaimed artist (no `user_id`), so the fallback cannot
     * rescue the case that actually broke. It exists so an un-migrated caller
     * degrades rather than throws.
     */
    const [resolvedVenueId, resolvedApplicantId] = await Promise.all([
      // ⚠ THE CHOSEN SENDER FIRST — it is the only one the user was shown.
      senderId ? Promise.resolve(senderId)
        : venueProfileId ? Promise.resolve(venueProfileId) : resolveProfileId(venueUserId, 'venue'),
      artist?.id     ? Promise.resolve(artist.id)     : resolveProfileId(artist?.user_id, artist?.type || 'artist'),
    ]);
    const venueProfileIdFinal = resolvedVenueId;
    const applicantProfileId  = resolvedApplicantId;

    /**
     * ⛔ REFUSE RATHER THAN WRITE AN UNATTRIBUTED ROW. An enquiry with no
     * applicant profile cannot be shown on the artist's dashboard (it reads by
     * `applicant_profile_id`), cannot be deduplicated once uniqueness moves to
     * profile identity, and is the row shape M6c exists to clean up. Saying so
     * beats creating one silently.
     */
    if (!applicantProfileId) {
      setSending(false);
      setError("That act has no profile to invite yet. Ask them to set one up, or invite them from their profile page.");
      return;
    }
    // Every key here is a real column (verified against the live schema,
    // 2026-07-17). Names match the table, not the UI's vocabulary:
    //   date_requested — the proposed date. NOT NULL, no default: the insert
    //                    fails with 23502 without it. The old payload sent
    //                    `proposed_date`, which never existed, and omitted this
    //                    entirely. Renaming the field is NOT sufficient on its
    //                    own — `date` is optional in the form, so the value can
    //                    still be null; `canSend` is what actually guarantees
    //                    the constraint is met.
    //   note           — the message body. The column has always been `note`.
    //   initiated_by   — absolute, not viewer-relative. 'venue' here because
    //                    this sheet is the venue inviting an artist.
    // applicant_name/event_name are deliberately NOT stored — both are derived
    // from applicant_profile_id / event_id at read time.
    const payload = {
      venue_user_id:    venueUserId,
      applicant_user_id: artist.user_id,
      applicant_type:   artist.type || 'artist',
      event_id:         eventId && eventId !== '__new__' ? eventId : null,
      date_requested:   date || null,
      proposed_time:    time || null,
      proposed_fee:     fee.trim() || null,
      note:             message.trim() || null,
      initiated_by:     'venue',
      status:           'pending',
      venue_profile_id:     venueProfileIdFinal,
      applicant_profile_id: applicantProfileId,
      headliner:        headliner.trim() || null,
      slot_role:        slotRole || null,
      set_duration:     duration ? parseInt(duration) : null,
      extras:           extras.size ? [...extras] : null,
      respond_by:       respondBy || null,
    };
    const { error: err } = await supabase.from('venue_enquiries').insert(payload);
    setSending(false);
    if (err) {
      // Surface the real reason. This flow has been silently broken more than
      // once behind "Something went wrong" — most recently a 42501 from the
      // applicant-side-only INSERT policy (S4), which is expected until M6
      // replaces it with can_act_as().
      console.error('venue_enquiries insert failed:', err.code, err.message, err.details, err.hint);
      setError(
        err.code === '42501'
          ? "Venues can't send invites yet — this is a known limitation."
          : `Couldn't send the invite (${err.code || 'error'}). Please try again.`
      );
      return;
    }
    // Notify the artist
    // §A7 identities. Both are already resolved above for the enquiry row —
    // reuse them rather than inferring. These are the profiles the invite was
    // actually addressed between, which beats anything U4 could derive.
    await writeNotification({
      toUserId:       artist.user_id,      // delivery
      toProfileId:    applicantProfileId,  // the invited profile
      aboutProfileId: venueProfileIdFinal, // the venue doing the inviting
      type:    'event_invite',
      message: `You've received an invite to perform${selectedEvent ? ` at ${selectedEvent.name}` : ''}.`,
      data:    { event_id: eventId || null, event_name: selectedEvent?.name || null, host_id: venueUserId, proposed_date: date || null, proposed_fee: fee || null },
    });
    setSent(true);
  }

  const sound  = artist.sound || artist.genre_string?.split(' · ').slice(0, 3).join(' · ') || '';
  const loc    = formatLocation(artist);
  const img    = artist.avatar_thumb || artist.avatar || null;

  // 10F (S35): all four identity values come from one resolver. This screen used
  // to derive `accent` from the token and then infer everything else from it with
  // `accent === '#00E5FF' ? cyan : pink` — a TWO-way test for FIVE types. Every
  // non-artist fell to the else branch, so a Band (#FFB830) rendered orange
  // borders on pink fills with an orange->pink SEND button, and Host's rgb came
  // out as #FF3399's rather than its own. rgb/accent2 were on the token the whole
  // time; the ternary was inferring what it could have looked up.
  const pt         = profileIdentity(artist.type);
  const accent     = pt.accent;
  const accentRgb  = pt.rgb;
  const accent2    = pt.accent2;

  // Always the full name — these are act names, not people's names. Splitting
  // "Daddy Longlegs" to a first word gives you "Hey Daddy", which is nonsense.
  const actName    = (artist.name || '').trim();
  const slotLabel  = fmtSlot(time, duration ? parseInt(duration) : null);
  const extrasList = [...extras];
  // Enough of a pitch to be worth sending — the message is the one thing a
  // form can't fake, so it's the only hard requirement here.
  // `date` is required, not optional polish: it maps to venue_enquiries
  // .date_requested, which is NOT NULL with no default, so sending without one
  // is a guaranteed 23502. Gating here rather than failing at the insert. The
  // DATE field prefills from the selected event, so picking an event satisfies
  // this without extra typing.
  /* ⚠ `senderId` JOINS THE REQUIRED SET. The offer names a room and commits
     it; with several to choose from and none chosen there is no honest value
     to write, and S2's RLS would reject the guess anyway (can_act_as of the
     wrong profile). Refusing here says so before the round trip. */
  const canSend    = message.trim().length > 0 && !!date && !!senderId && !sending;

  const labelStyle = { fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5, color: 'rgba(255,255,255,.6)', display: 'block', marginBottom: 8 };
  const subLabel   = { fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: 'rgba(255,255,255,.45)', display: 'block', marginBottom: 5 };
  const inputStyle = { width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, padding: '10px 12px', color: '#fff', fontFamily: "'DM Sans',sans-serif", fontSize: 13, outline: 'none' };
  const sectionGap = { marginBottom: 22 };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)', zIndex: 9000, display: 'flex', alignItems: 'flex-end', paddingBottom: 'var(--yp-safe-bottom)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="yp-invite-sheet"
        style={{ width: '100%', maxWidth: 680, margin: '0 auto', background: '#13131a', borderRadius: '20px 20px 0 0', borderTop: `2px solid ${accent}`, paddingBottom: 'env(safe-area-inset-bottom,0)', maxHeight: 'calc(92vh - 67px)', overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <style>{`.yp-invite-sheet::-webkit-scrollbar{display:none}`}</style>
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.15)' }} />
        </div>

        <div style={{ padding: '16px 20px 32px' }}>

          {sent ? (
            /* ── Success state ── */
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 26, letterSpacing: 2, color: '#fff', marginBottom: 6 }}>INVITE SENT</div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,.55)', marginBottom: 28 }}>{artist.name} has been notified.</div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => { onClose(); navigate('/venue?section=enquiries&dir=OUTGOING&status=NEW'); }}
                  style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, padding: '10px 24px', borderRadius: 10, border: `1px solid ${accent}`, background: `rgba(${accentRgb},.12)`, color: accent, cursor: 'pointer' }}
                >VIEW OUTGOING ENQUIRIES</button>
                <button
                  onClick={onClose}
                  style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, padding: '10px 24px', borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'none', color: 'rgba(255,255,255,.5)', cursor: 'pointer' }}
                >DISMISS</button>
              </div>
            </div>
          ) : (
            <>
              {/* ── Header ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                <div>
                  <div style={{ fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: 2, color: '#fff' }}>INVITE ARTIST</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', letterSpacing: 1, marginTop: 1 }}>MAKE THEM A BOOKING OFFER</div>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 4 }}>✕</button>
              </div>

              {/* ── ⭐ SENDING AS — the sender's own identity, stated on every
                     offer (owner, 2026-08-14). Above the artist chip, because
                     the order of the two answers the two halves of "who is
                     asking whom" in reading order.

                     ⚠ IT RENDERS WITH ONE OPTION TOO, as a plain line. The
                     point is not to offer a choice, it is to remove the
                     question — an owner of one venue still deserves to know
                     which name is on the offer. ⛔ Do not hide it when the
                     answer is obvious; obvious to us is not stated to them.

                     ⚠ RADIO ROWS, NOT A <select>, when there are several. The
                     app uses pickers for consequential identity choices
                     (MessageAsSheet's select-then-confirm), and a collapsed
                     native menu shows one option while hiding that a choice
                     exists at all. ── */}
              {senderOptions.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: 'rgba(255,255,255,.45)', marginBottom: 6 }}>SENDING AS</div>
                  {senderOptions.length === 1 ? (
                    <div style={{ fontSize: 13.5, color: '#fff' }}>
                      {senderOptions[0].name || 'Your venue'}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {senderOptions.map(v => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setSenderId(v.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                            padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                            background: senderId === v.id ? `rgba(${accentRgb},.12)` : 'rgba(255,255,255,.04)',
                            border: `1px solid ${senderId === v.id ? accent : 'rgba(255,255,255,.1)'}`,
                            color: '#fff', fontSize: 13.5,
                          }}
                        >
                          <span style={{
                            width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                            border: `2px solid ${senderId === v.id ? accent : 'rgba(255,255,255,.3)'}`,
                            background: senderId === v.id ? accent : 'transparent',
                          }} />
                          {v.name || 'Unnamed venue'}
                        </button>
                      ))}
                      {!senderId && (
                        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.45)' }}>
                          Choose which venue this offer comes from.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Artist chip ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, padding: '10px 14px', marginBottom: 18 }}>
                {img
                  ? <img src={img} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', objectPosition: 'center top', border: `1.5px solid ${accent}`, flexShrink: 0 }} />
                  : <div style={{ width: 44, height: 44, borderRadius: 8, background: `rgba(0,229,255,.1)`, border: `1.5px solid ${accent}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🎧</div>
                }
                <div>
                  <div style={{ fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: 1, color: '#fff' }}>{artist.name}</div>
                  {(sound || loc) && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>{[sound, loc].filter(Boolean).join(' • ')}</div>}
                </div>
              </div>

              {/* ── LIVE PREVIEW — what the artist will actually receive.
                    Builds itself as the promoter types; a thin pitch reads thin,
                    which nudges them to fill the gaps without a single mandatory
                    field. ── */}
              <div style={{ border: `1px solid rgba(${accentRgb},.3)`, borderRadius: 12, padding: '14px 16px', marginBottom: 24, background: 'rgba(255,255,255,.02)' }}>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.5, color: accent, marginBottom: 10 }}>{actName ? `WHAT ${actName.toUpperCase()} WILL SEE` : 'WHAT THEY WILL SEE'}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.65, color: '#fff' }}>
                  <span style={{ fontWeight: 600 }}>Hey {actName || 'there'} — </span>
                  {message.trim()
                    ? message.trim()
                    : <span style={{ color: 'rgba(255,255,255,.3)', fontStyle: 'italic' }}>your pitch appears here as you write it…</span>}
                </div>
                {(slotLabel || slotRole || fee || extrasList.length > 0 || headliner) && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.08)', fontSize: 12.5, color: 'rgba(255,255,255,.7)', lineHeight: 1.7 }}>
                    {selectedEvent && <div>{selectedEvent.name}{date ? ` · ${new Date(date + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}</div>}
                    {/* ⛔ NO "Headlining:" PREFIX — it is implied by naming
                        them at all (owner, 2026-08-14). Just the act. */}
                    {headliner && <div style={{ color: '#fff' }}>{headliner}</div>}
                    {(slotRole || slotLabel) && <div>Your slot: <span style={{ color: '#fff' }}>{[slotRole, slotLabel].filter(Boolean).join(' · ')}</span></div>}
                    {(fee || extrasList.length > 0) && <div>Offer: <span style={{ color: '#00E5A0' }}>{[fee, ...extrasList].filter(Boolean).join(' + ')}</span></div>}
                  </div>
                )}
              </div>

              {/* ══ THE NIGHT ══ */}
              <div style={sectionGap}>
                <label style={labelStyle}>WHICH EVENT?</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {events.slice(0, 6).map(ev => (
                    <label key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: eventId === ev.id ? `rgba(${accentRgb},.1)` : 'rgba(255,255,255,.04)', border: `1px solid ${eventId === ev.id ? accent : 'rgba(255,255,255,.1)'}`, borderRadius: 10, padding: '10px 14px', cursor: 'pointer', transition: 'all .15s' }}>
                      <input type="radio" name="invite-event" value={ev.id} checked={eventId === ev.id} onChange={() => setEventId(ev.id)} style={{ accentColor: accent, flexShrink: 0 }} />
                      <span style={{ fontFamily: "'DM Sans'", fontSize: 13, color: '#fff' }}>{ev.name}</span>
                      {ev.config?.date && <span style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginLeft: 'auto' }}>{ev.config.date}</span>}
                    </label>
                  ))}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, background: eventId === '__new__' ? 'rgba(0,229,160,.08)' : 'rgba(255,255,255,.04)', border: `1px solid ${eventId === '__new__' ? '#00E5A0' : 'rgba(255,255,255,.1)'}`, borderRadius: 10, padding: '10px 14px', cursor: 'pointer', transition: 'all .15s' }}>
                    <input type="radio" name="invite-event" value="__new__" checked={eventId === '__new__'} onChange={() => setEventId('__new__')} style={{ accentColor: '#00E5A0', flexShrink: 0 }} />
                    <span style={{ fontFamily: "'DM Sans'", fontSize: 13, color: 'rgba(255,255,255,.6)' }}>+ Create New Event</span>
                  </label>
                </div>
                <div style={{ marginTop: 12 }}>
                  {/* ⛔ NOT "WHO'S HEADLINING" ANY MORE (owner, 2026-08-14):
                      naming an act in the pull already implies the draw, and
                      the old label made a claim about billing order the
                      promoter had not necessarily made. */}
                  <label style={subLabel}>WHO ELSE IS PLAYING <span style={{ opacity: .6 }}>(the pull)</span></label>
                  {/* ⚠ A TYPEAHEAD, NOT A LINK. Picking a result fills the
                      NAME and nothing else — see the state declaration for why
                      no id is stored. */}
                  <ArtistPicker
                    value={headliner}
                    onChange={(name) => setHeadliner(name)}
                    placeholder="e.g. Flowidus"
                  />
                </div>
              </div>

              {/* ══ YOUR PITCH ══ */}
              <div style={sectionGap}>
                <label style={labelStyle}>YOUR PITCH <span style={{ opacity: .5, fontSize: 11 }}>— WHY THEM?</span></label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder={`Talk to ${actName || 'them'} like a person. What's the night about, and why do you want them on it? "We've been deep in your recent mixes — that rolling jungle sound is exactly the energy we want to open the room…"`}
                  rows={4}
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                />
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 6 }}>This is the one thing that turns an invite into a real offer. Make it personal.</div>
              </div>

              {/* ══ THE SLOT ══ */}
              <div style={sectionGap}>
                <label style={labelStyle}>THE SLOT</label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                  {SLOT_ROLES.map(r => (
                    <button key={r} type="button" onClick={() => setSlotRole(slotRole === r ? '' : r)}
                      style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1, padding: '7px 16px', borderRadius: 20, cursor: 'pointer', transition: 'all .15s',
                        background: slotRole === r ? `rgba(${accentRgb},.15)` : 'rgba(255,255,255,.04)',
                        border: `1px solid ${slotRole === r ? accent : 'rgba(255,255,255,.12)'}`,
                        color: slotRole === r ? accent : 'rgba(255,255,255,.6)' }}>{r}</button>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={subLabel}>DATE</label>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark' }} />
                  </div>
                  <div>
                    <label style={subLabel}>START</label>
                    <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark' }} />
                  </div>
                  <div>
                    <label style={subLabel}>LENGTH</label>
                    <select value={duration} onChange={e => setDuration(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark', color: duration ? '#fff' : 'rgba(255,255,255,.35)' }}>
                      <option value="">—</option>
                      {DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* ══ THE OFFER ══ */}
              <div style={sectionGap}>
                <label style={labelStyle}>THE OFFER</label>
                <input type="text" value={fee} onChange={e => setFee(e.target.value)} placeholder="e.g. $900, or $300 + door split" style={{ ...inputStyle, marginBottom: 10 }} />
                <label style={subLabel}>WHAT'S COVERED</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {EXTRAS.map(x => (
                    <button key={x} type="button" onClick={() => toggleExtra(x)}
                      style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1, padding: '7px 16px', borderRadius: 20, cursor: 'pointer', transition: 'all .15s',
                        background: extras.has(x) ? 'rgba(0,229,160,.12)' : 'rgba(255,255,255,.04)',
                        border: `1px solid ${extras.has(x) ? '#00E5A0' : 'rgba(255,255,255,.12)'}`,
                        color: extras.has(x) ? '#00E5A0' : 'rgba(255,255,255,.6)' }}>
                      {extras.has(x) ? '✓ ' : '+ '}{x}
                    </button>
                  ))}
                </div>
              </div>

              {/* ══ HOLDING THE SPOT ══ */}
              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>HOLD THE SPOT UNTIL <span style={{ opacity: .5, fontSize: 11 }}>(OPTIONAL)</span></label>
                {/* Quick-set presets — one tap sets the deadline without typing
                    (date-picker design principle). Tap again to clear. */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  {HOLD_PRESETS.map(p => {
                    const d  = dateInDays(p.days);
                    const on = respondBy === d;
                    return (
                      <button key={p.label} type="button" onClick={() => setRespondBy(on ? '' : d)}
                        style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1, padding: '7px 16px', borderRadius: 20, cursor: 'pointer', transition: 'all .15s',
                          background: on ? `rgba(${accentRgb},.15)` : 'rgba(255,255,255,.04)',
                          border: `1px solid ${on ? accent : 'rgba(255,255,255,.12)'}`,
                          color: on ? accent : 'rgba(255,255,255,.6)' }}>{p.label}</button>
                    );
                  })}
                </div>
                <input type="date" value={respondBy} onChange={e => setRespondBy(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark' }} />
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 6 }}>Gives {actName || 'them'} an honest deadline — and keeps your night moving.</div>
              </div>

              {error && <div style={{ fontSize: 13, color: '#ff6b6b', marginBottom: 12 }}>{error}</div>}

              {/* ── Send button ── */}
              <button
                onClick={handleSend}
                disabled={!canSend}
                style={{ width: '100%', fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: 2, padding: '14px', borderRadius: 12, border: 'none', background: !canSend ? 'rgba(255,255,255,.08)' : `linear-gradient(135deg, ${accent}, ${accent2})`, color: !canSend ? 'rgba(255,255,255,.35)' : '#0a0a14', cursor: !canSend ? 'not-allowed' : 'pointer', transition: 'opacity .15s', fontWeight: 700 }}
              >{sending ? 'SENDING…' : 'SEND INVITATION'}</button>
              {!message.trim() && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginTop: 8, textAlign: 'center' }}>Add a pitch to send</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
