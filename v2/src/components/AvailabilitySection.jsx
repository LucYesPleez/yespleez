import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatDisplayDate } from '../lib/dates';

const TODAY = () => new Date().toISOString().split('T')[0];
const DAY_LABELS = ['S','M','T','W','T','F','S'];

export default function AvailabilitySection({
  userId,
  table      = 'artist_availability',
  accent     = '#00E5FF',
  accentRgb  = '0,229,255',
  sectionId,
}) {
  const [localAvail,   setLocalAvail]   = useState(null);
  const [showCal,      setShowCal]      = useState(false);

  useEffect(() => {
    if (!userId) return;
    supabase.from(table).select('available_date')
      .eq('user_id', userId).gte('available_date', TODAY()).order('available_date').limit(60)
      .then(({ data }) => setLocalAvail((data || []).map(r => r.available_date)));
  }, [userId, table]);

  async function toggleDate(dateStr) {
    if (!userId) return;
    const avail    = localAvail ?? [];
    const wasAvail = avail.includes(dateStr);
    setLocalAvail(wasAvail ? avail.filter(d => d !== dateStr) : [...avail, dateStr].sort());
    if (wasAvail) {
      await supabase.from(table).delete().eq('user_id', userId).eq('available_date', dateStr);
    } else {
      await supabase.from(table).upsert({ user_id: userId, available_date: dateStr }, { onConflict: 'user_id,available_date' });
    }
  }

  const availability = localAvail ?? [];

  return (
    <div id={sectionId} style={{ marginTop: 40 }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 2.5, color: '#fff', margin: 0 }}>AVAILABLE DATES</p>
          <span style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 0.3 }}>tap dates to add / remove</span>
        </div>
        <div style={{ flex: 1 }} />
        {availability.length > 0 && (
          <button onClick={() => setShowCal(true)}
            style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1, color: `rgba(${accentRgb},.7)`, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            View all &gt;
          </button>
        )}
        <button onClick={() => setShowCal(true)}
          style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1, color: `rgba(${accentRgb},.7)`, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          MANAGE
        </button>
      </div>

      {/* Chips */}
      {availability.length === 0
        ? null
        : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {availability.slice(0, typeof window !== 'undefined' && window.innerWidth < 640 ? 8 : 12).map(d => (
              <DateChip key={d} label={formatDisplayDate(d)} accent={accent} accentRgb={accentRgb} onClick={() => setShowCal(true)} />
            ))}
          </div>
        )
      }

      {/* Calendar modal */}
      {showCal && (
        <AvailCalModal
          availability={localAvail ?? []}
          accent={accent}
          accentRgb={accentRgb}
          onToggle={toggleDate}
          onClose={() => setShowCal(false)}
        />
      )}
    </div>
  );
}

function DateChip({ label, accent, accentRgb, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <span
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        fontFamily: "'DM Sans'", fontSize: 12,
        color: hov ? '#fff' : accent,
        background: hov ? 'rgba(255,255,255,.06)' : `rgba(${accentRgb},.1)`,
        border: `1px solid ${hov ? 'rgba(255,255,255,.3)' : `rgba(${accentRgb},.3)`}`,
        borderRadius: 20, padding: '3px 10px', cursor: 'pointer',
        transition: 'all .15s',
      }}
    >{label}</span>
  );
}

function AvailCalModal({ availability, accent, accentRgb, onToggle, onClose }) {
  const todayStr    = TODAY();
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  const year        = month.getFullYear();
  const monthIdx    = month.getMonth();
  const label       = month.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }).toUpperCase();
  const firstDay    = new Date(year, monthIdx, 1).getDay();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const availSet    = new Set(availability);
  const futureCount = availability.filter(d => d >= todayStr).length;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0f0f1a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: '24px 20px 100px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: 2, color: accent }}>MY AVAILABILITY</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Tap dates to mark yourself available. These show on your profile so promoters can find you.</p>
        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button onClick={() => setMonth(new Date(year, monthIdx - 1, 1))} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>‹</button>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: 'var(--text)' }}>{label}</span>
          <button onClick={() => setMonth(new Date(year, monthIdx + 1, 1))} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>›</button>
        </div>
        {/* Day labels */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 4 }}>
          {DAY_LABELS.map((d, i) => <div key={i} style={{ textAlign: 'center', fontSize: 10, color: 'var(--muted)', fontFamily: "'Bebas Neue'", paddingBottom: 2 }}>{d}</div>)}
        </div>
        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 16 }}>
          {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day     = i + 1;
            const dateStr = `${year}-${String(monthIdx + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const isPast  = dateStr < todayStr;
            const isAvail = availSet.has(dateStr);
            const isToday = dateStr === todayStr;
            return (
              <div key={dateStr} onClick={() => !isPast && onToggle(dateStr)} style={{
                textAlign: 'center', padding: '7px 2px', borderRadius: 6, fontSize: 13,
                cursor: isPast ? 'default' : 'pointer',
                background: isAvail ? `rgba(${accentRgb},.18)` : 'rgba(255,255,255,.04)',
                color: isPast ? 'rgba(255,255,255,.2)' : isAvail ? accent : 'var(--text)',
                border: isAvail ? `1px solid rgba(${accentRgb},.5)` : isToday ? '1px solid rgba(255,255,255,.3)' : '1px solid transparent',
                transition: 'background .15s',
              }}>{day}</div>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {futureCount ? `${futureCount} date${futureCount !== 1 ? 's' : ''} marked available` : 'No dates marked yet'}
        </div>
      </div>
    </div>
  );
}
