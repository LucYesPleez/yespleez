import { useState, useEffect, useRef } from 'react';
import {
  myPhoneKey,
  setPhoneKey,
  removePhoneKey,
  setPhoneVisibility,
  findByPhone,
} from '../lib/phoneKey';
import { COUNTRIES, DEFAULT_COUNTRY, formatNational, toE164 } from '../lib/phoneNumber';
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
  const [confirmRemove, setConfirmRemove] = useState(false);
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
  const canSave = Boolean(parsed.e164) && !busy;

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
    setBusy(false);
    setMessage('Number saved.');
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
    <div className={s.panel}>
      <div className={s.label} style={{ marginBottom: 10 }}>FIND ME BY PHONE NUMBER</div>

      {!hasKey && !editing && (
        <>
          <div className={s.desc} style={{ marginBottom: 12 }}>
            Add your number so friends who already have it can find you. It's only ever
            used to match you — never shown to anyone, never texted, and you can remove
            it whenever you like.
          </div>
          {/* No `s.switch` here — that class is the toggle's fixed-width knob
              track (~44px) and would squash a text button. */}
          <button type="button" onClick={() => setEditing(true)}
            style={pillStyle}>ADD MY NUMBER</button>
        </>
      )}

      {hasKey && !editing && (
        <>
          <div className={s.row}>
            <div className={s.rowText}>
              <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: 1 }}>
                ••• ••• {key.last3 ?? '···'}
              </div>
              <div className={s.desc}>Never shown to anyone · never texted</div>
            </div>
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
            <button type="button" onClick={() => setEditing(true)} style={ghostStyle}>
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
              onChange={(e) => setTyped(formatNational(e.target.value, iso))}
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button type="button" onClick={save} disabled={!canSave} style={{
              ...pillStyle, opacity: canSave ? 1 : 0.4, cursor: canSave ? 'pointer' : 'not-allowed',
            }}>{busy ? 'SAVING…' : 'SAVE'}</button>
            <button type="button" onClick={() => { setEditing(false); setTyped(''); setMessage(''); }}
              style={ghostStyle}>CANCEL</button>
          </div>

          {typed && !parsed.e164 && (
            <div className={s.footnote} style={{ marginTop: 8 }}>{explainReason(parsed.reason)}</div>
          )}
        </>
      )}

      {message && <div className={s.footnote} style={{ marginTop: 10 }} role="status">{message}</div>}

      {/* ── SEARCH BY NUMBER ──────────────────────────────────────
          Scope is deliberately one field and one result row. No invites, no
          recently-joined, no contact sync — this exists to prove the lookup
          works end to end against the real database. */}
      <div className={s.label} style={{ margin: '22px 0 8px' }}>FIND SOMEONE BY NUMBER</div>

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
          onChange={(e) => { setSearchTyped(formatNational(e.target.value, searchIso)); setResult(null); }}
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
        style={{ ...pillStyle, marginTop: 10, opacity: canSearch ? 1 : 0.4,
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
        <div className={s.footnote} style={{ marginTop: 10 }}>
          No match for that number. They might not be on YesPleez yet — or
          they've chosen not to be found.
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
