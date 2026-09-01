import { channelChips } from '../lib/notificationChannels3';
import s from './NotificationChannelChips.module.css';

/**
 * THE THREE CHANNELS, AT THE TOP, AS NAVIGATION.
 *
 * ⛔⛔ IT OWNS NO PREFERENCE STATE. Every value is passed in by the panel that
 * owns it, and every press does exactly one thing: reveal and scroll to that
 * panel. ⛔ If a press ever writes a setting, this has become a second settings
 * system and the two will disagree.
 *
 * ⚠ A ROW THAT SCROLLS, ⛔ NOT ONE THAT WRAPS. Three chips fit on a phone, but
 * the labels are translatable and the status word varies; a wrapped second row
 * would push the thing they point at further down the page, which is the exact
 * problem this component exists to solve.
 */
export default function NotificationChannelChips({ push, email, onGo }) {
  const chips = channelChips({ push, email });

  return (
    <div className={s.row} role="group" aria-label="Notification channels">
      {chips.map(c => (
        <button
          key={c.key}
          type="button"
          className={s.chip}
          /* ⚠ THE STATE IS ANNOUNCED, ⛔ not just drawn. A screen reader user
             gets "Email, on, jump to section" rather than two unrelated words,
             and `aria-label` carries it because the visual split into two spans
             would otherwise be read as fragments. */
          aria-label={`${c.label}, ${c.on === null ? 'loading' : (c.on ? 'on' : 'off')}, jump to section`}
          onClick={() => onGo(c.key)}
        >
          <span className={s.label}>{c.label}</span>
          <span
            className={[
              s.status,
              c.on === true ? s.on : '',
              c.on === false ? s.off : '',
            ].filter(Boolean).join(' ')}
          >
            {c.status}
          </span>
        </button>
      ))}
    </div>
  );
}
