// Communal event tab bar — LINEUP / SET TIMES / SHORT LIST / PIPELINE style,
// shared by the full Event page and any dashboard section showing the same
// per-event tabs. Active tab = white text + neon2 underline.
export default function EventTabBar({ tabs, active, onChange, style }) {
  return (
    <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.08)', ...style }}>
      {tabs.map(tab => (
        <button key={tab.key} onClick={() => onChange(tab.key)}
          style={{
            flex: 1, background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1.5,
            padding: '10px 4px 8px',
            color: active === tab.key ? '#fff' : 'var(--muted)',
            borderBottom: active === tab.key ? '2px solid var(--neon2)' : '2px solid transparent',
            transition: 'color .15s',
          }}
        >{tab.label}</button>
      ))}
    </div>
  );
}
