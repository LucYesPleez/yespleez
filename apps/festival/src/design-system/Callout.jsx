import Icon from './Icon';
import s from './Callout.module.css';

/**
 * A stated consequence, placed next to the control that causes it.
 *
 * ⭐ Used where an action is IRREVERSIBLE or wider than it looks. The rule
 * this component encodes: say the consequence beside the button, not in a
 * dialog after the click. A confirmation dialog asks "are you sure?" of
 * someone who has already decided; a callout tells them what they are
 * deciding while they can still change their mind cheaply.
 *
 * Tone lives on the border and the icon, never as a solid fill — a filled
 * block competes with the content it is warning about, and in a dark UI it
 * reads as an error that has already happened.
 */
const TONE_ICON = { info: 'help', warn: 'bell', danger: 'cross' };

export default function Callout({ tone = 'info', icon, title, children, actions }) {
  return (
    <div className={`${s.callout} ${s[tone]}`} role={tone === 'info' ? undefined : 'note'}>
      <span className={s.icon}>
        <Icon name={icon || TONE_ICON[tone]} size={17} />
      </span>
      <div className={s.body}>
        {title && <span className={s.title}>{title}</span>}
        {children && <span className={s.text}>{children}</span>}
        {actions && <span className={s.actions}>{actions}</span>}
      </div>
    </div>
  );
}
