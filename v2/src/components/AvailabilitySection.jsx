import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatDisplayDate } from '../lib/dates';
import AvailabilityCalendar from './AvailabilityCalendar';

const TODAY = () => new Date().toISOString().split('T')[0];

export default function AvailabilitySection({
  userId,
  table      = 'artist_availability',
  accent     = '#00E5FF',
  accentRgb  = '0,229,255',
  sectionId,
}) {
  const [localAvail,   setLocalAvail]   = useState(null);
  const [showCal,      setShowCal]      = useState(false);
  const [viewAllHov,   setViewAllHov]   = useState(false);

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
        <button
          onClick={() => setShowCal(true)}
          onMouseEnter={() => setViewAllHov(true)}
          onMouseLeave={() => setViewAllHov(false)}
          style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1, color: viewAllHov ? 'var(--text)' : 'var(--muted)', opacity: viewAllHov ? 1 : 0.5, background: 'none', border: 'none', cursor: 'pointer', padding: 0, transition: 'color .15s, opacity .15s' }}>
          VIEW ALL &gt;
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

      {/* Calendar modal — shared AvailabilityCalendar (11C.2), edit mode:
          any future date is tappable to toggle it on/off. */}
      {showCal && (
        <AvailabilityCalendar
          onClose={() => setShowCal(false)}
          title="MY AVAILABILITY"
          subtitle="Tap dates to mark yourself available. These show on your profile so promoters can find you."
          accent={accent}
          accentRgb={accentRgb}
          availableDates={localAvail ?? []}
          mode="edit"
          onSelectDate={toggleDate}
          footer={(() => {
            const fc = (localAvail ?? []).filter(d => d >= TODAY()).length;
            return (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 16 }}>
                {fc ? `${fc} date${fc !== 1 ? 's' : ''} marked available` : 'No dates marked yet'}
              </div>
            );
          })()}
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
        fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1,
        color: hov ? accent : 'var(--muted)',
        background: hov ? `rgba(${accentRgb},.08)` : 'var(--card2)',
        border: `1px solid ${hov ? `rgba(${accentRgb},.4)` : 'var(--border)'}`,
        borderRadius: 8, padding: '5px 12px', cursor: 'pointer',
        transition: 'color .15s, border-color .15s, background .15s',
      }}
    >{label}</span>
  );
}
