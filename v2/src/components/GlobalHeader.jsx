import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import s from './GlobalHeader.module.css';
import NotifPanel from './NotifPanel';
import ShareSheet from './ShareSheet';
import BetaWelcomePopup from './BetaWelcomePopup';
import { useCurrentShareTarget, pageFallback } from '../lib/shareTarget';

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
  '/beta-feedback': {
    title: 'BETA FEEDBACK',
    body: `<p>Bugs, ideas, love or questions — straight to Lucious.</p><ul><li>Every submission is <strong>personally reviewed</strong>.</li><li>Attach a <strong>screenshot or screen recording</strong> if it helps explain what happened.</li></ul>`
  },
};

const FALLBACK = {
  title: 'HOW IT WORKS',
  body: `<p>YesPleez connects artists, hosts, and fans on the local scene.</p><ul><li><strong>WHATS HAPPENIN'</strong> — browse all upcoming events.</li><li><strong>DISCOVER</strong> — find artists and events by genre or vibe.</li><li><strong>MY SCENE</strong> — your personalised feed of who and what you follow.</li><li>Sign up as an <strong>Artist</strong> to apply for gigs, or as a <strong>Host</strong> to run events and build your lineup.</li></ul>`
};

/**
 * The build stamp: version · commit · build time.
 *
 * ⚠ EACH GLOBAL IS GUARDED, the same way analytics.js guards __APP_VERSION__.
 * Vite's `define` does not apply under node tests, so an unguarded reference
 * throws the moment anything imports this module in a test.
 *
 * THE COMMIT IS THE LOAD-BEARING PART. A version only moves when someone
 * remembers to bump it, so two different builds routinely share one. The SHA
 * changes every deploy, which is what makes "am I looking at a stale build?"
 * answerable — a question that has cost real debugging time twice, most
 * expensively when a phone served a bundle from before a fix while every
 * diagnostic read healthy.
 */
const BUILD_STAMP = [
  'v' + (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'),
  typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev',
  typeof __BUILD_TIME__ !== 'undefined'
    ? new Date(__BUILD_TIME__).toLocaleString()
    : 'unbuilt',
].join(' · ');

export default function GlobalHeader({ onMarkRead, unreadCount = 0 }) {
  const navigate    = useNavigate();
  const location    = useLocation();
  const [infoOpen,  setInfoOpen]  = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const shareTarget = useCurrentShareTarget();
  const headerRef = useRef(null);

  // The top bar is permanent chrome, exactly like the bottom nav, so overlays
  // must stop below it rather than running underneath. Published as
  // --yp-header-height and measured with getBoundingClientRect so it includes
  // borders and any safe-area padding — reserved layout space, not a constant
  // that goes stale the first time the header changes.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        '--yp-header-height', el.getBoundingClientRect().height + 'px',
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const info = INFO[location.pathname] || FALLBACK;

  function handleBack() {
    if (window.history.length > 1) navigate(-1);
  }

  // SHARE IS RESOURCE-DRIVEN and this button stays generic. It renders
  // whatever the mounted screen declared via useShareTarget — never a
  // screen-specific branch, and never window.location.href, which is only
  // where you happened to arrive rather than the resource's canonical address.
  //
  // A screen that declares nothing falls back to the page, so nothing breaks;
  // but a screen representing a shareable resource should always declare.
  function handleShare() {
    setShareOpen(true);
  }

  return (
    <>
      {/* `yp-global-header` is a STABLE hook for rules that live outside this
          module — the CSS-module class is content-hashed (_header_11rgr_1)
          and changes whenever this file does, so it cannot be targeted from
          index.css. See the photo-viewer rule there. */}
      <div className={`${s.header} yp-global-header`} ref={headerRef}>
        <button className={s.backBtn} onClick={handleBack} aria-label="Back">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>

        <div className={s.ypTag}>YESPLEEZ</div>

        <button
          type="button"
          className={s.betaTag}
          onClick={() => navigate('/beta-feedback')}
          aria-label="Give beta feedback"
        >
          BETA
        </button>

        {/* Standard top bar order: Back · logo · Share · Info · bell. */}
        <div className={s.actions} style={{ position: 'relative' }}>
          <button className={s.iconBtn} onClick={handleShare} aria-label="Share">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>

          <button className={s.iconBtn} onClick={() => setInfoOpen(true)} aria-label="Info">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="8.01"/>
              <polyline points="11 12 12 12 12 16"/>
            </svg>
          </button>

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
        </div>
      </div>

      {shareOpen && (
        <ShareSheet
          target={shareTarget ?? pageFallback()}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* Info sheet */}
      <div className={infoOpen ? s.infoOverlayOpen : s.infoOverlay}>
        <div className={s.infoSheet}>
          <div
            className={s.infoBody}
            dangerouslySetInnerHTML={{ __html: `<h4>${info.title}</h4>${info.body}` }}
          />

          {/* WHICH BUILD AM I LOOKING AT.
              Here rather than anywhere prettier because this is where someone
              already goes to ask "what is this?", and because a stale bundle
              has now cost real debugging time twice — a phone kept serving a
              build from before a fix while every diagnostic read healthy.
              The commit is the part that actually settles it: the version only
              moves when someone remembers, the SHA moves every deploy. */}
          <div className={s.buildStamp}>{BUILD_STAMP}</div>

          <button className={s.infoClose} onClick={() => setInfoOpen(false)}>CLOSE</button>
        </div>
      </div>

      <BetaWelcomePopup />
    </>
  );
}
