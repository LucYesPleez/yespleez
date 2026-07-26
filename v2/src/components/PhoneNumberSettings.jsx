import { useState, useEffect, useRef } from 'react';
import {
  myPhoneKey,
  setPhoneKey,
  removePhoneKey,
  setPhoneVisibility,
  findByPhone,
} from '../lib/phoneKey';
import { COUNTRIES, DEFAULT_COUNTRY, formatDisplay, toE164 } from '../lib/phoneNumber';
import { sendableProfiles, openDirectConversation } from '../lib/messaging';
import { useConversationUi } from '../lib/conversationUi';
import MessageAsSheet from './MessageAsSheet';
import MessengerAvatar from './MessengerAvatar';
import s from './NotificationPreferences.module.css';

/**
 * P1 · "Find me by phone number" — the whole account-facing surface.
 *
 * Lives inside Messages rather than a settings section, following NP1: the
 * control belongs where someone goes when they want to change this, and the
 * app has no settings screen. Same reasoning that put notification
 * preferences on the notifications screen.
 *
 * ⚠ THE NUMBER IS NOT RECOVERABLE AND THIS SCREEN DOES NOT PRETEND OTHERWISE.
 * What the database holds is an HMAC — one-way — so there is no "reveal my
 * number" affordance, because there is nothing to reveal. `last3` exists only
 * so this panel can say WHICH number is registered. The design's masked value
 * with an eye icon was dropped once that became clear.
 *
 * ⚠ A NUMBER CLAIM CONFERS NOTHING. There is deliberately no "Verified" tick
 * anywhere in here: nothing verifies the number, and a badge saying otherwise
 * would be the single most damaging element in the product.
 */

const VISIBILITY = [
  {
    value: 'everyone',
    label: 'Everyone',
    desc: 'Anyone who has your number can find you here. Best for meeting the wider scene.',
  },
  {
    value: 'contacts',
    label: 'People in my contacts',
    // Honest about T1 rather than letting the setting quietly mean something
    // else: contact sync does not exist yet, so this genuinely behaves as
    // Nobody. Saying so is the whole point.
    desc: 'Needs contact sync, which is not built yet — for now this works the same as Nobody.',
  },
  {
    value: 'nobody',
    label: 'Nobody',
    desc: 'No one can find you by number. You can still message and be messaged as normal.',
  },
];

export default function PhoneNumberSettings({ session }) {
  const [key, setKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [iso, setIso] = useState(DEFAULT_COUNTRY);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmTyped, setConfirmTyped] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Collapsed by default: managing your own number is a once-ever act, and it
  // was occupying the space the repeated action needs.
  const [myOpen, setMyOpen] = useState(false);
  const cancelled = useRef(false);

  // ── Search by number (P2) ───────────────────────────────────────
  const [searchIso, setSearchIso] = useState(DEFAULT_COUNTRY);
  const [searchTyped, setSearchTyped] = useState('');
  const [searching, setSearching] = useState(false);
  // null = not searched yet, [] = searched and found nobody. The distinction
  // matters: an empty result needs the "no match" copy, an unsearched state
  // needs nothing at all.
  const [result, setResult] = useState(null);
  const [senderChoices, setSenderChoices] = useState(null);
  const [pendingTarget, setPendingTarget] = useState(null);
  const { open: openConversation } = useConversationUi();

  useEffect(() => {
    cancelled.current = false;
    if (!session?.user?.id) { setLoading(false); return; }
    myPhoneKey().then(({ key: k, error }) => {
      if (cancelled.current) return;
      if (error) setMessage("Couldn't load your number.");
      else setKey(k);
      setLoading(false);
    });
    return () => { cancelled.current = true; };
  }, [session]);

  const parsed = toE164(typed, iso);
  const confirmParsed = toE164(confirmTyped, iso);

  /**
   * ⚠ COMPARED AS E.164, NEVER AS TYPED TEXT.
   *
   * "0474 755 829" and "+61474755829" are the same number, and a confirm step
   * that demanded identical keystrokes would reject a correct second entry —
   * training people to copy-paste the first field, which defeats the whole
   * point of asking twice.
   *
   * Comparing canonical values checks the only thing that matters: that both
   * entries mean the same human.
   */
  const confirmMatches =
    Boolean(parsed.e164) && parsed.e164 === confirmParsed.e164;

  // A mistyped number is not a visible failure — it saves, shows plausible
  // last-3 digits, and is simply never found by anyone. That is precisely the
  // class of bug that cost this milestone a session, so it is worth one extra
  // field to make it self-correcting.
  const canSave = confirmMatches && !busy;

  async function save() {
    setBusy(true);
    setMessage('');
    const { reason } = await setPhoneKey(typed, iso);
    if (reason) {
      setMessage(explain(reason, key));
      setBusy(false);
      return;
    }
    const { key: fresh } = await myPhoneKey();
    setKey(fresh);
    setEditing(false);
    setTyped('');
    setConfirmTyped('');
    setBusy(false);
    setMessage('Number saved.');
    // Collapse back to the summary row — the job is done, and leaving the
    // panel open pushes search off the screen for no reason.
    setMyOpen(false);
  }

  async function remove() {
    setBusy(true);
    setMessage('');
    const { error } = await removePhoneKey();
    if (error) { setMessage("Couldn't remove your number."); setBusy(false); return; }
    const { key: fresh } = await myPhoneKey();
    setKey(fresh);
    setConfirmRemove(false);
    setBusy(false);
    setMessage('Number removed.');
  }

  async function changeVisibility(value) {
    // Applied immediately, with no save button: a privacy switch that waits
    // for confirmation is a privacy switch that sometimes silently did not
    // happen. Optimistic, then reconciled from the server.
    const previous = key?.visibility;
    setKey((k) => ({ ...k, visibility: value }));
    const { error } = await setPhoneVisibility(value);
    if (error) {
      setKey((k) => ({ ...k, visibility: previous }));
      setMessage("Couldn't update that.");
      return;
    }
    setMessage('Privacy updated.');
  }

  const searchParsed = toE164(searchTyped, searchIso);
  const canSearch = Boolean(searchParsed.e164) && !searching;

  async function runSearch() {
    setSearching(true);
    setResult(null);
    const { matches, error } = await findByPhone([searchTyped], searchIso);
    // A failed lookup is not "no match" — saying "nobody found" when the
    // request errored would tell the user something untrue about a person.
    setResult(error ? null : matches);
    if (error) setMessage("Search failed. Try again.");
    setSearching(false);
  }

  /**
   * MESSAGE — the same path ProfileScreen uses, deliberately.
   *
   * `sendableProfiles` then `openDirectConversation`, and when more than one
   * of the user's profiles could send, MessageAsSheet asks. Inferring a sender
   * would be a heuristic, and U4 settled that: infer only when there is
   * exactly one candidate, otherwise ask.
   */
  async function messageProfile(target) {
    if (!session?.user?.id) return;
    const { profiles } = await sendableProfiles(session.user.id);
    const options = (profiles ?? []).filter((p) => p.id !== target.profileId);
    if (options.length === 0) return;
    if (options.length === 1) return startConversationAs(options[0].id, target);
    setPendingTarget(target);
    setSenderChoices(options);
  }

  async function startConversationAs(fromProfileId, targetArg) {
    const target = targetArg ?? pendingTarget;
    setSenderChoices(null);
    setPendingTarget(null);
    if (!target) return;
    const { conversationId, error } = await openDirectConversation(fromProfileId, target.profileId);
    if (error || !conversationId) { setMessage("Couldn't open that conversation."); return; }
    openConversation(conversationId, {
      profile: { id: target.profileId, name: target.displayName, type: 'punter' },
    });
  }

  if (loading) {
    return <div className={s.panel}><div className={s.footnote}>Loading…</div></div>;
  }

  const hasKey = key?.hasKey === true;
  const pending = hasKey && key.discoverableFrom && new Date(key.discoverableFrom) > new Date();

  return (
    // ⚠ PADDING OVERRIDDEN LOCALLY, not on `.panel`. That class is shared with
    // NotificationPreferences, and widening it there would silently re-space a
    // screen this change has nothing to do with.
    <div className={s.panel} style={{ padding: '18px 18px 20px' }}>

      {/* ══ SEARCH FIRST ══════════════════════════════════════════
          This is the thing people come here to DO. Managing your own number is
          a once-or-twice-ever act; looking someone up is the repeated one, so
          it gets the top of the panel and everything else collapses. */}
      <div className={s.label} style={{ marginBottom: 10 }}>FIND SOMEONE BY NUMBER</div>

      <div style={fieldRow}>
        <select
          aria-label="Country to search in"
          value={searchIso}
          onChange={(e) => setSearchIso(e.target.value)}
          style={selectStyle}
        >
          {COUNTRIES.map((c) => (
            <option key={c.iso} value={c.iso}>{c.iso} +{c.dial}</option>
          ))}
        </select>
        <input
          type="tel"
          inputMode="tel"
          aria-label="Phone number to search for"
          placeholder="Search by phone number"
          value={searchTyped}
          // ⚠ THE FIELD HOLDS EXACTLY WHAT WAS TYPED. Reformatting on every
          // keystroke and writing the result back is what let a display helper
          // change the MEANING of a number. Tidying happens on blur, and only
          // once the value is unambiguously valid.
          onChange={(e) => { setSearchTyped(e.target.value); setResult(null); }}
          // ⚠ THE PICKER MUST FOLLOW THE NUMBER. formatDisplay writes a
          // LOCAL form, so "+64 21 555 0199" becomes "021 555 0199" — which
          // re-read against Australia is +61215550199, a different human.
          // Moving the chip to the detected country is what keeps the tidied
          // text and the picker describing the same number.
          onBlur={() => {
            const { e164, iso: detected } = toE164(searchTyped, searchIso);
            if (!e164) return;
            if (detected) setSearchIso(detected);
            setSearchTyped(formatDisplay(e164));
          }}
          // Enter searches — this is a search field, and requiring a click on
          // a phone keyboard is a needless extra tap.
          onKeyDown={(e) => { if (e.key === 'Enter' && canSearch) runSearch(); }}
          style={inputStyle}
        />
      </div>

      <button
        type="button"
        onClick={runSearch}
        disabled={!canSearch}
        style={{ ...pillStyle, marginTop: 12, opacity: canSearch ? 1 : 0.4,
          cursor: canSearch ? 'pointer' : 'not-allowed' }}
      >
        {searching ? 'SEARCHING…' : 'SEARCH'}
      </button>

      {result && result.length > 0 && result.map((r) => (
        <div key={r.profileId} style={resultRow}>
          {/* Same component as the identity screen and the Messages header —
              a search result must show exactly the face its owner set, including
              the default when they have set none. */}
          <MessengerAvatar src={r.avatar} size={44} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.displayName}
            </div>
            {/* "On YesPleez" rather than a profile type: this is the Personal
                profile, and surfacing which of someone's other profiles is
                "primary" would be a heuristic. Deferred with Find People. */}
            <span className="glow-pill" style={{ marginTop: 4 }}>ON YESPLEEZ</span>
          </div>
          <button type="button" onClick={() => messageProfile(r)} style={pillStyle}>MESSAGE</button>
        </div>
      ))}

      {result && result.length === 0 && (
        // ⚠ IDENTICAL COPY whether the number is unregistered or its owner
        // chose not to be found. Distinguishing them would leak membership.
        <div className={s.footnote} style={{ marginTop: 12 }}>
          No match for that number. They might not be on YesPleez yet — or
          they've chosen not to be found.
        </div>
      )}

      {/* ══ MY OWN NUMBER — collapsed by default ══════════════════
          Summary row carries the only fact worth seeing at a glance: which
          number is registered. Everything else is one tap away. */}
      <button
        type="button"
        onClick={() => setMyOpen((o) => !o)}
        aria-expanded={myOpen}
        style={summaryRow}
      >
        {/* Label and number read as one phrase — "my ph number is ••• 829" —
            so the number sits beside it rather than floating at the far edge.
            No fontSize override: it inherits `.label`, matching FIND SOMEONE
            BY NUMBER above it, because they are peers. */}
        <span className={s.label}>MY PH NUMBER</span>
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: 1,
          color: hasKey ? 'var(--text)' : 'var(--muted)' }}>
          {hasKey ? `••• ••• ${key.last3 ?? '···'}` : 'Not set'}
        </span>

        {/* The affordance says what it opens. A bare chevron on a row that
            already shows its value gives no reason to press it. */}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
          color: 'var(--muted)', fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 12, letterSpacing: 1.5 }}>
          SETTINGS
          <span aria-hidden="true" style={{ fontSize: 12, display: 'inline-block',
            transform: myOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform .16s var(--yp-ease)' }}>▾</span>
        </span>
      </button>

      {myOpen && (
        <div style={{ paddingTop: 4 }}>

      {!hasKey && !editing && (
        <>
          <div className={s.desc} style={{ marginBottom: 12 }}>
            Add your number so friends who already have it can find you. It's only ever
            used to match you — never shown to anyone, never texted, and you can remove
            it whenever you like.
          </div>
          {/* No `s.switch` here — that class is the toggle's fixed-width knob
              track (~44px) and would squash a text button. */}
          <button type="button" onClick={() => { setTyped(''); setConfirmTyped(''); setEditing(true); }}
            style={pillStyle}>ADD MY NUMBER</button>
        </>
      )}

      {hasKey && !editing && (
        <>
          <div className={s.desc} style={{ marginBottom: 4 }}>
            Never shown to anyone · never texted
          </div>

          {pending && (
            // The 24h cooling period, said plainly. Without this the user adds
            // a number, is not found, and reasonably concludes it is broken.
            <div className={s.footnote} style={{ marginTop: 6 }}>
              Findable from {new Date(key.discoverableFrom).toLocaleString()} — new numbers
              wait a day before they can be found.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {/* Both fields cleared on entry — a stale confirm value left over
                from a previous attempt could pre-satisfy the check. */}
            <button
              type="button"
              onClick={() => { setTyped(''); setConfirmTyped(''); setEditing(true); }}
              style={ghostStyle}
            >
              CHANGE
            </button>
            <button type="button" onClick={() => setConfirmRemove(true)} style={ghostStyle}>
              REMOVE
            </button>
          </div>

          {confirmRemove && (
            <div style={confirmStyle}>
              <div className={s.desc} style={{ marginBottom: 10 }}>
                You won't be findable by number. Your conversations, profiles and
                everything else stay exactly as they are.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={remove} disabled={busy} style={dangerStyle}>
                  REMOVE NUMBER
                </button>
                <button type="button" onClick={() => setConfirmRemove(false)} style={ghostStyle}>
                  CANCEL
                </button>
              </div>
            </div>
          )}

          <div className={s.label} style={{ margin: '18px 0 8px' }}>WHO CAN FIND ME</div>
          {VISIBILITY.map((v) => (
            <button
              key={v.value}
              type="button"
              role="radio"
              aria-checked={key.visibility === v.value}
              onClick={() => changeVisibility(v.value)}
              style={optionStyle(key.visibility === v.value)}
            >
              <span style={radioStyle(key.visibility === v.value)} aria-hidden="true" />
              <span>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{v.label}</span>
                <span className={s.desc}>{v.desc}</span>
              </span>
            </button>
          ))}
        </>
      )}

      {editing && (
        <>
          <div style={fieldRow}>
            <select
              aria-label="Country"
              value={iso}
              onChange={(e) => setIso(e.target.value)}
              style={selectStyle}
            >
              {COUNTRIES.map((c) => (
                <option key={c.iso} value={c.iso}>{c.iso} +{c.dial}</option>
              ))}
            </select>
            <input
              // A picker for the country, a constrained field for the digits —
              // no free-typed country codes (house rule: pickers over text).
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              aria-label="Your mobile number"
              placeholder="Your mobile number"
              value={typed}
              // Raw while typing, tidied on blur — see the search field above.
              onChange={(e) => setTyped(e.target.value)}
              // Picker follows the number — see the search field above for why
              // that is correctness, not convenience.
              onBlur={() => {
                const { e164, iso: detected } = toE164(typed, iso);
                if (!e164) return;
                if (detected) setIso(detected);
                setTyped(formatDisplay(e164));
              }}
              style={inputStyle}
            />
          </div>

          {/* The confirm field appears only once the first entry is a real
              number. Showing it upfront asks people to type twice before they
              know the first one was even accepted. */}
          {parsed.e164 && (
            <div style={{ marginTop: 10 }}>
              <div className={s.desc} style={{ marginBottom: 6 }}>
                Enter it once more to be sure — a mistyped number saves fine and
                then nobody can ever find you.
              </div>
              <div style={fieldRow}>
                {/* No country picker here: the country is already settled by
                    the first entry, and a second one could disagree with it. */}
                <input
                  type="tel"
                  inputMode="tel"
                  aria-label="Confirm your mobile number"
                  placeholder="Confirm your number"
                  value={confirmTyped}
                  onChange={(e) => setConfirmTyped(e.target.value)}
                  onBlur={() => {
                    const { e164 } = toE164(confirmTyped, iso);
                    if (e164) setConfirmTyped(formatDisplay(e164));
                  }}
                  style={inputStyle}
                />
              </div>

              {confirmTyped && !confirmMatches && (
                <div className={s.footnote} style={{ marginTop: 8, color: '#FF8A9E' }}>
                  {confirmParsed.e164
                    ? "Those two don't match."
                    : explainReason(confirmParsed.reason)}
                </div>
              )}
              {confirmMatches && (
                <div className={s.footnote} style={{ marginTop: 8, color: 'var(--green)' }}>
                  Both match.
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button type="button" onClick={save} disabled={!canSave} style={{
              ...pillStyle, opacity: canSave ? 1 : 0.4, cursor: canSave ? 'pointer' : 'not-allowed',
            }}>{busy ? 'SAVING…' : 'SAVE'}</button>
            <button
              type="button"
              onClick={() => { setEditing(false); setTyped(''); setConfirmTyped(''); setMessage(''); }}
              style={ghostStyle}
            >CANCEL</button>
          </div>

          {typed && !parsed.e164 && (
            <div className={s.footnote} style={{ marginTop: 8 }}>{explainReason(parsed.reason)}</div>
          )}
        </>
      )}

      {message && <div className={s.footnote} style={{ marginTop: 10 }} role="status">{message}</div>}

        </div>
      )}

      {senderChoices && (
        <MessageAsSheet
          profiles={senderChoices}
          onConfirm={startConversationAs}
          onCancel={() => { setSenderChoices(null); setPendingTarget(null); }}
        />
      )}
    </div>
  );
}

/** Server-side outcomes that are ordinary, not errors, and need their own copy. */
function explain(reason, key) {
  if (reason === 'already-taken') {
    // Deliberately not "someone stole your number" — the overwhelmingly common
    // cause is a second account of the user's own.
    return "That number is already on an account. If it's yours, get in touch and we'll sort it.";
  }
  if (reason === 'rate-limited') {
    const when = key?.nextChangeAllowed ? new Date(key.nextChangeAllowed).toLocaleDateString() : null;
    return when ? `You can change your number again after ${when}.` : 'You changed your number recently — try again later.';
  }
  return explainReason(reason);
}

function explainReason(reason) {
  switch (reason) {
    case 'too-short':       return "That number looks too short.";
    case 'too-long':        return "That number looks too long.";
    case 'not-a-number':    return "That doesn't look like a phone number.";
    case 'unknown-country': return 'Pick a country first.';
    case 'empty':           return '';
    default:                return "Couldn't save that number.";
  }
}

const pillStyle = {
  background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)',
  color: '#0a0a0f', border: 'none', borderRadius: 999,
  fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: 1.5,
  padding: '9px 18px', cursor: 'pointer',
};

const ghostStyle = {
  background: 'none', border: '1px solid var(--border)', borderRadius: 999,
  color: 'var(--muted)', fontFamily: "'Bebas Neue', sans-serif", fontSize: 12,
  letterSpacing: 1.5, padding: '8px 14px', cursor: 'pointer',
};

const dangerStyle = {
  ...ghostStyle,
  border: '1px solid rgba(255,59,92,.38)',
  background: 'rgba(255,59,92,.12)',
  color: '#FF8A9E',
};

const confirmStyle = {
  marginTop: 12, padding: 12, borderRadius: 12,
  border: '1px solid rgba(255,59,92,.28)', background: 'rgba(255,59,92,.06)',
};

const fieldRow = { display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 };

const summaryRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  marginTop: 20,
  padding: '14px 0 6px',
  background: 'none',
  // `border: none` first to clear the button's default, THEN the top rule —
  // reversing these makes the divider disappear, since the shorthand resets
  // every side including the one just set.
  border: 'none',
  borderTop: '1px solid rgba(255,255,255,.08)',
  color: 'var(--text)',
  cursor: 'pointer',
  textAlign: 'left',
};

const resultRow = {
  display: 'flex', alignItems: 'center', gap: 11, marginTop: 12,
  padding: '10px 12px', borderRadius: 14,
  border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)',
};

const selectStyle = {
  background: 'var(--card2, #0f0f1a)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: 999,
  fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, letterSpacing: 1,
  padding: '9px 10px', cursor: 'pointer',
  // Native control on a dark surface needs this or the dropdown renders white.
  colorScheme: 'dark',
};

const inputStyle = {
  flex: 1, minWidth: 0, background: 'rgba(255,255,255,.05)',
  border: '1px solid var(--border)', borderRadius: 999,
  color: 'var(--text)', fontSize: 15, padding: '10px 14px', outline: 'none',
};

function optionStyle(on) {
  return {
    display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%',
    textAlign: 'left', padding: '10px 12px', marginBottom: 6,
    borderRadius: 12, cursor: 'pointer',
    border: on ? '1px solid rgba(0,229,255,.35)' : '1px solid var(--border)',
    background: on
      ? 'linear-gradient(135deg, rgba(255,45,120,.10), rgba(0,229,255,.07))'
      : 'transparent',
    color: 'var(--text)',
  };
}

function radioStyle(on) {
  return {
    flexShrink: 0, width: 18, height: 18, borderRadius: 999, marginTop: 2,
    border: on ? '2px solid #00E5FF' : '2px solid rgba(255,255,255,.25)',
    background: on ? 'linear-gradient(135deg, #00E5FF, #BF5FFF)' : 'transparent',
    boxShadow: on ? 'inset 0 0 0 3px var(--card, #13131f)' : 'none',
  };
}
