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

/**
 * ── ⚠ ONE GRID, TWO FRAMES ───────────────────────────────────────────
 *
 * Extracted so the private dashboard can render this calendar INLINE while the
 * public one keeps its modal. It is the same grid reading the same availability
 * dates — the alternative was a second calendar, which is the one thing the
 * dashboard work was told not to build.
 *
 * ⛔ `markers` IS THE ONLY PRIVATE INPUT, and it is optional. Every existing
 * caller omits it and renders exactly as before, which is what keeps the public
 * calendar incapable of leaking application activity: it cannot disclose what
 * it is never given. The privacy boundary is the absence of a prop, not a
 * conditional inside a shared component that someone could later invert.
 *
 * @param {Record<string, string[]>} [markers] dateStr → dot colours, already
 *        resolved by the caller. This component does not know what a status is.
 */
export function CalendarGrid({
  month, availableDates, eventDates, markers,
  mode = 'view', readOnly = false, onSelectDate, selectedDate,
  accent = '#00E5FF', accentRgb = '0,229,255',
  compact = false,
}) {
  const availSet = toSet(availableDates);
  const eventSet = toSet(eventDates);
  const todayStr = new Date().toISOString().split('T')[0];
  const yr = month.getFullYear(), mo = month.getMonth();
  const firstDay = new Date(yr, mo, 1).getDay();
  const daysInMonth = new Date(yr, mo + 1, 0).getDate();
  const hasMarkers = !!markers;

  // One definition, used by real cells AND by the trailing spacers below, so
  // the two are guaranteed to be the same height.
  const showsDotRow = mode === 'view' || hasMarkers;
  const cellPad  = showsDotRow ? '7px 2px 4px' : '7px 2px';
  const cellFont = compact ? 12 : 13;

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} />);
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isPast   = ds < todayStr;
    const hasEvent = mode === 'view' && eventSet.has(ds);
    const isAvail  = !hasEvent && availSet.has(ds);
    const isToday  = ds === todayStr;
    const dots     = markers?.[ds] || [];
    /**
     * ⚠ EDIT MODE STILL REFUSES THE PAST, MARKERS OR NOT.
     *
     * The overlay made every date inspectable, which is right for a diary — a
     * past date still holds the record of what happened on it. But in the
     * EDITOR a tap writes availability, and letting the overlay open up past
     * dates would have quietly turned "you can now inspect any day" into "you
     * can now mark yourself free last Tuesday". Two different meanings for one
     * gesture, separated by which mode the calendar happens to be in.
     */
    const tappable = mode === 'edit'
      ? (!readOnly && !isPast)
      : hasMarkers
        ? !!onSelectDate
        : (!readOnly && !isPast && isAvail);
    const isSelected = selectedDate === ds;
    cells.push(
      <div key={ds}
        onClick={() => tappable && onSelectDate && onSelectDate(ds)}
        style={{
          textAlign: 'center', padding: cellPad,
          borderRadius: 6, fontSize: cellFont,
          background: isAvail ? `rgba(${accentRgb},.18)` : 'rgba(255,255,255,.04)',
          color: isPast ? 'rgba(255,255,255,.2)' : isAvail ? accent : 'var(--text)',
          border: isSelected ? '1px solid #fff'
            : isAvail ? `1px solid rgba(${accentRgb},.5)`
            : isToday ? '1px solid rgba(255,255,255,.3)' : '1px solid transparent',
          cursor: tappable ? 'pointer' : 'default',
          transition: 'background .15s, border-color .15s',
          ...(showsDotRow ? { display: 'flex', flexDirection: 'column', alignItems: 'center' } : null),
        }}>
        <span>{d}</span>
        {/* ⚠ THE DOT ROW ALWAYS RESERVES ITS HEIGHT, marked or not. Without it
            every row of the month jumps as dots appear, and a calendar whose
            geometry depends on its contents is unreadable at a glance. */}
        {hasMarkers ? (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center', minHeight: 7, marginTop: 2, maxWidth: '100%' }}>
            {dots.slice(0, 6).map((c, i) => (
              <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: c, display: 'block' }} />
            ))}
          </span>
        ) : mode === 'view' ? (hasEvent
          ? <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#FF2D78', marginTop: 2, display: 'block' }} />
          : <span style={{ height: 7, display: 'block' }} />
        ) : null}
      </div>
    );
  }

  /**
   * ── ⚠ THE MONTH IS ALWAYS SIX ROWS TALL ──────────────────────────────
   *
   * Months need four, five or six week rows depending on where the 1st falls.
   * This sheet is anchored to the BOTTOM of the screen, so a taller month grew
   * the panel UPWARDS — and the ‹ › chevrons, the title and everything else
   * above the grid moved with it. Paging from July to August shifted the
   * control you were mid-click on, so you had to find it again to keep going.
   *
   * ⭐ THE CHEVRONS MUST NOT MOVE WHILE YOU ARE USING THEM. Reserving all six
   * rows every month makes the calendar a fixed size, so it can only ever
   * extend DOWNWARD into space already allocated. The header sits still.
   *
   * ⛔ Not a hardcoded pixel height — the spacers carry the real cell's own
   * padding, font size and border, so the reserved row is exactly as tall as a
   * real one in every mode (the dot row makes a marked calendar taller than a
   * plain one, and a hardcoded value would be wrong for one of them).
   */
  const ROWS = 6, COLS = 7;
  while (cells.length < ROWS * COLS) {
    cells.push(
      <div key={`pad${cells.length}`} aria-hidden="true"
        style={{
          visibility: 'hidden', textAlign: 'center', padding: cellPad,
          fontSize: cellFont, border: '1px solid transparent',
          ...(showsDotRow ? { display: 'flex', flexDirection: 'column', alignItems: 'center' } : null),
        }}>
        <span>0</span>
        {/* ⚠ MIRRORS THE REAL CELL'S DOT ROW EXACTLY, per mode. A marked cell's
            row is `minHeight 7 + marginTop 2`; view mode's placeholder is a
            bare `height 7` with no margin. Giving the spacer the marker
            version in both made a spacer row 2px taller than a real one, so a
            month whose last row was all spacers stood 2px taller than one that
            filled it — and the header still moved, just less. */}
        {hasMarkers
          ? <span style={{ minHeight: 7, marginTop: 2, display: 'block' }} />
          : mode === 'view' ? <span style={{ height: 7, display: 'block' }} /> : null}
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 4 }}>
        {DAY_LABELS.map((d, i) => <div key={i} style={{ textAlign: 'center', fontSize: 10, color: 'var(--muted)', fontFamily: "'Bebas Neue'" }}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>{cells}</div>
    </>
  );
}

/** Month back / label / forward. Shared by the modal and the inline calendar. */
export function MonthNav({ month, setMonth }) {
  const yr = month.getFullYear(), mo = month.getMonth();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <button onClick={() => setMonth(new Date(yr, mo - 1, 1))} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>‹</button>
      <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: 'var(--text)' }}>{month.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }).toUpperCase()}</span>
      <button onClick={() => setMonth(new Date(yr, mo + 1, 1))} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>›</button>
    </div>
  );
}

export default function AvailabilityCalendar({
  onClose,
  title,
  subtitle,
  accent = '#00E5FF',
  accentRgb = '0,229,255',
  availableDates,
  eventDates,
  mode = 'view',
  readOnly = false,
  onSelectDate,
  month: controlledMonth,
  onMonthChange,
  footer,
  /**
   * ── ⚠ THE PRIVATE OVERLAY, AND THE ONLY THING THAT MAKES THIS CALENDAR
   * PRIVATE ────────────────────────────────────────────────────────────
   *
   * `markers` is dateStr → dot colours, and `selectedDate` is which day the
   * caller has opened. Both are OPTIONAL and every public caller omits them,
   * so this component renders availability and nothing else unless a private
   * surface hands it more.
   *
   * ⛔ THERE IS NO `isPrivate` FLAG, DELIBERATELY. A boolean would put the
   * privacy decision inside a shared component where a later edit could invert
   * it; passing the data or not means the public calendar is incapable of
   * disclosing application activity rather than merely instructed not to.
   */
  markers,
  selectedDate,
}) {
  const [internalMonth, setInternalMonth] = useState(firstOfCurrentMonth);
  const month    = controlledMonth || internalMonth;
  const setMonth = onMonthChange || setInternalMonth;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 'var(--yp-safe-bottom)' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: '24px 20px 100px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: 2, color: accent }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        {subtitle && <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{subtitle}</p>}
        <MonthNav month={month} setMonth={setMonth} />
        <CalendarGrid
          month={month}
          availableDates={availableDates}
          eventDates={eventDates}
          mode={mode}
          readOnly={readOnly}
          onSelectDate={onSelectDate}
          markers={markers}
          selectedDate={selectedDate}
          accent={accent}
          accentRgb={accentRgb}
        />
        {footer}
      </div>
    </div>
  );
}
