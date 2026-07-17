import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import s from './GlobalHeader.module.css';
import NotifPanel from './NotifPanel';

const INFO = {
  '/': {
    title: "WHATS HAPPENIN'",
    body: `<p>Browse all upcoming events in your city.</p><ul><li><strong>Tap any event card</strong> to see the full lineup, set times, and details.</li><li><strong>Scroll left/right</strong> on the calendar strip to jump to a date.</li><li><strong>Share</strong> an event with the share icon in the top right.</li></ul>`
  },
  '/discover': {
    title: 'DISCOVER',
    body: `<p>Find artists and events on the scene.</p><ul><li><strong>Search</strong> by name, genre, or vibe using the search bar.</li><li><strong>Tap any artist card</strong> to see their full profile, demo mix, and upcoming gigs.</li><li><strong>Tap any event</strong> to see the lineup and apply for an open slot.</li><li><strong>Follow</strong> artists or events to see them in your MY SCENE feed.</li></ul>`
  },
  '/my-scene': {
    title: 'MY SCENE',
    body: `<p>Your personalised feed of events and artists you follow.</p><ul><li><strong>Tap any event card</strong> to see what's on and grab tickets or apply.</li><li>Switch to <strong>Artist</strong> or <strong>Host</strong> mode using the Industry tab if you have multiple profiles.</li></ul>`
  },
  '/industry/host': {
    title: 'HOST DASHBOARD',
    body: `<p>Manage all your events from one place.</p><ul><li><strong>Tap an event</strong> to open the manage screen — accept or decline artist applications, send slot offers, and view set times.</li><li><strong>CREATE EVENT</strong> to set up a new night with slots, times, and a public signup link.</li><li>Share your event's public link so artists can apply directly.</li></ul>`
  },
  '/industry/artist': {
    title: 'ARTIST DASHBOARD',
    body: `<p>Your hub for gigs and your public profile.</p><ul><li><strong>Complete your profile</strong> — genre, vibes, bio, and a demo mix link — to attract more bookings.</li><li><strong>Upcoming gigs</strong> appear automatically when a host confirms you for an event.</li><li><strong>APPLY</strong> to open events directly from the calendar or Discover page.</li><li>Tap <strong>EDIT PROFILE</strong> to update your info at any time.</li></ul>`
  },
  '/industry/band': {
    title: 'BAND / MUSO DASHBOARD',
    body: `<p>Your hub for gigs and your public profile.</p><ul><li><strong>Complete your profile</strong> — genre, vibes, members, and a link to your music or press kit — to attract more bookings.</li><li><strong>Upcoming gigs</strong> appear automatically when a host confirms your band for an event.</li><li><strong>BROWSE OPEN EVENTS</strong> to apply directly from the calendar or Discover page.</li><li>Tap <strong>EDIT PROFILE</strong> to update your info at any time.</li></ul>`
  },
  '/industry/standup': {
    title: 'STAND UP / POETRY DASHBOARD',
    body: `<p>Your hub for gigs and your public profile.</p><ul><li><strong>Complete your profile</strong> — your roles, style tags, set length, and a link to your best set or showreel — to attract more bookings.</li><li><strong>Upcoming gigs</strong> appear automatically when a host confirms you for an event.</li><li><strong>BROWSE OPEN CALLS</strong> to apply directly from the calendar or Discover page.</li><li>Tap <strong>EDIT PROFILE</strong> to update your info at any time.</li></ul>`
  },
  '/industry/venue': {
    title: 'VENUE DASHBOARD',
    body: `<p>Your venue profile and hosted events.</p><ul><li><strong>Edit your venue profile</strong> to keep your details and contact info up to date.</li><li><strong>Upcoming events</strong> at your venue appear automatically.</li></ul>`
  },
};

const FALLBACK = {
  title: 'HOW IT WORKS',
  body: `<p>YesPleez connects artists, hosts, and fans on the local scene.</p><ul><li><strong>WHATS HAPPENIN'</strong> — browse all upcoming events.</li><li><strong>DISCOVER</strong> — find artists and events by genre or vibe.</li><li><strong>MY SCENE</strong> — your personalised feed of who and what you follow.</li><li>Sign up as an <strong>Artist</strong> to apply for gigs, or as a <strong>Host</strong> to run events and build your lineup.</li></ul>`
};

export default function GlobalHeader({ onMarkRead, unreadCount = 0 }) {
  const navigate    = useNavigate();
  const location    = useLocation();
  const [infoOpen,  setInfoOpen]  = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const info = INFO[location.pathname] || FALLBACK;

  function handleBack() {
    if (window.history.length > 1) navigate(-1);
  }

  return (
    <>
      <div className={s.header}>
        <button className={s.backBtn} onClick={handleBack} aria-label="Back">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>

        <div className={s.ypTag}>YESPLEEZ</div>

        <div className={s.actions} style={{ position: 'relative' }}>
          <button
            className={s.iconBtn}
            onClick={() => { setPanelOpen(v => !v); setInfoOpen(false); }}
            aria-label="Notifications"
            style={{ position: 'relative', color: panelOpen ? 'var(--neon2)' : undefined }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M12 2a7 7 0 0 0-7 7v4l-2 2v1h18v-1l-2-2V9a7 7 0 0 0-7-7zm0 20a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2z"/>
            </svg>
            {unreadCount > 0 && (
              <span style={{ position: 'absolute', top: 2, right: 4, minWidth: 16, height: 16, borderRadius: 8, background: '#FF3B30', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: '0 3px', boxSizing: 'border-box', fontFamily: 'DM Sans, sans-serif' }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {panelOpen && (
            <NotifPanel
              onClose={() => setPanelOpen(false)}
              onMarkAll={() => { if (onMarkRead) onMarkRead(); }}
            />
          )}
          <button className={s.iconBtn} onClick={() => setInfoOpen(true)} aria-label="Info">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="8.01"/>
              <polyline points="11 12 12 12 12 16"/>
            </svg>
          </button>
          <button className={s.iconBtn} aria-label="Share">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Info sheet */}
      <div className={infoOpen ? s.infoOverlayOpen : s.infoOverlay}>
        <div className={s.infoSheet}>
          <div
            className={s.infoBody}
            dangerouslySetInnerHTML={{ __html: `<h4>${info.title}</h4>${info.body}` }}
          />
          <button className={s.infoClose} onClick={() => setInfoOpen(false)}>CLOSE</button>
        </div>
      </div>
    </>
  );
}
