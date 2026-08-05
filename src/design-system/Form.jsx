import { useId } from 'react';
import Icon from './Icon';
import s from './Form.module.css';

/**
 * FORM PRIMITIVES.
 *
 * One family, one file — Field, TextInput, Textarea, Select, Toggle and Row
 * are never used apart, and splitting them into six modules would only mean
 * six imports at every call site. The file exports components only, so Fast
 * Refresh is unaffected.
 *
 * ⛔ NO FORM STATE, NO VALIDATION, NO SUBMISSION. These are controlled inputs
 * that report changes upward. What they fix is the SHAPE — label placement,
 * hint position, focus treatment, how a disabled control reads — so that
 * wiring a real form later changes behaviour without moving anything.
 *
 * ⭐ "Optional" is marked; "required" is not. Marking the few optional fields
 * reads as reassurance. Marking the many required ones reads as a warning
 * about a form you have not filled in yet — and every applicant-facing form
 * in this product will be mostly required.
 */

export function Field({ label, hint, optional, htmlFor, children }) {
  return (
    <div className={s.field}>
      {label && (
        <div className={s.labelRow}>
          <label className={s.label} htmlFor={htmlFor}>{label}</label>
          {optional && <span className={s.optional}>Optional</span>}
        </div>
      )}
      {children}
      {hint && <span className={s.hint}>{hint}</span>}
    </div>
  );
}

export function TextInput({ label, hint, optional, ...rest }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} optional={optional} htmlFor={id}>
      <input id={id} className={s.control} type="text" {...rest} />
    </Field>
  );
}

export function Textarea({ label, hint, optional, rows = 4, ...rest }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} optional={optional} htmlFor={id}>
      <textarea id={id} rows={rows} className={`${s.control} ${s.textarea}`} {...rest} />
    </Field>
  );
}

export function Select({ label, hint, optional, options = [], ...rest }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} optional={optional} htmlFor={id}>
      <span className={s.selectWrap}>
        <select id={id} className={`${s.control} ${s.select}`} {...rest}>
          {options.map(o => (
            <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
          ))}
        </select>
        <span className={s.selectChevron}><Icon name="chevron" size={15} /></span>
      </span>
    </Field>
  );
}

/**
 * A switch, not a checkbox — these settings take effect when flipped, and a
 * checkbox implies a form you still have to submit.
 */
export function Toggle({ label, hint, checked = false, onChange, disabled }) {
  return (
    <div className={s.toggleRow}>
      <span className={s.toggleText}>
        <span className={s.label}>{label}</span>
        {hint && <span className={s.hint}>{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`${s.toggle} ${checked ? s.toggleOn : ''}`}
        onClick={() => onChange?.(!checked)}
      >
        <span className={s.knob} />
      </button>
    </div>
  );
}

/** Two fields side by side, collapsing to one when the pane is narrow. */
export function Row({ children }) {
  return <div className={s.row}>{children}</div>;
}
