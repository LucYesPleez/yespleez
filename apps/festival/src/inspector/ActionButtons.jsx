import { Button } from '../design-system';
import { DECISIONS, PAST_TENSE } from './decisions';
import s from './ActionButtons.module.css';

/**
 * The decision row: message, shortlist, accept, decline.
 *
 * ⭐ THE POSITION IS THE CONTRACT. These four never move and never reorder
 * between applications. A reviewer working through four hundred rows builds
 * muscle memory in the first ten, and a button that shifts because one
 * applicant has an extra field will eventually cause a mis-click on a
 * decision that reaches a real person.
 *
 * Colour arrives on hover only. Four coloured buttons at rest read as four
 * competing alarms; at rest this should read as a row of equals.
 */
const ACTIONS = [
  { key: 'message',   label: 'Message',   icon: 'messages', tone: 'message' },
  { key: 'shortlist', label: 'Shortlist', icon: 'star',     tone: 'shortlist' },
  { key: 'accept',    label: 'Accept',    icon: 'check',    tone: 'accept' },
  { key: 'decline',   label: 'Decline',   icon: 'cross',    tone: 'decline' },
];

/**
 * ⭐⭐ THE DECISION ALREADY MADE IS A STATE, NOT AN ACTION. The status an
 * applicant already holds is named in the past tense and rendered in its own
 * colour, and it cannot be pressed.
 *
 * ⛔ IT MUST NOT ARRIVE MUTED. `disabled` alone dims a control to .45, which
 * is the visual language of "unavailable" — on an accepted applicant that read
 * as "pending, press me", and on 2026-08-28 the owner pressed Accept on an
 * application that had already been accepted AND released, re-stamping
 * `decided_at` to after the moment the applicant was told. A decision that
 * invites its own repetition is a defect, not a cosmetic one.
 */
export default function ActionButtons({ onAction, busy = false, unavailable = [], status = null }) {
  return (
    <div className={s.row}>
      {ACTIONS.map(({ key, label, icon, tone }) => {
        const isCurrent = status != null && DECISIONS[key] === status;
        return (
          <Button
            key={key}
            variant="intent"
            tone={tone}
            size="sm"
            icon={icon}
            className={isCurrent ? s.current : ''}
            // A disabled button stays visible and keeps its position — the row
            // must not reflow because one action is unavailable.
            disabled={busy || isCurrent || unavailable.includes(key)}
            // ⭐ The current state is not an action, so it announces itself as
            // one rather than as a button a reader is expected to press.
            aria-current={isCurrent ? 'true' : undefined}
            onClick={() => { if (!isCurrent) onAction?.(key); }}
          >
            {isCurrent ? PAST_TENSE[key] : label}
          </Button>
        );
      })}
    </div>
  );
}
