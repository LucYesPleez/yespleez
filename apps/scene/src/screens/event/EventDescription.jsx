// § 4 · Event Summary — Description
//
// Spec: docs/event-page-layout-spec.md § 4
//
// The organiser's voice, on its own. In the reference concept it sat between
// numbers and buttons inside a single card, which is the most reliable way to
// ensure nobody reads it.
//
// ONE SOURCE ONLY. Where an event carries more than one description-shaped
// field, the caller picks one deterministically and passes it. Concatenating
// them produces text no one wrote.

import { useState } from 'react';
import s from './EventSummary.module.css';

// Past roughly four lines the block starts to dominate a column it shares with
// the ticket action. Clamped, with a reveal — never truncated with an ellipsis
// and no way back.
const CLAMP_AT_CHARS = 240;

export default function EventDescription({ text }) {
  const [open, setOpen] = useState(false);

  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) return null;   // R1 · absent

  const longEnoughToClamp = body.length > CLAMP_AT_CHARS;
  const clamped = longEnoughToClamp && !open;

  return (
    <div className={s.description}>
      <p className={s.descriptionText + (clamped ? ' ' + s.clamped : '')}>{body}</p>
      {longEnoughToClamp && (
        <button className={s.reveal} onClick={() => setOpen(v => !v)}>
          {open ? 'LESS' : 'MORE'}
        </button>
      )}
    </div>
  );
}
