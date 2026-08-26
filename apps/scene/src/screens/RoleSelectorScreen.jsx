import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { PROFILE_TYPES, hexToRgb } from '../lib/profileTypes';
import { CATEGORY_BADGES } from '../lib/eventBadges';
import { visibleRoles } from '../lib/roleVisibility';
import { openExternalRole } from '../lib/roleHandoff';
// ⭐ ONE definition of where the Portal is, shared with the apply hand-off on
// festival-owned events. It was briefly declared here as well; two copies of a
// URL is how the card and the hand-off end up pointing at different places.
import { FESTIVAL_PORTAL_URL } from '../lib/festivalPortal';
import s from './RoleSelectorScreen.module.css';

// The one festival colour this app already has (CATEGORY_BADGES.FESTIVAL, used
// on every festival event card). Reused rather than picked afresh, so the role
// card and the event badge cannot drift into two different purples.
//
// ⚠ NOT DERIVED FROM PROFILE_TYPES, because `festival` deliberately is not one
// — see the card's own note below. `hexToRgb` keeps the glow's rgb from being
// hand-typed alongside the hex, which is precisely how accent/accent2 drifted
// across a dozen files before 10E.
const FESTIVAL_ACCENT = CATEGORY_BADGES.FESTIVAL.bg;

// Order is the shared canonical role ordering for V2 (Venue first — reflects
// the platform's primary discovery flow). IndustryPanel.jsx imports this
// array directly, so reordering here also reorders the Industry panel.
//
// title/hoverStyle/titleStyle all derive from PROFILE_TYPES — this screen
// previously kept its own hand-typed colours here, several of which had
// drifted from canonical (Host's hover border was Artist's pink #FF3399,
// Band's was its accent2 not its accent, Comedy/Poetry's hover glow didn't
// match its own border colour at all). desc/icon/path are role-picker
// content, not identity, and stay local.
const ROLES = [
  {
    id: 'venue',
    path: '/industry/venue',
    hoverStyle: { borderColor: PROFILE_TYPES.venue.accent, boxShadow: `0 0 28px rgba(${PROFILE_TYPES.venue.rgb},.28)` },
    titleStyle: { color: PROFILE_TYPES.venue.accent },
    title: PROFILE_TYPES.venue.label,
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
    hoverStyle: { borderColor: PROFILE_TYPES.host.accent, boxShadow: `0 0 28px rgba(${PROFILE_TYPES.host.rgb},.18)` },
    titleStyle: { color: PROFILE_TYPES.host.accent },
    title: PROFILE_TYPES.host.label,
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
    hoverStyle: { borderColor: PROFILE_TYPES.artist.accent, boxShadow: `0 0 28px rgba(${PROFILE_TYPES.artist.rgb},.18)` },
    titleStyle: { color: PROFILE_TYPES.artist.accent },
    // Deliberate divergence from PROFILE_TYPES.artist.label ('DJ / PROD.').
    // The abbreviation exists for badges and pills where space is tight; the
    // role picker has room and is where someone decides what they are, so it
    // spells the role out. Picker-only — IndustryPanel reads this same array,
    // every other surface still shows the canonical label.
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
    hoverStyle: { borderColor: PROFILE_TYPES.band.accent, boxShadow: `0 0 28px rgba(${PROFILE_TYPES.band.rgb},.28)` },
    titleStyle: { color: PROFILE_TYPES.band.accent },
    title: PROFILE_TYPES.band.label,
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
    hoverStyle: { borderColor: PROFILE_TYPES.standup.accent, boxShadow: `0 0 28px rgba(${PROFILE_TYPES.standup.rgb},.28)` },
    titleStyle: { background: PROFILE_TYPES.standup.gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' },
    title: PROFILE_TYPES.standup.label,
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
  /**
   * ⛔ OWNER-ONLY, AND DELIBERATELY NOT A SCENE PROFILE TYPE. Three things here
   * look like oversights and are not:
   *
   * 1. `festival` is absent from PROFILE_TYPES on purpose. That map feeds
   *    SCENE_ROLE_ORDER, which drives FollowingSection's filter tokens and
   *    MySceneScreen's colours and labels — adding it would put a FESTIVAL
   *    filter in front of every user, and there is no `defaultfestival.webp`,
   *    so any profile falling back to it would render as a bare pink gradient.
   *    Making festival a real Scene type is its own migration (asset, DB
   *    constraint, LOCALS_TYPES decision) and is tracked separately.
   *
   * 2. It leaves the app. Owner's ruling, 2026-08-05: a Festival is a
   *    first-class identity and the Portal is the administrative WORKSPACE for
   *    it — "A Festival opens the Festival workspace." The Portal is a separate
   *    front-end over the SAME Supabase project, so this card is a link, not a
   *    route, and `path` is an absolute URL rather than an /industry path.
   *
   * 3. `restrictedToEmail` hides it from everyone else — see lib/roleVisibility
   *    for why that is a visibility gate and NOT a security boundary.
   */
  {
    id: 'festival',
    restrictedToEmail: 'lucious.aus@gmail.com',
    external: true,
    path: FESTIVAL_PORTAL_URL,
    hoverStyle: { borderColor: FESTIVAL_ACCENT, boxShadow: `0 0 28px rgba(${hexToRgb(FESTIVAL_ACCENT)},.28)` },
    titleStyle: { color: FESTIVAL_ACCENT },
    title: 'FESTIVAL',
    desc: 'Open the Festival Portal — editions, categories, applications and volunteers',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {/* A marquee: pennant, ridge, and the scalloped hem of a festival tent. */}
        <line x1="12" y1="1.5" x2="12" y2="4"/>
        <path d="M12 1.8 L15.5 2.9 L12 4 Z" fill="currentColor" stroke="none"/>
        <path d="M12 4 L21.5 11 L2.5 11 Z"/>
        <path d="M4 11 v9.5"/>
        <path d="M20 11 v9.5"/>
        <path d="M4 20.5 q2 -1.6 4 0 q2 1.6 4 0 q2 -1.6 4 0 q2 1.6 4 0"/>
        <path d="M12 4 L9 11"/>
        <path d="M12 4 L15 11"/>
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

// ⚠ `onSignOut` is gone from the signature — the button that used it was
// removed above. IndustryPanel keeps its own copy because its GUEST branch
// still uses it for SIGN IN, which is a different action wearing the same
// handler.
export default function RoleSelectorScreen({ session }) {
  const navigate = useNavigate();
  const [setupTypes, setSetupTypes] = useState(new Set());
  // type -> name, for the tick. Same change as IndustryPanel: the two screens
  // show the same rows and must not disagree about what a set-up role says.
  // `setupTypes` is KEPT alongside it — handlePick below gates on it, and
  // folding the two into one structure would make a membership test read as a
  // name lookup.
  const [setupNames, setSetupNames] = useState({});

  useEffect(() => {
    if (!session) return;
    supabase
      .from('profiles')
      .select('type, name')
      .eq('user_id', session.user.id)
      .then(({ data }) => {
        if (!data) return;
        setSetupTypes(new Set(data.map(p => p.type)));
        const byType = {};
        for (const p of data) if (!(p.type in byType)) byType[p.type] = (p.name || '').trim();
        setSetupNames(byType);
      });
  }, [session]);

  function handlePick(role) {
    // An external role is a different APP, not a mode of this one. It gets no
    // entry in `yp_active_roles` — that list drives which industry dashboards
    // this app offers, and the Portal is not one of them. The hand-off itself
    // (new tab, noopener) lives in lib/roleHandoff, shared with IndustryPanel:
    // the check was once written here alone, and the panel's FESTIVAL row fed
    // the Portal URL to the router — which rendered nothing.
    if (openExternalRole(role)) return;

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
        {visibleRoles(ROLES, session).map(role => (
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
                <div className={s.profileTick} style={{ color: role.hoverStyle.borderColor }}>
                  ✓ {setupNames[role.id] || 'Profile set up'}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* ⛔ NO SIGN OUT HERE (owner, 2026-08-04). Signing out lives in ONE
          place now — the identity menu in the global header. Three separate
          sign-out buttons meant three things to keep consistent and three
          places to look when it misbehaved.
          ⚠ This screen is the ONE route where GlobalHeader does not render
          (see App.jsx), so there is genuinely no sign-out reachable from here.
          Accepted: /role-select is a pick-a-role step you arrive at and leave,
          not somewhere you sit. */}
    </div>
  );
}
