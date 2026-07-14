import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import s from './RoleSelectorScreen.module.css';

// Order is the shared canonical role ordering for V2 (Venue first — reflects
// the platform's primary discovery flow). IndustryPanel.jsx imports this
// array directly, so reordering here also reorders the Industry panel.
const ROLES = [
  {
    id: 'venue',
    path: '/industry/venue',
    hoverStyle: { borderColor: '#00E5A0', boxShadow: '0 0 28px rgba(0,229,160,.28)' },
    titleStyle: { color: '#00E5A0' },
    title: 'VENUES',
    desc: 'List your venue, set availability, get found by promoters and artists',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
  },
  {
    id: 'host',
    path: '/industry/host',
    hoverStyle: { borderColor: '#FF3399', boxShadow: '0 0 28px rgba(255,51,153,.18)' },
    titleStyle: { color: '#FF3399' },
    title: 'HOST / PROMOTER',
    desc: 'Create events, build set times, manage your lineup, go live',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="2" width="18" height="20" rx="2"/>
        <circle cx="12" cy="13" r="5"/>
        <circle cx="12" cy="13" r="2"/>
        <line x1="9" y1="5.5" x2="15" y2="5.5" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'artist',
    path: '/industry/artist',
    hoverStyle: { borderColor: '#00e5ff', boxShadow: '0 0 28px rgba(0,229,255,.18)' },
    titleStyle: { color: '#00e5ff' },
    title: 'DJ / PRODUCER',
    desc: 'Build your profile, track your bookings, apply to events',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/>
        <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
      </svg>
    ),
  },
  {
    id: 'band',
    path: '/industry/band',
    hoverStyle: { borderColor: '#FF8C42', boxShadow: '0 0 28px rgba(255,140,66,.28)' },
    titleStyle: { color: '#FF8C42' },
    title: 'BAND / MUSO',
    desc: 'List your band, find gigs, connect with venues and promoters',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 14.5 2.5 A 9.5 9.5 0 0 1 21.5 9.5"/>
        <path d="M 21.5 14.5 A 9.5 9.5 0 0 1 14.5 21.5"/>
        <path d="M 9.5 21.5 A 9.5 9.5 0 0 1 2.5 14.5"/>
        <path d="M 2.5 9.5 A 9.5 9.5 0 0 1 9.5 2.5"/>
        <rect x="10.5" y="1" width="3" height="2" rx="0.5" fill="currentColor" stroke="none"/>
        <rect x="21" y="10.5" width="2" height="3" rx="0.5" fill="currentColor" stroke="none"/>
        <rect x="10.5" y="21" width="3" height="2" rx="0.5" fill="currentColor" stroke="none"/>
        <rect x="1" y="10.5" width="2" height="3" rx="0.5" fill="currentColor" stroke="none"/>
        <circle cx="12" cy="12" r="7"/>
        <line x1="3" y1="2" x2="17" y2="16" strokeWidth="2"/>
        <circle cx="2.5" cy="1.5" r="1.3" fill="currentColor" stroke="none"/>
        <line x1="21" y1="2" x2="7" y2="16" strokeWidth="2"/>
        <circle cx="21.5" cy="1.5" r="1.3" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
  {
    id: 'standup',
    path: '/industry/standup',
    hoverStyle: { borderColor: '#FF88AA', boxShadow: '0 0 28px rgba(232,121,249,.28)' },
    titleStyle: { background: 'linear-gradient(135deg,#FF88AA,#FF5588)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' },
    title: 'COMEDY / POETRY',
    desc: 'Book gigs, share your sets, connect with comedy clubs and spoken word nights',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="8" rx="5" ry="6.5"/>
        <line x1="8.2" y1="4" x2="15.8" y2="4"/>
        <line x1="7.2" y1="6.5" x2="16.8" y2="6.5"/>
        <line x1="7.1" y1="9" x2="16.9" y2="9"/>
        <line x1="8.2" y1="11.5" x2="15.8" y2="11.5"/>
        <path d="M7 8 L4.5 8 L4.5 16 L12 16"/>
        <path d="M17 8 L19.5 8 L19.5 16 L12 16"/>
        <line x1="12" y1="16" x2="12" y2="20"/>
        <rect x="7.5" y="20" width="9" height="2" rx="1"/>
      </svg>
    ),
  },
];

function getActiveRoles() {
  try { return JSON.parse(localStorage.getItem('yp_active_roles') || '[]'); } catch { return []; }
}

function activateRole(id) {
  const current = getActiveRoles();
  if (!current.includes(id)) {
    localStorage.setItem('yp_active_roles', JSON.stringify([...current, id]));
  }
}

export { ROLES, getActiveRoles, activateRole };

export default function RoleSelectorScreen({ session, onSignOut }) {
  const navigate = useNavigate();
  const [setupTypes, setSetupTypes] = useState(new Set());

  useEffect(() => {
    if (!session) return;
    supabase
      .from('profiles')
      .select('type')
      .eq('user_id', session.user.id)
      .then(({ data }) => {
        if (data) setSetupTypes(new Set(data.map(p => p.type)));
      });
  }, [session]);

  function handlePick(role) {
    activateRole(role.id);
    // Send to dedicated setup screen if profile not yet created
    if (role.id === 'host' && !setupTypes.has('host')) {
      navigate('/industry/host/setup');
      return;
    }
    if (role.id === 'artist' && !setupTypes.has('artist')) {
      navigate('/industry/artist/setup');
      return;
    }
    navigate(role.path);
  }

  return (
    <div className={s.screen}>
      <div className={s.spacer} />
      <div className={s.logoTag}>YESPLEEZ</div>
      <h1 className={s.title}>THE SCENE<br />IN YOUR HANDS</h1>
      <p className={s.sub}>Switch between modes anytime</p>

      <div className={s.cards}>
        {ROLES.map(role => (
          <button
            key={role.id}
            className={s.card}
            onClick={() => handlePick(role)}
            onMouseEnter={e => Object.assign(e.currentTarget.style, role.hoverStyle)}
            onMouseLeave={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.boxShadow = ''; }}
          >
            <span className={s.cardIcon}>{role.icon}</span>
            <div className={s.cardBody}>
              <div className={s.cardTitle} style={role.titleStyle}>{role.title}</div>
              <div className={s.cardDesc}>{role.desc}</div>
              {setupTypes.has(role.id) && (
                <div className={s.profileTick} style={{ color: role.hoverStyle.borderColor }}>✓ Profile set up</div>
              )}
            </div>
          </button>
        ))}
      </div>

      {session && (
        <button className={s.signOut} onClick={onSignOut}>SIGN OUT</button>
      )}
    </div>
  );
}
