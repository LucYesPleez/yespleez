import { useState } from 'react';

// Shared availability calendar modal (11C.2). Extracted from two previously
// duplicated, drifted implementations: ProfileScreen's venue "VENUE
// AVAILABILITY" viewer and AvailabilitySection's "MY AVAILABILITY" editor.
// Presentation only — the parent supplies the dates and owns what a tap does
// (enquire vs toggle). No data fetching, no business logic here.
//
//   mode="view"  — read/enquire: only available future dates are tappable;
//                  event days render a pink dot (needs `eventDates`).
//   mode="edit"  — any future date is tappable (the parent toggles it).
//
// Month is uncontrolled by default (resets to the current month each time the
// modal mounts, matching the editor). Pass month/onMonthChange to control it —
// the venue viewer does, to preserve its remembered month across reopens.

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const firstOfCurrentMonth = () => { const d = new Date(); d.setDate(1); return d; };
const toSet = v => (v instanceof Set ? v : new Set(v || []));

export default function AvailabilityCalendar({
  onClose,
  title,
  subtitle,
  accent = '#00E5FF',
  accentRgb = '0,229,255',
  availableDates,
  eventDates,
  mode = 'view',
  onSelectDate,
  month: controlledMonth,
  onMonthChange,
  footer,
}) {
  const [internalMonth, setInternalMonth] = useState(firstOfCurrentMonth);
  const month    = controlledMonth || internalMonth;
  const setMonth = onMonthChange || setInternalMonth;

  const availSet = toSet(availableDates);
  const eventSet = toSet(eventDates);
  const todayStr = new Date().toISOString().split('T')[0];
  const yr = month.getFullYear(), mo = month.getMonth();
  const firstDay = new Date(yr, mo, 1).getDay();
  const daysInMonth = new Date(yr, mo + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} />);
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isPast   = ds < todayStr;
    const hasEvent = mode === 'view' && eventSet.has(ds);
    const isAvail  = !hasEvent && availSet.has(ds);
    const isToday  = ds === todayStr;
    const tappable = mode === 'edit' ? !isPast : (!isPast && isAvail);
    cells.push(
      <div key={ds}
        onClick={() => tappable && onSelectDate && onSelectDate(ds)}
        style={{
          textAlign: 'center', padding: mode === 'view' ? '7px 2px 4px' : '7px 2px', borderRadius: 6, fontSize: 13,
          background: isAvail ? `rgba(${accentRgb},.18)` : 'rgba(255,255,255,.04)',
          color: isPast ? 'rgba(255,255,255,.2)' : isAvail ? accent : 'var(--text)',
          border: isAvail ? `1px solid rgba(${accentRgb},.5)` : isToday ? '1px solid rgba(255,255,255,.3)' : '1px solid transparent',
          cursor: tappable ? 'pointer' : 'default',
          transition: 'background .15s',
          ...(mode === 'view' ? { display: 'flex', flexDirection: 'column', alignItems: 'center' } : null),
        }}>
        {mode === 'view' ? <span>{d}</span> : d}
        {mode === 'view' && (hasEvent
          ? <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#FF2D78', marginTop: 2, display: 'block' }} />
          : <span style={{ height: 7, display: 'block' }} />
        )}
      </div>
    );
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 'var(--yp-safe-bottom)' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: '24px 20px 100px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: 2, color: accent }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        {subtitle && <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{subtitle}</p>}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button onClick={() => setMonth(new Date(yr, mo - 1, 1))} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>‹</button>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: 'var(--text)' }}>{month.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }).toUpperCase()}</span>
          <button onClick={() => setMonth(new Date(yr, mo + 1, 1))} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 4 }}>
          {DAY_LABELS.map((d, i) => <div key={i} style={{ textAlign: 'center', fontSize: 10, color: 'var(--muted)', fontFamily: "'Bebas Neue'" }}>{d}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
          {cells}
        </div>
        {footer}
      </div>
    </div>
  );
}
