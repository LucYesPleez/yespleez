/**
 * CardTagPicker — reusable "pick up to N tags" chip selector.
 *
 * Props:
 *   tagPool    string[]   all available tags to choose from
 *   selected   string[]   currently selected tags
 *   onChange   fn         called with new selected array
 *   max        number     max selections (default 5)
 *   accent     string     active chip colour (default #00E5FF)
 *   accentRgb  string     "r,g,b" for `accent` — pass PROFILE_TYPES[type].rgb (default '0,229,255')
 *   hint       string     optional helper text below chips
 */
export default function CardTagPicker({
  tagPool = [],
  selected = [],
  onChange,
  max = 5,
  accent = '#00E5FF',
  accentRgb = '0,229,255',
  hint,
}) {
  if (!tagPool.length) return null;

  function toggle(tag) {
    if (selected.includes(tag)) {
      onChange(selected.filter(t => t !== tag));
    } else if (selected.length < max) {
      onChange([...selected, tag]);
    }
  }

  const chipBase = {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 12,
    letterSpacing: 1.2,
    padding: '5px 12px',
    borderRadius: 20,
    border: '1px solid',
    cursor: 'pointer',
    transition: 'all .15s',
  };

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {tagPool.map(t => {
          const on = selected.includes(t);
          const disabled = !on && selected.length >= max;
          return (
            <button
              key={t}
              type="button"
              disabled={disabled}
              onClick={() => toggle(t)}
              style={{
                ...chipBase,
                background: on ? `linear-gradient(to right, rgba(${accentRgb},.18), transparent)` : `rgba(${accentRgb},.05)`,
                borderColor: on ? accent : `rgba(${accentRgb},.2)`,
                boxShadow: on ? `0 0 8px rgba(${accentRgb},.22)` : 'none',
                color: on ? accent : 'var(--muted)',
                opacity: disabled ? 0.35 : 1,
                cursor: disabled ? 'default' : 'pointer',
              }}
            >{t}</button>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {hint && <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>{hint}</p>}
        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, color: selected.length >= max ? accent : 'var(--muted)', marginLeft: 'auto' }}>
          {selected.length} / {max} selected
        </span>
      </div>
    </div>
  );
}
