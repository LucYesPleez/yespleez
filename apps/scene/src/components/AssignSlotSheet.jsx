import { durationLabel } from '../lib/eventSlots';

/**
 * PICK A SLOT FOR AN ACT — the other direction from `FillSlotModal`.
 *
 * ⚠⚠ ⛔ NOT `FillSlotModal`, and the two are easy to confuse. That one starts
 * from a SLOT and searches for an artist to put on it. This one starts from an
 * ACT already on the bill and asks which slot they should take. Same nouns,
 * opposite direction, and ⛔ neither should grow a flag to become the other.
 *
 * ⭐⭐ EXTRACTED VERBATIM from `EventHostView`, where it was 80 lines of inline
 * JSX bound to that screen's state. It moved because the DASHBOARD needs the
 * same act, and §11's rule is the reason it was extracted rather than copied:
 * that rule was written to stop these two screens drifting, then broken within
 * hours by its own author, because a convention that two files must agree is
 * not a mechanism. A shared component is.
 *
 * ⛔ IT HOLDS NO RULES AND WRITES NOTHING. It renders the slots it is given and
 * calls `onPick`. What that does — create a draft, offer, or accept an
 * application at the same time — belongs to the caller, and the two callers
 * genuinely differ: the application route accepts and notifies, the member
 * route only drafts.
 *
 * @param name         who is being placed, for the subtitle
 * @param days         `[{ slots: [...] }]` from `groupSlotsIntoDays`
 * @param claims       slotId → the primary claim, for "Currently: …"
 * @param claimsBySlot slotId → EVERY claim on it. ⚠ Preferred over `claims`:
 *                     on a contested slot the single map names one of two acts
 *                     at random, which is what this used to display.
 * @param quiet        show the "nobody is notified" line. ⚠ TRUE for the member
 *                     route, ⛔ false for the application route, which DOES
 *                     notify — saying otherwise would be a promise the caller
 *                     then breaks.
 */
export default function AssignSlotSheet({ name, days = [], claims = {}, claimsBySlot = {}, quiet = false, onPick, onClose }) {
  const allSlots = days.flatMap(d => d.slots || []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', zIndex: 2000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 'var(--yp-safe-bottom)' }}
      onClick={onClose}>
      <div style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 -4px 40px rgba(0,0,0,.6)', border: '1px solid rgba(255,255,255,.07)', borderBottom: 'none' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 2 }}>ASSIGN SET TIME</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>Pick a slot for {name || '—'}</div>
            {/* ⚠ Says the quiet part out loud on the member route: the
                organiser is placing somebody in the running order, ⛔ not
                telling them. The bulk SEND button is what speaks. */}
            {quiet && (
              <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4, opacity: .8 }}>
                Saved as a draft. Nobody is notified until you send set times.
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 24, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 20px 32px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {allSlots.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>No slots yet — add slots in the LINEUP editor first.</p>
          )}
          {allSlots.map(slot => {
            const existing = claims[slot.id];
            const isFilled = existing && existing.status !== 'declined';
            const timeLabel = [slot.time, slot.ampm].filter(Boolean).join(' ');
            /* ⚠ WAS `slot.dur >= 60 ? … : `${slot.dur}m``, which printed
               `1.5 hrsm` for every slot whose `dur` was the string "1.5 hrs" —
               the comparison is false against a string, so it fell to the
               minutes branch and concatenated the unit twice. `durationLabel`
               is the one formatter now. */
            const durLabel = durationLabel(slot.dur);
            /* Every act on the slot, not just the one the map picked. On a
               contested slot "Currently: X" was naming one of two at random. */
            const onSlot = claimsBySlot[slot.id] || (existing ? [existing] : []);
            return (
              <button key={slot.id} onClick={() => onPick(slot)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                  border: `1px solid ${isFilled ? 'rgba(255,255,255,.08)' : 'rgba(0,229,160,.25)'}`,
                  background: isFilled ? 'rgba(255,255,255,.03)' : 'rgba(0,229,160,.06)',
                }}>
                <div>
                  <div style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1, color: isFilled ? 'rgba(255,255,255,.5)' : '#fff' }}>
                    {timeLabel}{durLabel ? ` — ${durLabel}` : ''}{slot.label ? ` · ${slot.label}` : ''}
                  </div>
                  {isFilled && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', marginTop: 2 }}>Currently: {onSlot.map(c => c.name).filter(Boolean).join(' · ')}</div>}
                </div>
                <span style={{ fontSize: 11, fontFamily: "'Bebas Neue'", letterSpacing: 1, color: isFilled ? 'rgba(255,255,255,.3)' : '#00E5A0', flexShrink: 0, marginLeft: 12 }}>
                  {isFilled ? 'REASSIGN' : 'OPEN →'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
