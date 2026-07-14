import { useNavigate } from 'react-router-dom';

const GRADIENTS = {
  venue:  'linear-gradient(135deg, #00E5A0, #00B4D8)',
  host:   'linear-gradient(135deg, #FF2D78, #BF5FFF)',
  artist: 'linear-gradient(135deg, #00E5FF, #BF5FFF)',
  dj:     'linear-gradient(135deg, #00E5FF, #BF5FFF)',
};

export default function DashboardHeader({ line1, line2, userId, profileId, profileType = 'venue', gradient: gradientOverride }) {
  const navigate = useNavigate();
  const gradient = gradientOverride || GRADIENTS[profileType] || GRADIENTS.venue;
  // M5: canonical profile.id self-link; legacy user_id URL only as a fallback
  // while the caller's profile row is loading (the redirect shim covers it).
  const viewProfile = () => navigate(profileId ? `/profile/${profileId}?type=${profileType}` : `/profile/${userId}?type=${profileType}`);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 'clamp(28px, 7vw, 42px)', lineHeight: .92, marginTop: 8, letterSpacing: 2 }}>
        <span style={{ display: 'inline-block', background: gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{line1}</span>
        <br />
        <span style={{ display: 'inline-block', background: gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{line2}</span>
      </div>
      {(profileId || userId) && (
        <button
          title="Preview your public profile"
          onClick={viewProfile}
          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/>
          </svg>
        </button>
      )}
    </div>
  );
}
