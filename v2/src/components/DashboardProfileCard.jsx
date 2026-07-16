import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PROFILE_TYPES } from '../lib/profileTypes';
import { formatLocation } from '../lib/formatLocation';

const PinIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
  </svg>
);

export default function DashboardProfileCard({
  profile,
  accent = '#00E5A0',
  gradient,
  icon,
  setupRoute,
  subtitle,
  genres,
  completionPct,
}) {
  const navigate  = useNavigate();
  const [hov, setHov] = useState(false);

  const pt         = PROFILE_TYPES[profile?.type] || PROFILE_TYPES.venue;
  const accentRgb  = pt.rgb;
  const typeLabel  = pt.shortLabel;

  const hasProfile = !!profile?.name;
  const heroImg    = profile?.avatar_hero || profile?.avatar || (hasProfile ? pt.defaultImage : null);
  // Postcode dropped here — this compact "pin + town, state" badge doesn't
  // need it (formatLocation still returns the full "Suburb, STATE POSTCODE"
  // for every other call site).
  const location   = formatLocation({ ...(profile || {}), postcode: undefined });
  const estYear    = profile?.established_year;
  const tagline    = profile?.tagline;
  // Resize-reactive (matches VenueDashboard's established isNarrow pattern),
  // rather than a one-shot read that never updates after mount.
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handler, { passive: true });
    return () => window.removeEventListener('resize', handler);
  }, []);
  const themeGradient = gradient || `linear-gradient(90deg, ${accent}, #00B4D8)`;

  // Dark bg colour matching the page — used for the image-to-content fade
  const pageBg = '#0a0a14';

  return (
    <>
      {/* ── Hero card ── */}
      <div
        onClick={() => navigate(setupRoute)}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          position: 'relative',
          display: 'flex',
          borderRadius: 16,
          overflow: 'hidden',
          border: `1px solid ${hov ? `rgba(${accentRgb},.35)` : 'rgba(255,255,255,.08)'}`,
          background: hov ? `rgba(${accentRgb},.06)` : 'rgba(255,255,255,.02)',
          marginBottom: 14,
          cursor: 'pointer',
          transition: 'border-color .2s',
          minHeight: 130,
        }}
      >
        {/* ── Left: hero image ── */}
        <div style={{
          width: isMobile ? 90 : 150,
          flexShrink: 0,
          position: 'relative',
          overflow: 'hidden',
          background: `rgba(${accentRgb},.08)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {heroImg
            ? <img src={heroImg} alt={profile.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ opacity: .4 }}>{icon}</div>
          }
          {/* Fade right edge into card */}
          <div style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(to right, transparent 45%, ${pageBg} 100%)`,
            pointerEvents: 'none',
          }} />
        </div>

        {/* ── Right: content ── */}
        <div style={{ flex: 1, padding: '16px 18px 16px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 7, minWidth: 0 }}>

          {/* Name row */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, overflow: 'hidden' }}>
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 26, letterSpacing: 1.5, lineHeight: 1,
              color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1, minWidth: 0,
            }}>
              {profile?.name || 'Set up your profile'}
            </div>
            {estYear && (
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                Est. {estYear}
              </span>
            )}
          </div>

          {/* Metadata row + edit button */}
          {(typeLabel || location || hasProfile) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {typeLabel && (
                <span style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 9, letterSpacing: 1.5,
                  color: accent,
                  background: `rgba(${accentRgb},.12)`,
                  border: `1px solid rgba(${accentRgb},.28)`,
                  borderRadius: 4, padding: '2px 6px',
                }}>{typeLabel}</span>
              )}
              {location && (
                <span style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <PinIcon />{location}
                </span>
              )}
              <span style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 10, letterSpacing: 1.5,
                color: accent, flexShrink: 0,
                background: `rgba(${accentRgb},.1)`,
                border: `1px solid rgba(${accentRgb},.3)`,
                borderRadius: 6, padding: '3px 8px',
                marginLeft: 'auto',
              }}>
                {hasProfile ? 'EDIT PROFILE →' : 'SET UP →'}
              </span>
            </div>
          )}

          {/* Tagline */}
          {tagline ? (
            <div style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 11, letterSpacing: 1.5, lineHeight: 1.35,
              background: themeGradient,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text', display: 'inline-block',
            }}>{tagline}</div>
          ) : subtitle ? (
            <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>{subtitle}</div>
          ) : null}

          {/* Sound / genres fallback */}
          {genres && (
            <div style={{ fontSize: 11, color: `rgba(${accentRgb},.65)` }}>{genres}</div>
          )}
        </div>
      </div>

      {/* ── Completion bar — thin and elegant ── */}
      {profile && completionPct !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ flex: 1, height: 2, borderRadius: 2, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${completionPct}%`,
              borderRadius: 2,
              background: themeGradient,
              transition: 'width .6s',
            }} />
          </div>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 9, letterSpacing: 1.5,
            color: 'var(--muted)', flexShrink: 0,
          }}>
            PROFILE {Math.round(completionPct)}%
          </span>
        </div>
      )}
    </>
  );
}
