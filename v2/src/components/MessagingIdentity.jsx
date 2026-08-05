import { useState, useEffect, useRef } from 'react';
import MessengerAvatar from './MessengerAvatar';
import { sendableProfiles } from '../lib/messaging';
import { profileIdentity } from '../lib/profileTypes';

/** The "no filter" selection. Exported so callers compare against a constant. */
export const ALL_PROFILES = 'all';

/** How many faces the stack shows before it stops adding them. */
const STACK_MAX = 3;

/**
 * MESSAGING IDENTITY SELECTOR — which of your profiles this inbox is about.
 *
 * Sits where FIND FRIENDS used to, in the Messages header.
 *
 * ══ WHAT IT IS NOT ═══════════════════════════════════════════════════
 *
 * ⛔ NOT THE ACCOUNT. The avatar in the top-right global header is the signed-in
 * ACCOUNT and its menu, and it is untouched by this. This control is about
 * IDENTITIES you can send as. Two similar-looking rows of faces, two genuinely
 * different jobs — which is exactly why the personal profile is excluded below
 * rather than shown in both.
 *
 * ⛔ THE PERSONAL (`punter`) PROFILE IS NEVER IN THE STACK. It is already the
 * face in the account control one row up, and showing it twice would ask the
 * user to work out whether the two are the same thing. They are.
 *
 * ⛔ NOT AN ACTING-PROFILE SWITCH. `O-R1` is explicit: the active profile
 * determines NOTHING about authorisation, and `can_act_as()` remains the sole
 * mechanism. This filters a view; it must never grow into a permission.
 *
 * ══ WHAT IT DOES ═════════════════════════════════════════════════════
 *
 * None owned  → renders nothing at all. A control offering one choice is not a
 *               choice, and an empty stack in the header would be a hole.
 * One owned   → a single avatar.
 * Several     → an overlapping stack, capped at STACK_MAX faces. The popover
 *               carries the full list, so the stack is an affordance rather
 *               than an inventory — it does not need to show everyone.
 *
 * ⚠ SELECTION IS WIRED BUT NOT YET APPLIED. `onChange` reports the choice and
 * the caller records it; no conversation filtering happens yet, deliberately
 * (owner, 2026-08-05: wire the UI, filter in the next step). Nothing here
 * claims otherwise — there is no "showing X only" copy to become a lie.
 *
 * ⚠ ROOM IS LEFT FOR UNREAD BADGES, AND NONE ARE BUILT. Every face sits in its
 * own `position: relative` wrapper and every popover row ends in a spacer, so a
 * per-profile count can be dropped in without moving anything. Deliberately no
 * badge and no animation in this pass.
 */
export default function MessagingIdentity({ session, value = ALL_PROFILES, onChange }) {
  const [profiles, setProfiles] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId) { setProfiles([]); return undefined; }
    let cancelled = false;
    sendableProfiles(userId).then(({ profiles: owned }) => {
      if (cancelled) return;
      // ⛔ The personal profile is the account avatar's job — see the header.
      setProfiles((owned ?? []).filter((p) => p.type !== 'punter'));
    });
    return () => { cancelled = true; };
  }, [userId]);

  // Close on outside click and on Escape. ⚠ `mousedown`, not `click`, matching
  // ProfileMenu: a `click` listener fires after the row's own handler has run,
  // which on a state change means closing a menu that is already gone.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Nothing to choose between: render nothing rather than an empty control.
  if (profiles.length === 0) return null;

  const shown = profiles.slice(0, STACK_MAX);
  const selected = profiles.find((p) => p.id === value) || null;
  const label = selected ? selected.name : 'All profiles';

  function choose(next) {
    setOpen(false);
    onChange?.(next);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Messaging identity: ${label}`}
        // 68×32 measured — under the 44px minimum on its short axis, and it is
        // the only control in that corner, so there is nothing to crowd.
        className="yp-tap44"
        style={stackButton}
      >
        {shown.map((p, i) => (
          // ⚠ `position: relative` PER FACE, so a future unread badge has an
          // anchor without this markup having to change.
          <span key={p.id} style={{ ...faceSlot, marginLeft: i === 0 ? 0 : -10, zIndex: STACK_MAX - i }}>
            <MessengerAvatar src={avatarFor(p)} size={28} alt="" />
          </span>
        ))}
      </button>

      {open && (
        <div role="menu" aria-label="Choose a messaging identity" style={popover}>
          <Row
            label="All profiles"
            active={!selected}
            onClick={() => choose(ALL_PROFILES)}
          />

          {/* A rule, not a gap: the list below is a different KIND of thing from
              the option above it — specific identities rather than the absence
              of a filter. */}
          <div style={divider} aria-hidden="true" />

          {profiles.map((p) => (
            <Row
              key={p.id}
              label={p.name || 'Unnamed'}
              sub={profileIdentity(p.type)?.shortLabel}
              avatar={avatarFor(p)}
              active={p.id === value}
              onClick={() => choose(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ⚠ FALLS BACK TO THE TYPE'S OWN DEFAULT IMAGE, not to MessengerAvatar's blank
 * disc. A venue with no photo should still look like a venue in a row of faces;
 * an empty circle reads as a loading state.
 */
function avatarFor(p) {
  return p.avatar_thumb || p.avatar || profileIdentity(p.type)?.defaultImage || null;
}

function Row({ label, sub, avatar, active, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{ ...rowStyle, background: active ? 'rgba(0,229,255,.10)' : 'none' }}
    >
      {avatar !== undefined && (
        <span style={faceSlot}>
          <MessengerAvatar src={avatar ?? null} size={26} alt="" />
        </span>
      )}
      <span style={{ minWidth: 0, textAlign: 'left' }}>
        <span style={{ display: 'block', fontSize: 13.5, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {sub && (
          <span style={{ display: 'block', fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 10.5, letterSpacing: 1.2, color: 'var(--muted)' }}>
            {sub}
          </span>
        )}
      </span>
      {/* ⚠ THE BADGE SLOT. Empty by design in this pass — it holds the row's
          right edge open so adding a count later moves nothing. */}
      <span style={{ marginLeft: 'auto' }} aria-hidden="true" />
    </button>
  );
}

const stackButton = {
  display: 'flex', alignItems: 'center', background: 'none', border: 'none',
  padding: 2, cursor: 'pointer', borderRadius: 999,
};

/* The ring is the app's own background, so overlapping faces read as separate
   discs rather than one smeared shape. */
const faceSlot = {
  position: 'relative', display: 'inline-flex', borderRadius: 999,
  boxShadow: '0 0 0 2px var(--dark)', flexShrink: 0,
};

const popover = {
  position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 60,
  minWidth: 210, maxWidth: 280, padding: 6,
  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
  boxShadow: '0 14px 40px rgba(0,0,0,.5)',
};

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
  border: 'none', borderRadius: 10, padding: '8px 10px',
  cursor: 'pointer', textAlign: 'left', color: 'var(--text)',
};

const divider = {
  height: 1, background: 'var(--border)', margin: '5px 8px',
};
