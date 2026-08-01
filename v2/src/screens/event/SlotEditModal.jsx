// EP-00 · extracted verbatim from EventScreen.jsx. Host-only.
import { useState } from 'react';
import { LABEL_PALETTE, stripEmoji } from './slotUtils';

export default function SlotEditModal({ slot, onSave, onClose }) {
  const [time,       setTime]       = useState(slot.time  || '');
  const [ampm,       setAmpm]       = useState(slot.ampm  || 'PM');
  const [dur,        setDur]        = useState(String(slot.dur ?? slot.duration ?? ''));
  const [label,      setLabel]      = useState(stripEmoji(slot.label || ''));
  const [labelCol,   setLabelCol]   = useState(slot.labelColor || '');
  const [saving,     setSaving]     = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave({ time, ampm, dur: dur ? Number(dur) : null, label, labelColor: labelCol });
    setSaving(false);
  }

  const field = { width: '100%', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontFamily: 'inherit', fontSize: 14, boxSizing: 'border-box' };
  const lbl   = { fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.5, color: 'var(--muted)', display: 'block', marginBottom: 5 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, padding: '24px 20px 28px', width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2 }}>EDIT SLOT</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <span style={lbl}>TIME</span>
            <input style={field} value={time} onChange={e => setTime(e.target.value)} placeholder="9:00" />
          </div>
          <div>
            <span style={lbl}>AM/PM</span>
            <select style={{ ...field, padding: '10px 8px' }} value={ampm} onChange={e => setAmpm(e.target.value)}>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
          <div>
            <span style={lbl}>DURATION (mins)</span>
            <input style={field} type="number" value={dur} onChange={e => setDur(e.target.value)} placeholder="90" />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <span style={lbl}>LABEL (optional)</span>
          <div style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, overflow: 'hidden' }}>
            <input style={{ ...field, border: 'none', borderBottom: '1px solid rgba(255,255,255,.08)', borderRadius: 0 }} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. SUNSET SET" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'rgba(255,255,255,.03)' }}>
              <span style={{ fontFamily: "'Bebas Neue'", fontSize: 9, letterSpacing: 1.5, color: 'var(--muted)', flexShrink: 0 }}>COLOUR</span>
              {['', ...LABEL_PALETTE].map((col, i) => (
                <button key={i} onClick={() => setLabelCol(col)}
                  style={{
                    width: 16, height: 16, borderRadius: 4, cursor: 'pointer', flexShrink: 0,
                    background: col || 'rgba(255,255,255,.15)',
                    border: labelCol === col ? `2px solid #fff` : '2px solid transparent',
                    boxSizing: 'border-box', padding: 0,
                    transition: 'border-color .1s',
                  }} />
              ))}
            </div>
          </div>
        </div>

        <button onClick={handleSave} disabled={saving}
          style={{ width: '100%', padding: 13, borderRadius: 12, border: 'none', cursor: saving ? 'default' : 'pointer', fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: 2, background: saving ? 'rgba(255,255,255,.08)' : 'var(--neon2)', color: saving ? 'var(--muted)' : '#0a0a0f' }}
        >{saving ? 'SAVING…' : 'SAVE SLOT'}</button>
      </div>
    </div>
  );
}
