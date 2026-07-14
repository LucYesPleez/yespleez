import { useState } from 'react';

function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight * 0.35, behavior: 'smooth' });
}

function StatBox({ label, value, accent = '#00E5A0', accentRgb = '0,229,160', sectionId, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick || (sectionId ? () => scrollToSection(sectionId) : undefined)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: 1, textAlign: 'center', padding: '12px 8px', borderRadius: 10,
        cursor: sectionId ? 'pointer' : 'default',
        background: hov ? `rgba(${accentRgb},.06)` : 'rgba(255,255,255,.03)',
        border: hov ? `1px solid rgba(${accentRgb},.25)` : '1px solid var(--border)',
        transition: 'background .2s, border-color .2s',
      }}
    >
      <p style={{ fontFamily: "'Bebas Neue'", fontSize: 26, color: accent, letterSpacing: 1 }}>{value}</p>
      <p style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, fontFamily: "'Bebas Neue'" }}>{label}</p>
    </div>
  );
}

export default function DashboardStats({ stats = [], accent, accentRgb }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
      {stats.map(s => (
        <StatBox key={s.label} label={s.label} value={s.value} sectionId={s.sectionId}
          accent={s.accent || accent} accentRgb={s.accentRgb || accentRgb} onClick={s.onClick} />
      ))}
    </div>
  );
}
