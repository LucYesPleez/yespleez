// Communal black/monochrome date pill — day name + day number + month,
// stacked. Shared by EventCard and EnquiryCard so every "date on a card"
// looks the same across the app.
export default function DateBox({ date, size = 'md' }) {
  if (!date) return null;
  const d = new Date(date + 'T12:00:00');
  const dayName = d.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase();
  const dayNum  = d.getDate();
  const mon     = d.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase();

  const dims = size === 'sm'
    ? { radius: 8, padding: '4px 8px', minWidth: 36, small: 9, big: 16 }
    : { radius: 10, padding: '6px 10px', minWidth: 44, small: 11, big: 22 };

  return (
    <div style={{ background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)', borderRadius: dims.radius, padding: dims.padding, textAlign: 'center', minWidth: dims.minWidth }}>
      <div style={{ fontFamily: "'Bebas Neue'", fontSize: dims.small, color: 'rgba(255,255,255,.7)', letterSpacing: .5 }}>{dayName}</div>
      <div style={{ fontFamily: "'Bebas Neue'", fontSize: dims.big, color: 'white', lineHeight: 1 }}>{dayNum}</div>
      <div style={{ fontFamily: "'Bebas Neue'", fontSize: dims.small, color: 'rgba(255,255,255,.7)', letterSpacing: .5 }}>{mon}</div>
    </div>
  );
}
