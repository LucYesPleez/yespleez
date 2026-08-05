import { Button } from '../design-system';
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

export default function ActionButtons({ onAction }) {
  return (
    <div className={s.row}>
      {ACTIONS.map(({ key, label, icon, tone }) => (
        <Button
          key={key}
          variant="intent"
          tone={tone}
          size="sm"
          icon={icon}
          onClick={() => onAction?.(key)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
