import { PROFILE_BLURB_FIELDS, blurbPlaceholdersFor } from '../lib/profileBlurbFields';

/**
 * SOUND BIO + TAGLINE, rendered once for all five profile editors.
 *
 * ⛔⛔ THE ONLY PLACE THESE TWO FIELDS ARE RENDERED. Six editors previously
 * each wrote their own copy, which is how the labels, the limits and the
 * counters drifted apart. Adding a seventh copy re-opens that; extend the
 * registry in `lib/profileBlurbFields.js` instead.
 *
 * ⭐ PRESENTED AS PER THE HOST PROFILE (owner, 2026-09-05): the hint sits
 * beside the field's own label, not inside the section heading. Artist and
 * Venue put it in the heading, which pushed a per-field fact up to a level
 * that covered both fields, and is part of why the two ended up making
 * different claims about where the same column appears.
 *
 * ⚠ STYLES ARE INJECTED, NOT IMPORTED. The editors use three different CSS
 * modules and each carries its own accent colouring, so this takes `s` rather
 * than importing one and flattening four profile types into the fifth's
 * palette. Every module it is handed must define `field`, `fieldLabel`,
 * `fieldHint`, `input`, `textarea` and `charCount`.
 *
 * ⛔ THE SECTION WRAPPER IS THE CALLER'S. Each editor's local `Section`
 * carries that profile type's accent gradient; this renders the rows inside
 * it. The heading string is canonical and comes from `BLURB_SECTION_TITLE` —
 * the caller passes it to its own `Section`, so the accent stays local and the
 * wording stays shared.
 */
export default function BlurbFields({ s, type, sound, tagline, onSoundChange, onTaglineChange }) {
  const placeholders = blurbPlaceholdersFor(type);
  const values   = { sound, tagline };
  const handlers = { sound: onSoundChange, tagline: onTaglineChange };

  return (
    <>
      {PROFILE_BLURB_FIELDS.map(f => {
        // `|| ''` so an undefined prop cannot flip the input to uncontrolled
        // mid-edit, which drops the user's keystrokes without any error.
        const value = values[f.key] || '';
        const onChange = e => handlers[f.key] && handlers[f.key](e.target.value);
        const common = {
          className:   f.multiline ? s.textarea : s.input,
          value,
          onChange,
          placeholder: placeholders[f.key],
          maxLength:   f.maxLength,
        };
        return (
          <div className={s.field} key={f.key}>
            <label className={s.fieldLabel}>
              {f.label} <span className={s.fieldHint}>{f.hint}</span>
            </label>
            {f.multiline
              ? <textarea {...common} rows={2} />
              : <input {...common} autoComplete="off" />}
            {/* ⚠ Counts CHARACTERS THE USER CAN STILL TYPE, so it reads against
                the same number `maxLength` enforces. Two editors had this and
                four did not, which meant most people hit a silent wall. */}
            <div className={s.charCount}>{value.length} / {f.maxLength}</div>
          </div>
        );
      })}
    </>
  );
}
