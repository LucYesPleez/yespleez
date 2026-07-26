import { useState, useEffect, useRef } from 'react';
import {
  getContactSync, setContactSync, deleteContactCodes,
  syncContacts, pickContacts, isContactPickerSupported,
} from '../lib/contactSync';
import MessengerAvatar from './MessengerAvatar';
import PrivacyInfo from './PrivacyInfo';
import s from './NotificationPreferences.module.css';

/**
 * C1 · Contact sync settings, and the sync itself.
 *
 * ⚠ STOP AND ERASE ARE DIFFERENT ACTS. The toggle stops future syncs; the
 * codes already uploaded keep working until they are explicitly deleted.
 * Turning sync off therefore OFFERS the deletion rather than performing it —
 * silently erasing on toggle-off would destroy data the user did not ask to
 * lose, and silently keeping it without saying so would be worse.
 *
 * ⚠ THE PRIMER ALWAYS PRECEDES THE PICKER. Our button says CONTINUE, never
 * "Allow" — accept-language belongs to the system sheet alone, so nobody feels
 * the real decision was smuggled past them.
 */
export default function ContactSyncSettings({ onMatches }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [primerOpen, setPrimerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [offerDelete, setOfferDelete] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [matches, setMatches] = useState(null);
  const cancelled = useRef(false);

  const supported = isContactPickerSupported();

  useEffect(() => {
    cancelled.current = false;
    getContactSync().then(({ state: st, error }) => {
      if (cancelled.current) return;
      if (error) setStatus("Couldn't load your contact settings.");
      else setState(st);
      setLoading(false);
    });
    return () => { cancelled.current = true; };
  }, []);

  async function runSync() {
    setPrimerOpen(false);
    setBusy(true);
    setStatus('');
    const contacts = await pickContacts();
    if (contacts.length === 0) {
      // Cancelled, or nothing ticked. Not an error, and not worth a message
      // that reads like one.
      setBusy(false);
      return;
    }
    const { matches: found, uploaded, error } = await syncContacts(contacts);
    if (error) { setStatus('Sync failed. Try again.'); setBusy(false); return; }

    setMatches(found);
    onMatches?.(found);
    const { state: fresh } = await getContactSync();
    setState(fresh);
    setBusy(false);
    setStatus(
      found.length > 0
        ? `Synced ${uploaded} — ${found.length} already here.`
        : `Synced ${uploaded}. None of them are here yet.`,
    );
  }

  async function toggle(next) {
    const previous = state?.enabled;
    setState((st) => ({ ...st, enabled: next }));
    const { error } = await setContactSync(next);
    if (error) { setState((st) => ({ ...st, enabled: previous })); setStatus("Couldn't update that."); return; }
    // Offer the erase unprompted — see the header note on stop vs erase.
    if (!next && (state?.codeCount ?? 0) > 0) setOfferDelete(true);
  }

  async function erase() {
    setBusy(true);
    const { error } = await deleteContactCodes();
    if (error) { setStatus("Couldn't delete those."); setBusy(false); return; }
    const { state: fresh } = await getContactSync();
    setState(fresh);
    setMatches(null);
    setOfferDelete(false);
    setConfirmDelete(false);
    setBusy(false);
    setStatus('Contact codes deleted.');
  }

  if (loading) return <div className={s.footnote}>Loading…</div>;

  const count = state?.codeCount ?? 0;
  const synced = Boolean(state?.lastSyncedAt);

  return (
    <div>
      {!supported && (
        // ⚠ THE CONTACT PICKER IS CHROME-ON-ANDROID ONLY. Not desktop Chrome,
        // not Safari, and not iOS at all — every iOS browser is WebKit
        // underneath and WebKit has never implemented it. Measured, not
        // assumed: `'contacts' in navigator` is false on desktop Chrome.
        //
        // The previous copy said "needs the YesPleez app", which implied one
        // exists. It does not, and promising a product that has not been
        // written is the kind of small untruth this whole surface avoids.
        <div className={s.desc}>
          Contact matching uses your phone's own contact picker, which today only
          Chrome on Android offers. On iPhone and on desktop, searching by number
          above does the same job — one person at a time.
        </div>
      )}

      {supported && !synced && !primerOpen && (
        <>
          <div className={s.desc} style={{ marginBottom: 10 }}>
            See which of your contacts are already here. Scrambled codes only —
            never names or numbers.
            <PrivacyInfo topic="contacts" />
          </div>
          <button type="button" onClick={() => setPrimerOpen(true)} style={pillStyle}>
            FIND FRIENDS FROM CONTACTS
          </button>
        </>
      )}

      {supported && primerOpen && (
        <div style={primerStyle}>
          <Fact icon="🔒" title="Scrambled on your phone">
            Your contacts are turned into unreadable codes before anything leaves your device.
            <PrivacyInfo topic="contacts" />
          </Fact>
          <Fact icon="⛔" title="Codes only — nothing else">
            No names, no emails, no numbers. YesPleez never sees your address book.
          </Fact>
          <Fact icon="🗑" title="Yours to undo">
            Delete the uploaded codes any time, right here.
          </Fact>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {/* CONTINUE, not "Allow" — the system sheet owns that word. */}
            <button type="button" onClick={runSync} disabled={busy} style={pillStyle}>
              {busy ? 'WORKING…' : 'CONTINUE'}
            </button>
            <button type="button" onClick={() => setPrimerOpen(false)} style={ghostStyle}>
              NOT NOW
            </button>
          </div>
        </div>
      )}

      {supported && synced && (
        <>
          <div className={s.row}>
            <div className={s.rowText}>
              <div className={s.label} style={{ fontSize: 14 }}>Sync contacts</div>
              <div className={s.desc}>
                Finds friends as they join, by scrambled code only.
                <PrivacyInfo topic="contacts" />
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.enabled}
              onClick={() => toggle(!state.enabled)}
              style={switchStyle(state.enabled)}
            >
              <span style={knobStyle(state.enabled)} />
            </button>
          </div>

          <div className={s.footnote} style={{ marginTop: 6 }}>
            {/* "codes", never "contacts" — the label IS the privacy model. */}
            Last synced {new Date(state.lastSyncedAt).toLocaleString()} · {count} codes
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button type="button" onClick={runSync} disabled={busy} style={ghostStyle}>
              {busy ? 'SYNCING…' : 'SYNC AGAIN'}
            </button>
            <button type="button" onClick={() => setConfirmDelete(true)} style={dangerStyle}>
              DELETE CODES
            </button>
          </div>
        </>
      )}

      {offerDelete && (
        <div style={noticeStyle}>
          <div className={s.desc} style={{ marginBottom: 10 }}>
            Sync is off. The {count} codes already uploaded still power your matches.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setConfirmDelete(true)} style={dangerStyle}>
              DELETE THEM TOO
            </button>
            <button type="button" onClick={() => setOfferDelete(false)} style={ghostStyle}>
              KEEP THEM
            </button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={noticeStyle}>
          <div className={s.desc} style={{ marginBottom: 10 }}>
            This removes every scrambled code from our servers. Contact matches
            disappear, and if "People in my contacts" is on, nobody can find you
            until you sync again.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={erase} disabled={busy} style={dangerStyle}>
              DELETE CODES
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} style={ghostStyle}>
              CANCEL
            </button>
          </div>
        </div>
      )}

      {matches && matches.length > 0 && (
        <>
          <div className={s.label} style={{ margin: '16px 0 8px' }}>FROM YOUR CONTACTS</div>
          {matches.map((m) => (
            <div key={m.profileId} style={rowStyle}>
              <MessengerAvatar src={m.avatar} size={40} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.displayName}
                </div>
                {/* ⭐ THE CORROBORATION LINE — mitigation 4, and the reason a
                    squatted number is catchable. Muted, never red: most
                    mismatches are nicknames, and crying wolf on those would
                    train people to ignore the real one. */}
                <div className={s.desc}>
                  {m.savedAs ? `saved as ${m.savedAs}` : 'in your contacts'}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {status && <div className={s.footnote} style={{ marginTop: 10 }} role="status">{status}</div>}
    </div>
  );
}

/**
 * ⓘ next to every mention of "scrambled codes".
 *
 * The phrase asks people to take privacy on faith, and this feature only works
 * if they don't have to. Everything here is checkable against the code, and
 * the last item is deliberately a LIMITATION rather than a reassurance —
 * claiming we can see nothing would be false, and one overclaim discredits
 * the four true statements above it.
 */
function ScrambledInfo({ open, onToggle }) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label="How scrambled codes keep this private"
        style={infoDotStyle}
      >
        i
      </button>

      {open && (
        <div style={explainStyle}>
          <div className={s.label} style={{ fontSize: 13, marginBottom: 8 }}>
            HOW THIS STAYS PRIVATE
          </div>
          <Point title="Scrambled means one-way">
            Each number becomes a code that cannot be turned back into a number —
            not by us, not by anyone who ever got hold of it.
          </Point>
          <Point title="Only codes are sent">
            No names, no email addresses, no numbers. Your address book stays on
            your phone.
          </Point>
          <Point title="You choose who's included">
            Your phone's own picker decides what we receive. We only ever get the
            contacts you tick.
          </Point>
          <Point title="Names never leave this phone">
            When a match says "saved as Sarah", that name came from your phone.
            We have never seen it and cannot.
          </Point>
          <Point title="You can erase it">
            Delete codes removes every one of them from our servers, and the
            matches go with them.
          </Point>

          {/* The honest limit. Being told what we CAN see is what makes the
              five statements above worth believing. */}
          <div style={limitStyle}>
            <strong style={{ color: 'var(--text)' }}>What we can see:</strong> that
            two accounts have each other's number saved. That is what makes
            matching work at all — so we'd rather say it than imply we're blind
            to it.
          </div>
        </div>
      )}
    </>
  );
}

function Point({ title, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>{title}</span>
      <span className={s.desc}>{children}</span>
    </div>
  );
}

function Fact({ icon, title, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 0', alignItems: 'flex-start' }}>
      <span style={{ fontSize: 15, width: 22, flexShrink: 0 }} aria-hidden="true">{icon}</span>
      <span>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{title}</span>
        <span className={s.desc}>{children}</span>
      </span>
    </div>
  );
}

const pillStyle = {
  background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)', color: '#0a0a0f',
  border: 'none', borderRadius: 999, fontFamily: "'Bebas Neue', sans-serif",
  fontSize: 13, letterSpacing: 1.5, padding: '9px 18px', cursor: 'pointer',
};
const ghostStyle = {
  background: 'none', border: '1px solid var(--border)', borderRadius: 999,
  color: 'var(--muted)', fontFamily: "'Bebas Neue', sans-serif", fontSize: 12,
  letterSpacing: 1.5, padding: '8px 14px', cursor: 'pointer',
};
const dangerStyle = {
  ...ghostStyle, border: '1px solid rgba(255,59,92,.38)',
  background: 'rgba(255,59,92,.12)', color: '#FF8A9E',
};
const primerStyle = {
  padding: 12, borderRadius: 14, border: '1px solid var(--border)',
  background: 'rgba(255,255,255,.03)',
};
const noticeStyle = {
  marginTop: 12, padding: 12, borderRadius: 12,
  border: '1px solid rgba(255,59,92,.28)', background: 'rgba(255,59,92,.06)',
};
const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 11, padding: '8px 0',
  borderTop: '1px solid rgba(255,255,255,.06)',
};
function switchStyle(on) {
  return {
    width: 44, height: 26, borderRadius: 999, flexShrink: 0, border: 'none',
    marginLeft: 'auto', cursor: 'pointer', position: 'relative',
    background: on ? 'linear-gradient(135deg, #00E5FF, #BF5FFF)' : 'rgba(255,255,255,.12)',
  };
}
function knobStyle(on) {
  return {
    position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20,
    borderRadius: 999, background: on ? '#0a0a0f' : 'rgba(255,255,255,.5)',
    transition: 'left .16s var(--yp-ease)',
  };
}
