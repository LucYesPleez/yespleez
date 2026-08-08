// Returns YYYY-MM-DD string for a date offset from today (local timezone)
export function dateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today() { return dateStr(0); }

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// THIS weekend, always the full Friday–Sunday, local timezone (toISOString shifts UTC which
// breaks AU timezones). When today is Sat or Sun we are already IN the weekend, so anchor to
// the Friday just gone — not the next one — otherwise "THIS WEEKEND" advertises next weekend.
// The range therefore reaches into the past mid-weekend, which is intended: it describes the
// weekend, not what is left of it. Callers that fetch or list events must exclude past dates
// themselves. The roll-over to the following weekend happens Monday morning.
export function weekendRange() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun,1=Mon,...,6=Sat
  // Sat -> -1, Sun -> -2, otherwise forward to the coming Friday (0 when today IS Friday)
  const daysToFri = day === 6 ? -1 : day === 0 ? -2 : 5 - day;
  const fri = new Date(now); fri.setDate(now.getDate() + daysToFri);
  const sun = new Date(fri); sun.setDate(fri.getDate() + 2);
  return { from: localDateStr(fri), to: localDateStr(sun) };
}

export function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateRange(startStr, endStr) {
  if (!startStr) return '';
  const fmt = s => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  if (!endStr || endStr === startStr) return fmt(startStr);
  return `${fmt(startStr)} – ${fmt(endStr)}`;
}

export function monthName(dateStr) {
  if (!dateStr) return '';
  const [y, m] = dateStr.split('-').map(Number);
  return new Date(y, m - 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}
