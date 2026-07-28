import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import s from './GlobalHeader.module.css';
import NotifPanel from './NotifPanel';
import ShareSheet from './ShareSheet';
import BetaWelcomePopup from './BetaWelcomePopup';
import { useCurrentShareTarget, pageFallback } from '../lib/shareTarget';
import { readAuthLog, readAuthIncidents } from '../lib/authDiagnostics';
import { readForensics } from '../lib/authForensics';
import { readPushLog } from '../lib/pushLog';
import InstallButton from './InstallButton';
import TourOverlay from './TourOverlay';
import t from './TourOverlay.module.css';
import {
  tourFinished, finishTour, announceTourFinished, resetTour, tourOverride,
  startTour, onTourStart,
} from '../lib/tourState';

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

        {/* ⚠ `data-tour` IS A TOUR ANCHOR, NOT A STYLING HOOK — the guided
            tour spotlights this button. The CSS-module class beside it is
            content-hashed and cannot be targeted from outside this file, so
            the attribute is the only stable handle. Removing it silently
            disables the step: the engine skips a target it cannot find
            rather than throwing, so it would go dark with a clean console. */}
        <button
          type="button"
          data-tour="beta"
          className={s.betaTag}
          onClick={() => navigate('/beta-feedback')}
          aria-label="Give beta feedback"
        >
          BETA
        </button>

        {/* Sits beside BETA rather than in the right-hand icon cluster: that
            cluster is permanent chrome (share · info · bell), and this is a
            once-per-device action that removes itself the moment it is done. */}
        <InstallButton />

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

          {/* ⚠ THE SECOND ENTRY POINT TO THE TOUR, and the one the skip notice
              promises. It sits directly under the page's own explanation
              because that is the moment someone is already asking "what is
              this?" — and it is the only control in this sheet that DOES
              something rather than reporting something.
              Closing the sheet first is not cosmetic: the sheet is a fixed
              panel at z-index 400 and the tour dims the screen beneath it, so
              leaving it open would put an undimmed white-on-dark card over
              step 1's spotlight. */}
          <button
            className={s.infoTour}
            onClick={() => { setInfoOpen(false); startTour(); }}
          >
            TAKE THE TOUR
          </button>

          {/* WHICH BUILD AM I LOOKING AT.
              Here rather than anywhere prettier because this is where someone
              already goes to ask "what is this?", and because a stale bundle
              has now cost real debugging time twice — a phone kept serving a
              build from before a fix while every diagnostic read healthy.
              The commit is the part that actually settles it: the version only
              moves when someone remembers, the SHA moves every deploy. */}
          <div className={s.buildStamp}>{BUILD_STAMP}</div>

          {/* ⚠ THE WORKER IS A SEPARATE FILE WITH A SEPARATE LIFECYCLE, and
              the stamp above does not cover it. A phone can report a current
              bundle while running a service worker from weeks ago — which is
              exactly what happened twice while debugging a push that never
              arrived, on two different devices, both of which looked up to
              date. Asked of the worker itself, so this reports what is
              INSTALLED, not what the server would serve. */}
          {infoOpen && <ServiceWorkerStamp />}
          {infoOpen && <PushLogReadout />}

          {/* Rendered only while the sheet is open. The overlay stays mounted
              and is hidden by class, so an ungated readout would re-read
              localStorage and re-parse the log on every render of the header —
              on every route change, for a panel nobody is looking at. */}
          {infoOpen && <AuthLogReadout />}

          <button className={s.infoClose} onClick={() => setInfoOpen(false)}>CLOSE</button>
        </div>
      </div>

      <BetaWelcomePopup />

      {/* ⚠ MOUNTED HERE BECAUSE THE HEADER IS THE ONE COMPONENT ON EVERY
          ROUTE, and the tour has to be able to start wherever the user is.
          It portals to document.body, so being inside the header's
          transformed subtree costs it nothing — see the note in the file. */}
      <TourRunner />
    </>
  );
}

/**
 * WHEN THE TOUR RUNS — the two entry points, and the flag between them.
 *
 * ⚠ THE AUTO-RUN WAITS FOR A SETTLE. Firing on mount lights a screen whose
 * fonts have not loaded and whose feed has not rendered, so the first thing
 * the user sees is a lamp correcting itself. A second is enough for the home
 * screen to be worth looking at, and short enough that it still reads as
 * part of opening the app.
 */
function TourRunner() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(tourFinished);
  const [skipNotice, setSkipNotice] = useState(false);
  const [startAt, setStartAt] = useState(0);
  /**
   * ⚠ A REPLAY IS NOT A FIRST RUN, and three things hang off knowing which is
   * which. On a replay: the done flag is not written (it is already set, and
   * a replay must never un-spend it), the skip notice does not appear (they
   * just came FROM the ⓘ sheet it points at), and the install spotlight is not
   * re-announced (that handover already happened once).
   */
  const [replay, setReplay] = useState(false);
  const override = tourOverride();

  useEffect(() => {
    if (override === 'reset') { resetTour(); setDone(false); }
    if (override === 'off') setDone(true);
  }, [override]);

  useEffect(() => {
    if (done) return undefined;
    const t = setTimeout(() => setOpen(true), 1000);
    return () => clearTimeout(t);
  }, [done]);

  // The ⓘ sheet's "TAKE THE TOUR". Opens immediately — there is no settle
  // delay to wait out, because the app is already on screen and the user just
  // asked for this rather than having it arrive at them.
  useEffect(() => onTourStart((at = 0) => {
    setStartAt(at);
    setReplay(true);
    setOpen(true);
  }), []);

  /**
   * ⚠ COMPLETING AND SKIPPING ARE THE SAME OUTCOME. The brief: "once completed
   * or skipped, it is never shown again." A user who skipped has made a
   * decision, and re-offering it is the exact nagging the design is trying to
   * avoid. The Help entry point is how they get it back.
   */
  /**
   * ⚠ THE REASON MATTERS HERE AND NOWHERE ELSE. Completing and skipping spend
   * the tour identically — that part is deliberate — but only a skipper
   * leaves without having been told the tour still exists. Someone who
   * reached step 7 has just read it; showing them the same notice turns a
   * finished tour into one more thing to dismiss.
   */
  function close(reason) {
    setOpen(false);

    // A replay just ends. Nothing is spent, nothing is announced, and no
    // notice appears telling them where the tour lives — they opened it from
    // there thirty seconds ago.
    if (replay) { setReplay(false); return; }

    finishTour();
    setDone(true);
    if (reason === 'skipped') {
      // The handover waits — see announceTourFinished. Two overlays at once
      // is worse than either alone.
      setSkipNotice(true);
      return;
    }
    announceTourFinished();
  }

  return (
    <>
      <TourOverlay open={open} startAt={startAt} onClose={close} />
      {skipNotice && (
        <TourSkipNotice
          onClose={() => { setSkipNotice(false); announceTourFinished(); }}
        />
      )}
    </>
  );
}

/**
 * WHERE THE TOUR WENT — shown once, to someone who just skipped it.
 *
 * The whole job of this card is to stop "Skip Tour" reading as "destroy the
 * tour". It names the ⓘ as the permanent home for the walkthroughs and then
 * gets out of the way; there is deliberately no button offering to start the
 * tour again, because they declined it one tap ago.
 *
 * ⚠ PORTALLED TO document.body FOR THE USUAL REASON — `.header` carries a
 * transform, which makes it the containing block for any `position: fixed`
 * child, so `inset: 0` rendered inside it resolves against a 680×54 strip.
 */
function TourSkipNotice({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal((
    <div
      className={t.noticeWrap}
      role="dialog"
      aria-modal="true"
      aria-label="Where to find the tour"
      onClick={onClose}
    >
      <div className={t.notice} onClick={(e) => e.stopPropagation()}>
        <h2 className={t.noticeTitle}>No worries</h2>
        <p className={t.noticeBody}>
          The walkthroughs live under{' '}
          <svg className={t.noticeGlyph} width="15" height="15" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="8.01" />
            <polyline points="11 12 12 12 12 16" />
          </svg>{' '}
          up top — this one, plus a closer look at each kind of profile. Take
          them whenever you feel like it.
        </p>
        <button type="button" className={t.noticeClose} onClick={onClose} autoFocus>
          Got it
        </button>
      </div>
    </div>
  ), document.body);
}

/**
 * The auth diagnostic readout — WHY the last sign-out happened.
 *
 * Sits under the build stamp because it answers the same class of question
 * ("what state is this app actually in?") and gets read in the same moment:
 * the owner has just been bounced to a login screen on a phone with no
 * devtools attached, and this is the only surface that can tell them whether
 * the session was removed or the storage was wiped. Those two need opposite
 * fixes — see authDiagnostics.js for how the canary separates them.
 *
 * Plain and unstyled on purpose. It is a measurement being read once, not a
 * feature, and it should be easy to delete once the cause is known.
 */
const VERDICT_TEXT = {
  'healthy':              'signed in, storage intact',
  'session-removed':      '⚠ SUPABASE REMOVED THE SESSION (app-side — a refresh was rejected)',
  'storage-evicted':      '⚠ iOS EVICTED localStorage (platform-side — cookie survived)',
  'storage-partial-wipe': '⚠ localStorage partly cleared (no cookie to confirm)',
  'canary-cleared':       'canary missing but token present — cleared by hand?',
  'first-run':            'first run on this device',
  'unavailable':          'could not read storage',
};

function AuthLogReadout() {
  const log       = readAuthLog();
  const incidents = readAuthIncidents();
  const forensics = readForensics();
  if (!log.length && !incidents.length && !forensics.length) return null;

  // The most recent boot verdict is the headline; everything else is context
  // for it. Searching from the end because the log is append-ordered.
  const lastBoot = [...log].reverse().find(e => e.kind === 'boot');

  return (
    <div className={s.buildStamp} style={{ textAlign: 'left' }}>
      <div style={{ marginBottom: 6, color: 'var(--text)' }}>
        AUTH: {VERDICT_TEXT[lastBoot?.detail] || lastBoot?.detail || 'no boot recorded'}
      </div>

      {/* Incidents first and unconditionally, because this is the answer the
          sheet is being opened for. They outlive the rolling log below, which
          ordinary use flushes within a few app opens. */}
      {incidents.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ color: 'var(--text)' }}>INCIDENTS ({incidents.length}):</div>
          {incidents.slice(-6).reverse().map((e, i) => (
            <div key={i}>{e.t.slice(0, 16).replace('T', ' ')} · {e.verdict}</div>
          ))}
        </div>
      )}

      {log.slice(-8).reverse().map((e, i) => (
        <div key={i} style={{ opacity: .7 }}>
          {e.t.slice(5, 19).replace('T', ' ')} {e.kind}
          {e.detail ? ` · ${e.detail}` : ''}{e.n ? ` ×${e.n}` : ''}
        </div>
      ))}

      {/* ⏱ TEMPORARY — the forensic timeline. Shown OLDEST-FIRST, unlike the
          log above, because this is read as a SEQUENCE: resumed → refreshed →
          rejected → signed out. Reversing it would hide the causal order,
          which is the only thing this view is for. Delete with
          authForensics.js once the cause is known. */}
      {forensics.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
          <div style={{ color: 'var(--text)' }}>AUTH TIMELINE (last 14):</div>
          {forensics.slice(-14).map((e, i) => (
            <div key={i} style={{ opacity: .75 }}>
              {e.t.slice(11, 19)} {e.kind}{e.detail ? ` · ${e.detail}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Which service worker is actually installed on THIS device.
 *
 * ⚠ ASKS THE WORKER, rather than fetching /sw.js. Fetching would report what
 * the SERVER has, which is never the question — the server has been correct
 * every time this has come up. What matters is the worker the phone is
 * running, and only the worker can answer that.
 *
 * Four outcomes, each meaning something different:
 *   a build string  – the worker replied; compare it against the source
 *   "too old to answer" – a worker is controlling the page but has no
 *                          version listener, i.e. it predates this feature.
 *                          THE MOST USEFUL RESULT: it names a stale worker
 *                          without needing to know which one.
 *   "not controlling"  – registered but not yet in charge; a reload activates it
 *   "unsupported"      – no service worker API at all
 */
function ServiceWorkerStamp() {
  const [state, setState] = useState('checking…');

  useEffect(() => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; setState(v); } };

    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      finish('unsupported');
      return undefined;
    }
    const ctrl = navigator.serviceWorker.controller;
    if (!ctrl) { finish('not controlling this page — reload'); return undefined; }

    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => {
      const d = e.data || {};
      finish(`${d.build || '?'}${d.contactJoinPush ? '' : ' ⚠ no contact-join push'}`);
    };
    try { ctrl.postMessage({ type: 'yp:sw-version' }, [ch.port2]); }
    catch { finish('could not be asked'); }

    // An older worker has no listener for this and will never reply. Silence
    // IS the answer, so it needs a deadline rather than an indefinite wait.
    const t = setTimeout(() => finish('⚠ too old to answer — stale worker'), 1500);
    return () => { done = true; clearTimeout(t); };
  }, []);

  return <div className={s.buildStamp} style={{ marginTop: 0, paddingTop: 4, borderTop: 'none' }}>sw: {state}</div>;
}

/**
 * ⏱ TEMPORARY — what the service worker did with each push, on THIS device.
 *
 * Oldest first, because it is read as a sequence. The absence of a line is as
 * informative as its content:
 *
 *   nothing at all       the push event never fired — Chrome/FCM never woke
 *                        the worker. Not our code.
 *   received, no shown   we were called and did not render.
 *   shown registered=0   the browser accepted the notification and then
 *                        registered nothing — the OS discarded it. Measured
 *                        happening on desktop Chrome, so it is not theoretical.
 *   shown registered=1   we did our job; anything still missing is OS-side.
 */
function PushLogReadout() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let cancelled = false;
    readPushLog().then(r => { if (!cancelled) setRows(r); });
    return () => { cancelled = true; };
  }, []);

  if (rows === null) return null;

  return (
    <div className={s.buildStamp} style={{ textAlign: 'left' }}>
      <div style={{ color: 'var(--text)' }}>PUSH LOG ({rows.length}):</div>
      {rows.length === 0
        ? <div style={{ opacity: .7 }}>no push has reached this device's worker</div>
        : rows.slice(-12).map((e, i) => (
            <div key={i} style={{ opacity: .75 }}>
              {String(e.t).slice(11, 19)} {e.stage}{e.detail ? ` · ${e.detail}` : ''}
            </div>
          ))}
    </div>
  );
}
