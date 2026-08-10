import { requirementLabel } from '../requirements.js';
import { isMet, stateUi } from './verdictState.js';

/* ── The requirements verdict, ASKED-OF side ─────────────────────────────
 *
 * What someone is being asked for, and how much of it they already have.
 *
 * ⭐⭐ THE SIBLING OF RequirementChecklist, AND THE DIVISION IS SHARP:
 *
 *   RequirementChecklist   — the INPUT. Ticked by the party doing the asking
 *                            (a host defining an event, a venue setting its
 *                            standing bar). Writes `required_items`. Knows
 *                            nothing about any profile.
 *   RequirementsVerdict    — the READ-ONLY. Shown to the party being asked.
 *                            Renders an `evaluate()` result. Writes nothing.
 *
 * One decides what is wanted; the other reports whether it is there. Keeping
 * them apart is why neither needs a `mode` flag: they are not two views of one
 * component, they are two components with opposite jobs.
 *
 * Every ticked item is mandatory — field or file alike (2026-08-03: the owner
 * overrode design §5.2's field-blocks/file-requests split; see the note above
 * REQUIREMENT_KEYS in requirements.js). One tick means one requirement, so
 * there is nothing left for the person to learn about tiers.
 *
 * Deliberately shown BEFORE the send button, not after a refusal. The point is
 * to let someone go and fix a gap while it still matters — a checklist
 * revealed on rejection is a post-mortem.
 *
 * ⛔ IT MUST NEVER LEARN WHO IS ASKING. The two things its callers genuinely
 * differ on — what to call the asker, and where the fix lives — are PROPS.
 * An event says "WHAT THIS HOST ASKS FOR"; a venue profile says "WHAT THIS
 * VENUE ASKS FOR"; a future accreditation will say something else again. A
 * branch in here on consumer identity is a finding about the boundary.
 */



/**
 * @param {object} props
 * @param {object} props.evaluation  an `evaluate()` result
 * @param {string} [props.title]     what to call the asker — the caller knows,
 *                                   this component must not. Defaults to a
 *                                   neutral heading rather than guessing.
 * @param {string} [props.editPath]  hash route to where the gap is closed.
 *                                   Omitted: no link renders. Naming a gap is
 *                                   not the same as being able to close it —
 *                                   without this, someone is told "Press Kit
 *                                   NEEDED" and left to already know that press
 *                                   kits live in the profile editor's Assets
 *                                   section, the one screen they cannot reach
 *                                   from here.
 * @param {object} [props.style]     outer-container overrides (spacing only).
 */
export default function RequirementsVerdict({ evaluation, title = 'WHAT IS ASKED FOR', editPath, style }) {
  if (!evaluation) return null;
  return (
    <div style={{ marginBottom: 10, padding: '10px 12px', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, ...style }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1.5, color: 'var(--muted)' }}>{title}</span>
        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: .5, color: evaluation.satisfiedCount === evaluation.totalCount ? '#00E5A0' : 'var(--muted)' }}>
          {evaluation.satisfiedCount}/{evaluation.totalCount}
        </span>
      </div>
      {evaluation.items.map(it => {
        const ui = stateUi(it.state);
        const met = isMet(it.state);
        return (
          <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
            <span style={{ color: ui.color, fontSize: 12, width: 12, flexShrink: 0 }}>{ui.mark}</span>
            <span style={{ fontSize: 13, color: met ? 'var(--text)' : 'var(--muted)', flex: 1 }}>{requirementLabel(it.key)}</span>
            {/* Every unmet requirement is a blocking one now, so NEEDED shows
                on all of them — the flag stays keyed on `it.blocking` rather
                than on `!met` alone, because an UNRECOGNISED key (a stale
                requirement the registry no longer knows) is deliberately
                non-blocking and must not be labelled as something the person
                can fix. */}
            {!met && it.blocking && (
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, color: '#FFD700' }}>NEEDED</span>
            )}
          </div>
        );
      })}
      {editPath && !evaluation.canSubmit && (
        <a href={`#${editPath}`}
          style={{ display: 'inline-block', marginTop: 8, fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1, color: 'var(--neon2)' }}>
          ADD WHAT&rsquo;S MISSING →
        </a>
      )}
    </div>
  );
}


