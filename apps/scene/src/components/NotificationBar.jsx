export default function NotificationBar({ message, onClick, color = '#ffb830' }) {
  if (!message) return null;
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: `${color}12`,
        border: `1px solid ${color}4D`,
        borderRadius: 10, padding: '10px 14px', marginBottom: 16,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, letterSpacing: 1, color }}>{message}</span>
    </div>
  );
}
