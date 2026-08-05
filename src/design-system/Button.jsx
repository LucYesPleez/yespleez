import Icon from './Icon';
import s from './Button.module.css';

/**
 * Every clickable affordance in the portal.
 *
 * Variants exist so a screen author never picks colours: `primary` is the one
 * gradient action, `secondary` is a bordered action, `ghost` disappears into
 * its surface, `quiet` is a control that should not compete (filters, page
 * numbers), and `intent` carries a decision colour that only appears on hover.
 *
 * A disabled button stays VISIBLE. A control that vanishes when unavailable
 * reads as a bug; one that is present and dimmed reads as a policy.
 */
export default function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  tone,
  block = false,
  className = '',
  ...rest
}) {
  const iconOnly = !children && (icon || iconRight);
  const classes = [
    s.btn,
    s[size],
    s[variant],
    tone && s[`tone${tone[0].toUpperCase()}${tone.slice(1)}`],
    iconOnly && s.iconOnly,
    block && s.block,
    className,
  ].filter(Boolean).join(' ');

  const glyph = size === 'sm' ? 14 : size === 'lg' ? 18 : 16;

  return (
    <button type="button" className={classes} {...rest}>
      {icon && <Icon name={icon} size={glyph} />}
      {children}
      {iconRight && <Icon name={iconRight} size={glyph} />}
    </button>
  );
}
