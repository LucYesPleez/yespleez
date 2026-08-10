import s from './RequirementChecklist.module.css';
import { requestableBySection, requirementLabel } from '../requirements.js';

/* ── Requirements checklist ──────────────────────────────────────────────
 *
 * Design §5.3: "A checklist. Tick what you need." No builder, no predicates,
 * no tiers, no engine terminology. The owner never sees a requirement key, a
 * section is only a visual grouping, and the word on screen is Requirements —
 * `required_items` stays internal.
 *
 * The rows come from the engine's registry via requestableBySection(), so this
 * component cannot offer a key the engine is unable to resolve, and a new
 * asset type appears here the moment it is added to profileAssets.js.
 *
 * The tick-boxes sit in two columns rather than one long vertical list, so a
 * 19-item, 5-section checklist reads as one compact window rather than a
 * page-length scroll.
 *
 * ── ⭐⭐ WHY THIS LIVES IN @yespleez/requirements AND NOT THE EVENT EDITOR ──
 *
 * It was born inside EventEditorForm, which was right while an event was the
 * only thing that could ask for something. It no longer is: a venue and a host
 * declare STANDING requirements on their profile, and Scene's profile editors
 * must not import from an *event* editor to render them — a venue profile has
 * no business depending on that package.
 *
 * So it moved to the package that owns the SUBJECT. The engine's own docblock
 * already said this was coming: it "knows nothing about who is asking … whether
 * the ask is an application, an enquiry, a booking or an accreditation".
 *
 * ⛔⛔ IT MUST NEVER LEARN WHO IS ASKING. There is no `mode`, no
 * `context: 'event' | 'profile'`, and there must not be. The one place the two
 * callers genuinely differ — the sentence explaining what ticking means — is a
 * PROP the caller supplies, because only the caller knows whether the thing
 * being blocked is an application or an enquiry. A branch in here on consumer
 * identity is a finding about the boundary, not a shortcut.
 */

/**
 * @param {object}   props
 * @param {string[]} props.selected  ticked requirement keys
 * @param {Function} props.onToggle  called with the key that was clicked
 * @param {React.ReactNode} [props.intro]
 *   The sentence above the boxes. Supplied by the caller because it names the
 *   consequence — "an application can't send until it's met" is true of an
 *   event, "nobody can enquire until it's met" is true of a venue, and this
 *   component is not allowed to know which one it is rendering for. Omitted:
 *   no sentence renders, never a generic one that is wrong for someone.
 */
export default function RequirementChecklist({ selected, onToggle, intro }) {
  const groups = requestableBySection();
  const ticked = Array.isArray(selected) ? selected : [];
  return (
    <div className={s.card}>
      {intro && (
        <p style={{ fontSize:13, color:'rgba(255,255,255,0.55)', lineHeight:1.6, padding:'2px 2px 12px' }}>
          {intro}
        </p>
      )}
      {groups.map((g, gi) => (
        <div key={g.section}>
          {gi > 0 && <div className={s.divider} />}
          <p style={{ fontFamily:"'Bebas Neue'", fontSize:11, letterSpacing:2, color:'var(--muted)', margin:'14px 2px 6px' }}>
            {g.section.toUpperCase()}
          </p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', columnGap:8 }}>
            {g.keys.map(key => {
              const on = ticked.includes(key);
              return (
                <button
                  type="button" key={key} onClick={() => onToggle(key)}
                  style={{
                    display:'flex', alignItems:'center', gap:10, width:'100%',
                    background:'none', border:'none', padding:'8px 2px',
                    cursor:'pointer', textAlign:'left', minWidth:0,
                  }}
                >
                  <span style={{
                    width:18, height:18, flexShrink:0, borderRadius:5,
                    border:`1.5px solid ${on ? '#00E5A0' : 'rgba(255,255,255,0.25)'}`,
                    background: on ? 'rgba(0,229,160,0.18)' : 'transparent',
                    color:'#00E5A0', fontSize:12, lineHeight:'15px', textAlign:'center',
                    transition:'all .15s',
                  }}>{on ? '✓' : ''}</span>
                  <span style={{
                    fontSize:14, color: on ? 'var(--text)' : 'rgba(255,255,255,0.6)',
                    overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis',
                  }}>
                    {requirementLabel(key)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
