import { useState } from 'react';
import s from './ClaimDialog.module.css';
import { PROFILE_TYPES } from '../lib/profileTypes';

const CLAIMS_EMAIL       = 'claims@yespleez.com';
const YESPLEEZ_IG_HANDLE = 'yespleez_pres';
const YESPLEEZ_INSTAGRAM = `https://www.instagram.com/${YESPLEEZ_IG_HANDLE}/`;

export default function ClaimDialog({ open, onClose, profile, session }) {
  const [copied, setCopied] = useState(false);
  if (!open || !profile) return null;

  const profileUrl = window.location.href;
  const typeLabel  = PROFILE_TYPES[profile.type]?.label || profile.type || 'Artist';
  const userEmail  = session?.user?.email || '[your YesPleez account email]';

  const subject = `Profile Claim Request – ${profile.name}`;
  const body = [
    'Hello YesPleez,',
    '',
    "I'd like to claim the following YesPleez profile.",
    '',
    'Profile:',
    profileUrl,
    '',
    'Profile Type:',
    typeLabel,
    '',
    'My YesPleez account email:',
    userEmail,
    '',
    'Evidence of ownership:',
    '',
    'Official Website: ',
    'Instagram: ',
    'Facebook: ',
    'Spotify / SoundCloud / Bandcamp / Resident Advisor: ',
    'Business Email (if applicable): ',
    '',
    'Additional information:',
    '',
    'Thank you.',
  ].join('\n');

  const mailtoUrl = `mailto:${CLAIMS_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <div className={s.backdrop} onClick={onClose}>
      <div className={s.sheet} onClick={e => e.stopPropagation()}>
        <div className={s.handle} />

        <div className={s.header}>
          <span className={s.title}>CLAIM THIS PROFILE</span>
          <button className={s.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <p className={s.body}>
          If you own or officially represent this profile, you can request ownership.
          For now, all claims are reviewed manually by the YesPleez team.
        </p>

        <div className={s.options}>
          {/* Instagram — first: it always works. A mailto depends on the
              visitor's OS having a handler registered for the protocol, which
              is absent on any machine using webmail rather than a desktop mail
              client. When it is missing the browser does nothing at all: no
              error, no tab. Leading with the route that cannot silently fail. */}
          <a href={YESPLEEZ_INSTAGRAM} target="_blank" rel="noopener noreferrer" className={`${s.option} ${s.optionInstagram}`} onClick={onClose}>
            <div className={s.optionIcon}>
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect width="20" height="20" x="2" y="2" rx="5" ry="5"/>
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                <line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>
              </svg>
            </div>
            <div className={s.optionContent}>
              <div className={s.optionTitle}>DM us on Instagram</div>
              <div className={s.optionDesc}>
                Message <span className={s.igHighlight}>@{YESPLEEZ_IG_HANDLE}</span> and include your profile link, YesPleez account email, and evidence of ownership.
              </div>
            </div>
            <div className={s.optionArrow}>›</div>
          </a>

          {/* Email */}
          <a href={mailtoUrl} className={s.option} onClick={onClose}>
            <div className={s.optionIcon}>
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/>
              </svg>
            </div>
            <div className={s.optionContent}>
              <div className={s.optionTitle}>Email us</div>
              <div className={s.optionDesc}>
                Opens your email app with a pre-filled template ready to send to{' '}
                <span className={s.emailHighlight}>{CLAIMS_EMAIL}</span>
              </div>
            </div>
            <div className={s.optionArrow}>›</div>
          </a>
        </div>

        {/* Fallback for the silent-mailto case. If no handler is registered the
            link above does nothing visible, and the visitor has no way to know
            the address even existed. Copying it costs one line and turns a dead
            click into a usable one. */}
        <button
          type="button"
          className={s.copyRow}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(CLAIMS_EMAIL);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch { /* clipboard blocked — the address is on screen regardless */ }
          }}
        >
          {copied ? 'Address copied' : `Email app didn't open? Copy ${CLAIMS_EMAIL}`}
        </button>

        <p className={s.footer}>
          We aim to review all claims within a few business days.
        </p>
      </div>
    </div>
  );
}
