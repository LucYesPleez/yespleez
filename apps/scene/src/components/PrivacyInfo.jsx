import { useState } from 'react';
import s from './NotificationPreferences.module.css';

/**
 * ⓘ — the explainer that sits beside a privacy claim.
 *
 * Every claim this product makes about privacy should be one tap from the
 * reason it is true. "Scrambled codes only" and "never shown to anyone" ask
 * people to take something on faith, and these features only work if they
 * don't have to.
 *
 * ⚠ EVERY TOPIC ENDS WITH A LIMIT, NOT A REASSURANCE. That is the format, and
 * it is deliberate: claiming a system sees nothing is almost always false, and
 * a single overclaim discredits every true statement beside it. The sentence
 * admitting what we CAN see is what makes the rest believable.
 *
 * ⚠ NOTHING HERE MAY DESCRIBE SOMETHING THAT IS NOT BUILT. A claim written
 * ahead of its implementation is just a false claim with a deployment date.
 * Add the topic when the feature ships, not when it is planned.
 */

const TOPICS = {
  contacts: {
    title: 'HOW THIS STAYS PRIVATE',
    points: [
      ['Scrambled means one-way',
       'Each number becomes a code that cannot be turned back into a number — not by us, not by anyone who ever got hold of it.'],
      ['Only codes are sent',
       'No names, no email addresses, no numbers. Your address book stays on your phone.'],
      ["You choose who's included",
       "Your phone's own picker decides what we receive. We only ever get the contacts you tick."],
      ['Names never leave this phone',
       'When a match says "saved as Sarah", that name came from your phone. We have never seen it and cannot.'],
      ['You can erase it',
       'Delete codes removes every one of them from our servers, and the matches go with them.'],
    ],
    limit: "that two accounts have each other's number saved. That is what makes matching work at all — so we'd rather say it than imply we're blind to it.",
  },

  number: {
    title: 'WHAT WE DO WITH YOUR NUMBER',
    points: [
      ['Stored as a code, not a number',
       'Your number is turned into a one-way code the moment it is saved. The digits themselves are never stored.'],
      ['We cannot read it back',
       'That is why this screen shows only the last three digits — they are kept separately so you can tell which number is registered. Nobody, including us, can recover the rest.'],
      ['Never shown to anyone',
       'It does not appear on your profile, in a search result, in a link, or in a notification. It is a way to be found, never something to display.'],
      ['We never text it',
       'No verification codes, no marketing, no messages of any kind. YesPleez sends no SMS at all.'],
      ['You can remove it',
       'Removing your number deletes the code outright. It is not kept, hidden or archived.'],
    ],
    limit: "when someone searches a number, our server has to look at it for the instant it takes to check. We don't log it, and it isn't stored — but we are not blind to it in that moment.",
  },
};

export default function PrivacyInfo({ topic }) {
  const [open, setOpen] = useState(false);
  const t = TOPICS[topic];
  if (!t) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Why this is private: ${t.title.toLowerCase()}`}
        style={dotStyle}
      >
        i
      </button>

      {open && (
        <div style={panelStyle}>
          <div className={s.label} style={{ fontSize: 13, marginBottom: 8 }}>{t.title}</div>

          {t.points.map(([title, body]) => (
            <div key={title} style={{ marginBottom: 8 }}>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>{title}</span>
              <span className={s.desc}>{body}</span>
            </div>
          ))}

          <div style={limitStyle}>
            <strong style={{ color: 'var(--text)' }}>What we can see:</strong> {t.limit}
          </div>
        </div>
      )}
    </>
  );
}

/* Inline with the sentence it explains, not floated at the end of the row —
   it belongs to the words, not to the block. */
const dotStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  marginLeft: 6,
  verticalAlign: -2,
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,.28)',
  background: 'none',
  color: 'var(--muted)',
  fontFamily: 'Georgia, serif',
  fontStyle: 'italic',
  fontSize: 11,
  lineHeight: 1,
  cursor: 'pointer',
  padding: 0,
};

const panelStyle = {
  marginTop: 10,
  padding: 12,
  borderRadius: 12,
  border: '1px solid rgba(0,229,255,.22)',
  background: 'rgba(0,229,255,.04)',
};

const limitStyle = {
  marginTop: 10,
  paddingTop: 10,
  borderTop: '1px solid rgba(255,255,255,.10)',
  fontFamily: "'DM Sans', sans-serif",
  fontSize: 12,
  lineHeight: 1.45,
  color: 'var(--muted)',
};
