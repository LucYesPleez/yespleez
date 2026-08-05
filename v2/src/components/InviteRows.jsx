import { useState } from 'react';
import { shareUrl, nativeShare, copyLink, canNativeShare } from '../lib/shareTarget';
import { profileUrl } from '../lib/profileResolution';
import { summaryRow } from './PhoneNumberSettings';
import s from './NotificationPreferences.module.css';

/**
 * INVITE FRIENDS — one row inside the Find Friends panel, flush with
 * MY PH NUMBER and MY CONTACTS above it. Label left, action right. That is all.
 *
 * ⛔ THREE THINGS WERE REMOVED HERE (owner, 2026-08-05), and
 * docs/contacts-page-2026-07.md §1 is now ahead of the code on the first:
 *
 *   Share YesPleez   the sketch's second row — "recommend the app to anyone",
 *                    as distinct from "invite a person to you". Cut as clutter
 *                    in a panel whose entire job is finding SPECIFIC people.
 *   The share sheet   owner: "this screen is pointless". On desktop it was a
 *                    modal wrapping a single Copy link button.
 *   The big button    it made this row shout next to two quiet ones. The panel
 *                    already had a vocabulary for "there is more here" — the
 *                    SETTINGS affordance — and this now speaks it.
 *
 * ⚠ IT IMPORTS `summaryRow` AND `.label` RATHER THAN MATCHING THEM BY EYE.
 * Hand-copied values drifted on the first attempt: this rendered muted at 13px
 * beside their `--text` at 15px, which is precisely the "written in white"
 * complaint. Shared objects cannot drift; copied ones already did.
 *
 * ⚠ ONE BUTTON, TWO BEHAVIOURS, BY PLATFORM. Where the OS has a share sheet
 * the button opens it; where it does not (desktop) it copies the link and the
 * action says COPIED for a moment — a control that appears to do nothing is
 * worse than one that admits which of the two it did.
 *
 * ⚠ NEVER PLATFORM SMS. Phone Discovery §6 settled this: YesPleez does not
 * send messages on a user's behalf, ever. This hands off to the OS share sheet
 * or the clipboard, so whatever gets sent is sent BY the user, FROM their own
 * app, with them looking at it. There is no send path here to abuse and no
 * number is read to populate one.
 *
 * ⚠ NO INVITE CODES, DELIBERATELY. An invite that tracked who-invited-whom
 * would need a table, a redemption path, and an answer to what happens when
 * two people claim the same invite. The profile link already does the whole
 * job — it identifies the inviter and gives the recipient somewhere to go —
 * without storing a new class of data about who knows whom.
 *
 * Share mechanics live in lib/shareTarget so this is not a second
 * implementation of them; see the note there.
 */
export default function InviteRows({ myProfile }) {
  const [copied, setCopied] = useState(false);

  // Invite needs somewhere to point. Until the caller has resolved the user's
  // own profile the row would share a link to nobody, so it is hidden rather
  // than shown broken — a share is not undoable once it has been sent.
  const myUrl = myProfile?.id ? profileUrl(myProfile) : null;
  if (!myUrl) return null;

  const myName = myProfile?.name;
  const target = {
    type: 'invite',
    title: myName ? `${myName} on YesPleez` : 'Join me on YesPleez',
    preview: myName
      ? `${myName} is on YesPleez — the scene in your hands.`
      : 'Join me on YesPleez — the scene in your hands.',
    url: shareUrl(myUrl),
  };

  async function share() {
    // Native first where it exists. It returns false when the user cancels,
    // and a cancel must NOT fall through to copying — silently putting a link
    // on the clipboard is not what dismissing a share sheet asks for.
    if (canNativeShare()) { await nativeShare(target); return; }
    if (await copyLink(target)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  return (
    <button type="button" onClick={share} style={summaryRow} aria-label="Share your profile link">
      <span className={s.label}>INVITE FRIENDS</span>

      {/* Same shape and colour as the SETTINGS affordance on the rows above —
          this row does a different thing, but it is not more important than
          they are and should not look it. */}
      <span style={actionStyle}>
        {copied ? 'COPIED' : 'SHARE'}
        <ShareIcon />
      </span>
    </button>
  );
}

const actionStyle = {
  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
  color: 'var(--muted)', fontFamily: "'Bebas Neue', sans-serif",
  fontSize: 12, letterSpacing: 1.5,
};

/* ⚠ SVG, NOT EMOJI (owner, 2026-08-01). An emoji is a FONT glyph: the OS picks
   it, so it renders flat grey on Windows and full-colour on iOS, cannot inherit
   currentColor, and never matches the app's stroke weight. Drawn at the same
   1.8 stroke as the rest of the app's icons, taking its colour from the row. */
function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <path d="M12 16V3" />
      <path d="m7 8 5-5 5 5" />
    </svg>
  );
}
