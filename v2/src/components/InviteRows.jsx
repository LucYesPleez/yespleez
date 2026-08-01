import { useState } from 'react';
import ShareSheet from './ShareSheet';
import { shareUrl } from '../lib/shareTarget';
import { profileUrl } from '../lib/profileResolution';

/**
 * INVITE FRIENDS · SHARE YESPLEEZ — the last two rows of the Find Friends
 * sketch (docs/contacts-page-2026-07.md §1).
 *
 * ⚠ THESE ARE TWO DIFFERENT ACTS AND THE SKETCH LISTS THEM SEPARATELY ON
 * PURPOSE. Collapsing them into one "share" row would lose the distinction:
 *
 *   Invite Friends   lands the recipient ON YOU — your profile, with a Message
 *                    button already there. The point is that they can reach the
 *                    person who invited them, immediately.
 *   Share YesPleez   lands them on the app. No personal reference, nothing
 *                    about who sent it. For recommending the thing, not joining
 *                    a specific person.
 *
 * ⚠ NEVER PLATFORM SMS. Phone Discovery §6 settled this: YesPleez does not
 * send messages on a user's behalf, ever. Both rows hand off to the OS share
 * sheet (or the clipboard), so whatever gets sent is sent BY the user, FROM
 * their own app, with them looking at it. There is no send path here to abuse
 * and no number is read to populate one.
 *
 * ⚠ NO INVITE CODES, DELIBERATELY. An invite that tracked who-invited-whom
 * would need a table, a redemption path, and an answer to what happens when
 * two people claim the same invite. The profile link already does the whole
 * job — it identifies the inviter and gives the recipient somewhere to go —
 * without storing a new class of data about who knows whom.
 *
 * Both routes go through the existing ShareSheet, so native share, Copy Link
 * and the reserved QR slot all behave exactly as they do everywhere else. No
 * second sharing implementation.
 */
export default function InviteRows({ myProfile }) {
  const [target, setTarget] = useState(null);

  // Invite needs somewhere to point. Until the caller has resolved the user's
  // own profile the row would share a link to nobody, so it is hidden rather
  // than shown broken — a share is not undoable once it has been sent.
  const myUrl = myProfile?.id ? profileUrl(myProfile) : null;
  const myName = myProfile?.name;

  function invite() {
    setTarget({
      type: 'invite',
      title: myName ? `${myName} on YesPleez` : 'Join me on YesPleez',
      preview: myName
        ? `${myName} is on YesPleez — the scene in your hands.`
        : 'Join me on YesPleez — the scene in your hands.',
      url: shareUrl(myUrl),
    });
  }

  function shareApp() {
    setTarget({
      type: 'app',
      title: 'YesPleez',
      preview: 'YesPleez — the scene in your hands. Find gigs, artists and venues near you.',
      // The bare app, with no profile and no reference to who sent it.
      url: shareUrl('/'),
    });
  }

  return (
    <>
      {myUrl && (
        <Row
          icon={<EnvelopeIcon />}
          label="Invite Friends"
          hint="Share your profile so they land on you"
          onClick={invite}
        />
      )}
      <Row
        icon={<ShareIcon />}
        label="Share YesPleez"
        hint="Send the app, no profile attached"
        onClick={shareApp}
      />

      {target && <ShareSheet target={target} onClose={() => setTarget(null)} />}
    </>
  );
}

/* ⚠ SVG, NOT EMOJI (owner, 2026-08-01). An emoji is a FONT glyph: the OS
   picks it, so ✉ renders flat grey on Windows, full-colour on iOS and as a
   different envelope again on Android — it cannot inherit currentColor and it
   never matches the app's stroke weight. These are drawn at the same 1.8
   stroke as the rest of the app's icons and take their colour from the row. */
function EnvelopeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 6 10-6" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <path d="M12 16V3" />
      <path d="m7 8 5-5 5 5" />
    </svg>
  );
}

function Row({ icon, label, hint, onClick }) {
  return (
    <button type="button" onClick={onClick} style={rowStyle}>
      <span style={iconStyle} aria-hidden="true">{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, color: 'var(--text)' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>
          {hint}
        </span>
      </span>
      <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 16 }} aria-hidden="true">›</span>
    </button>
  );
}

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 12, width: '100%',
  background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)',
  borderRadius: 12, padding: '12px 14px', marginTop: 8,
  cursor: 'pointer', textAlign: 'left',
};
const iconStyle = {
  width: 26, height: 26, borderRadius: 999, flexShrink: 0,
  display: 'grid', placeItems: 'center', fontSize: 13,
  background: 'rgba(255,255,255,.07)', color: 'var(--text)',
};
