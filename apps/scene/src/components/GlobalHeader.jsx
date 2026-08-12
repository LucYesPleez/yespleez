import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import s from './GlobalHeader.module.css';
import NotifPanel from './NotifPanel';
import ProfileMenu from './ProfileMenu';
import BetaWelcomePopup from './BetaWelcomePopup';
import useAutoHideHeader from '../hooks/useAutoHideHeader';
import { readAuthLog, readAuthIncidents } from '../lib/authDiagnostics';
import { readForensics } from '../lib/authForensics';
import { readPushLog } from '../lib/pushLog';
import InstallButton from './InstallButton';
import TourOverlay from './TourOverlay';
import TourWelcome from './TourWelcome';
import TourInfoNotice from './TourInfoNotice';
import {
  tourFinished, finishTour, announceTourFinished, resetTour, tourOverride,
  startTour, onTourStart, autoTourSuppressed, tourWelcomeBlocked,
} from '../lib/tourState';

const INFO = {
  '/': {
    title: "WHATS HAPPENIN'",
    // ⚠ No longer mentions a share icon in the top right — there isn't one
    // (owner, 2026-08-04). Sharing lives on the event page itself now, which
    // is also where someone is when they decide to share something.
    body: `<p>Browse all upcoming events in your city.</p><ul><li><strong>Tap any event card</strong> to see the full lineup, set times, and details.</li><li><strong>Scroll left/right</strong> on the calendar strip to jump to a date.</li><li><strong>Share</strong> an event from its own page, using the SHARE button under the description.</li></ul>`
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

export default function GlobalHeader({ unreadCount = 0, session = null, onSignOut = null }) {
  const navigate    = useNavigate();
  const location    = useLocation();
  const [infoOpen,  setInfoOpen]  = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  // ⚠ THE BUILD STAMP, SW STATE, AND BOTH LOGS ARE HIDDEN BY DEFAULT — owner:
  // "I don't want all that info easily available for everyone to see." They
  // are diagnostic, not explanatory, and belong behind a second tap from
  // anyone who is not actively debugging a device. See DiagnosticsReadout.
  const [diagOpen,  setDiagOpen]  = useState(false);
  const headerRef = useRef(null);
  const infoRef = useRef(null);

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

  /**
   * ⭐ AUTO-HIDE, APP-WIDE (owner, 2026-08-04). Mounted once above the router
   * in App.jsx, so every screen inherits it without opting in — a screen that
   * needs the bar pinned calls `useAlwaysVisibleHeader()` instead.
   *
   * ⚠ The height published above is measured with getBoundingClientRect, which
   * is UNAFFECTED by the hide: a transform does not change layout geometry, so
   * `--yp-header-height` keeps reporting the real reserved height even while
   * the bar is off-screen. Anything reserving space for it — the event page's
   * padding-top, ShareSheet's `top` — therefore does not move when it hides,
   * which is the "no layout shift" requirement holding by construction rather
   * than by care.
   */
  useAutoHideHeader(headerRef, s.hidden);

  const info = INFO[location.pathname] || FALLBACK;

  // ⚠ CLOSE ON OUTSIDE CLICK, NOT ONLY ON THE CLOSE BUTTON — owner: "I don't
  // want it tied to having to hit close." Matches NotifPanel's own pattern
  // (a document-level mousedown checking the panel's own ref), so the two
  // dropdowns in this header behave identically. `mousedown` rather than
  // `click` so the panel closes before whatever was clicked underneath it
  // fires its own handler.
  useEffect(() => {
    if (!infoOpen) return undefined;
    function handleClick(e) {
      if (infoRef.current && !infoRef.current.contains(e.target)) setInfoOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [infoOpen]);

  // Diagnostics never stay expanded across a close/reopen — every time this
  // sheet is opened fresh, the log readouts are collapsed again by default.
  useEffect(() => { if (!infoOpen) setDiagOpen(false); }, [infoOpen]);

  function handleBack() {
    if (window.history.length > 1) navigate(-1);
  }

  return (
    <>
      {/* `yp-global-header` is a STABLE hook for rules that live outside this
          module — the CSS-module class is content-hashed (_header_11rgr_1)
          and changes whenever this file does, so it cannot be targeted from
          index.css. See the photo-viewer rule there. */}
      <div className={`${s.header} yp-global-header`} ref={headerRef}>
        <button className={`${s.backBtn} yp-tap44`} onClick={handleBack} aria-label="Back">
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
          /* 42.4×24 measured — the worst offender in the header, and 12px clear
             of the wordmark on one side and InstallButton on the other. */
          className={`yp-tap44 ${s.betaTag}`}
          onClick={() => navigate('/beta-feedback')}
          aria-label="Give beta feedback"
        >
          BETA
        </button>

        {/* Sits beside BETA rather than in the right-hand icon cluster: that
            cluster is permanent chrome (share · info · bell), and this is a
            once-per-device action that removes itself the moment it is done. */}
        <InstallButton />

        {/* ⛔ NO SHARE ICON (owner, 2026-08-04). Top bar order is now
            Back · logo · Info · bell.

            Sharing is NOT lost: the surfaces worth sharing carry their own
            control — the event page's SHARE in § 4 and the address share in
            § 7 both build their link with `shareUrl` directly. The header's
            button was the generic fallback for whatever screen happened to be
            mounted, which is the least specific version of the action.

            ⚠ `useShareTarget` DECLARATIONS ARE NOW UNCONSUMED. EventScreen
            still declares one and nothing reads it any more — see the note
            where `useCurrentShareTarget` used to be called. Left in place
            rather than ripped out, because the navigation/sharing architecture
            treats it as the canonical way a screen announces what it
            represents, and retiring it is a decision rather than a cleanup. */}
        <div className={s.actions} style={{ position: 'relative' }}>
          {/* ⛔ THE ⓘ INFO BUTTON IS GONE TOO (owner, 2026-08-04) — its sheet
              now opens from the menu's Help & Feedback item.

              ⚠ `data-tour="info"` MOVED WITH IT, onto the identity control.
              The guided tour's final step anchors to that attribute, and the
              engine SKIPS a target it cannot find rather than throwing — so
              deleting the button without rehoming the anchor would have gone
              dark with a clean console and nobody the wiser. See ProfileMenu.

          ⛔ THE NOTIFICATION BELL IS GONE (owner, 2026-08-04). Its two jobs
              moved into the identity control beside it: the unread count is now
              a badge on the avatar, and the panel opens from the menu's
              Notifications item.

              ⚠ THE PANEL ITSELF IS NOT GONE — only the button that opened it.
              The brief removed a control, not a feature, and NotifPanel below
              is unchanged; ProfileMenu simply asks for it via
              `onOpenNotifications`. */}
          <ProfileMenu
            session={session}
            unreadCount={unreadCount}
            onSignOut={onSignOut}
            onOpenNotifications={() => { setPanelOpen(true); setInfoOpen(false); }}
            onOpenHelp={() => { setInfoOpen(true); setPanelOpen(false); }}
          />

          {/* DEF-4 — `onMarkAll` is gone rather than rewired. The panel used to
              have to tell the header it had marked things read, because it did
              so on open; now rows are marked as they are SEEN, at unpredictable
              moments, and marking read announces itself on the window instead
              (NOTIFICATIONS_READ_EVENT). App.jsx listens and re-counts. A prop
              alongside that event would be a second path saying the same
              thing — and NotificationsScreen, which has no props to pass, would
              still need the event. */}
          {panelOpen && <NotifPanel onClose={() => setPanelOpen(false)} />}
        </div>
      </div>

      {/* Info sheet */}
      <div className={infoOpen ? s.infoOverlayOpen : s.infoOverlay}>
        <div className={s.infoSheet} ref={infoRef}>
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

          {/* ⭐ THE FEEDBACK HALF OF "HELP & FEEDBACK" (owner, 2026-08-04).
              The menu item that opens this sheet is named Help & Feedback, and
              it would only have been half true without a way through to the
              form. Same close-first reason as the tour button above: this
              sheet is a fixed panel at z-index 400 and would sit over the page
              it just sent you to. */}
          <button
            className={s.infoTour}
            onClick={() => { setInfoOpen(false); navigate('/beta-feedback'); }}
          >
            GIVE FEEDBACK
          </button>

          {/* ⚠ A PLACEHOLDER, AND IT MUST READ AS ONE. Per-role walkthroughs
              (artist, venue, host, promoter) are planned but do not exist, so
              this is `disabled` in the DOM — not merely styled to look
              inactive. A button that only LOOKS dead still takes focus, still
              announces itself as pressable to a screen reader, and still
              invites a tap that does nothing. The SOON tag says why it is
              inert, which is the difference between "coming" and "broken".
              Delete the `disabled` and the tag together when the tours land. */}
          <button className={s.infoTourSoon} disabled>
            INDUSTRY ROLE TOURS
            <span className={s.infoSoonTag}>SOON</span>
          </button>

          {/* ⚠ EVERYTHING BELOW THIS BUTTON IS DIAGNOSTIC, NOT EXPLANATORY —
              the build stamp, the service worker's own version, and both
              logs. Owner: "I don't want all that info easily available for
              everyone to see." Collapsed by default and reset closed every
              time this sheet reopens; the person who actually needs it (the
              owner, mid-debugging-call) taps once for it, and everyone else
              never sees a wall of build numbers under a page's help text. */}
          <button
            type="button"
            className={s.infoDiagToggle}
            onClick={() => setDiagOpen(v => !v)}
          >
            {diagOpen ? 'HIDE DIAGNOSTICS' : 'DIAGNOSTICS'}
          </button>

          {diagOpen && <DiagnosticsReadout />}

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
 * ONBOARDING'S TRAFFIC CONTROL — welcome, tour, and the install handover.
 *
 * ⚠⚠ THE TOUR IS NO LONGER AUTOMATIC. It used to start itself; now a welcome
 * card asks first, and the tour runs only if invited. That is the difference
 * between being shown a product and being handed one — and it means the done
 * flag is spent by ANSWERING the welcome, not by seeing the tour.
 *
 * ⚠ THE 1.2s DELAY IS LOAD-BEARING. Arriving the instant the splash clears
 * means the user never sees the app they are being welcomed into, and the
 * card reads as one more loading screen. Long enough to register "I'm in",
 * short enough to still feel like part of opening the app.
 *
 * ⚠⚠ THE "WHERE THE TOUR LIVES" CARD ONLY FIRES ON SKIP, AND ONLY BEFORE
 * STEP 7. It went away once — the reasoning was that the tour's own last step
 * (tourSteps.js's "info" step) already spotlights the ⓘ and says the same
 * thing, so a card repeating it after finishing was one message told twice.
 * That held for completion, but not for skipping: someone who presses "Skip
 * Tour" at step 2 never reaches step 7, and would leave onboarding having
 * never once been told the tour still exists. This card exists for exactly
 * that gap — see `close()`.
 *
 * The order on the way out is fixed and matters:
 *   welcome answered → tour → (info notice, ONLY if skipped early) → install
 * Never two overlays at once. See announceTourFinished.
 */
function TourRunner() {
  /**
   * ⭐ O2 — WHERE THIS SESSION BEGAN, captured once. A visitor who arrived
   * on an event or a profile (QR, shared link) gets the content, not the
   * generic welcome card; see autoTourSuppressed. A ref, not state: it is
   * the FIRST route, and navigating afterwards must not change the answer.
   */
  const location = useLocation();
  const landingPathRef = useRef(location.pathname);

  const [welcome, setWelcome] = useState(false);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(tourFinished);
  const [infoNotice, setInfoNotice] = useState(false);
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
    // ⛔ Not on a deep link into content. The flag is deliberately NOT spent
    // — this suppresses the automatic offer for this session only.
    if (autoTourSuppressed(landingPathRef.current)) return undefined;
    const t = setTimeout(() => setWelcome(true), 1200);
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
  /** The welcome's two answers. Both spend onboarding; only one runs a tour. */
  function acceptTour() {
    finishTour();
    setDone(true);
    setWelcome(false);
    setOpen(true);
  }

  /**
   * ⚠ NO TOAST HERE, UNLIKE THE OTHER TWO EXITS. The welcome card just told
   * them the same sentence the toast would — "Guided Tour available any time
   * from the ⓘ button" now lives under Skip for now — so popping the same
   * line up again the instant the card closes would be the one thing this
   * whole redesign was meant to stop: telling the user something twice in a
   * row.
   *
   * ⚠ THE INSTALL HANDOVER STILL WAITS, just on a timer instead of the
   * toast's lifespan. Announcing on the same tick the card starts closing
   * would open the install spotlight mid-exit-animation; 450ms is enough for
   * the card's own fade-and-scale to finish first.
   */
  function declineTour() {
    finishTour();
    setDone(true);
    setWelcome(false);
    setTimeout(announceTourFinished, 450);
  }

  /**
   * ⚠ THE REASON IS WHAT DECIDES THE NOTICE, NOT WHETHER THE USER FINISHED.
   * Completing the tour ends on step 7, which already spotlights the ⓘ —
   * showing this card next would repeat it. Skipping is the only exit that
   * can happen BEFORE step 7 ever runs, which is the one case with nothing
   * else to say where the tour went.
   */
  function close(reason) {
    setOpen(false);

    // A replay just ends. Nothing is spent and nothing announced — they
    // started it from the ⓘ, moments ago, and re-announcing would open the
    // install spotlight over someone who came here on purpose to look around.
    if (replay) { setReplay(false); return; }

    if (reason === 'skipped') { setInfoNotice(true); return; }
    announceTourFinished();
  }

  /**
   * ⚠ THE INSTALL SPOTLIGHT WAITS FOR THIS TO BE DISMISSED. It dims the whole
   * screen, at a higher z-index than the notice (4800 over 4750) — firing
   * together would mean reading a message about the tour through a scrim
   * about installing.
   */
  function infoNoticeDone() {
    setInfoNotice(false);
    announceTourFinished();
  }

  return (
    <>
      {/* ⛔ Never over a screen that is itself asking something (/auth, /start).
          Checked at RENDER against the live route rather than latched at
          timer-time: the card is on a 1200ms fuse and the person may have
          walked onto — or off — one of those screens in the meantime. */}
      {welcome && !tourWelcomeBlocked(location.pathname)
        && <TourWelcome onStart={acceptTour} onSkip={declineTour} />}
      <TourOverlay open={open} startAt={startAt} onClose={close} />
      <TourInfoNotice open={infoNotice} onClose={infoNoticeDone} />
    </>
  );
}

/**
 * EVERYTHING DIAGNOSTIC, BEHIND ONE MUTED BUTTON.
 *
 * ⚠ ONLY MOUNTED WHILE `diagOpen` IS TRUE, and that gate is what actually
 * hides this from casual view — it used to be `infoOpen && …` on each piece
 * individually, meaning every visitor who opened the ⓘ for the page's own
 * help text got the build stamp, the service worker's version, and both logs
 * for free underneath it. Owner: "I don't want all that info easily
 * available for everyone to see." One parent gate here replaces the four
 * scattered ones; nothing inside needs its own condition any more.
 */
function DiagnosticsReadout() {
  return (
    <>
      {/* WHICH BUILD AM I LOOKING AT.
          A stale bundle has cost real debugging time twice — a phone kept
          serving a build from before a fix while every diagnostic read
          healthy. The commit is the part that actually settles it: the
          version only moves when someone remembers, the SHA moves every
          deploy. */}
      <div className={s.buildStamp}>{BUILD_STAMP}</div>

      {/* ⚠ THE WORKER IS A SEPARATE FILE WITH A SEPARATE LIFECYCLE, and the
          stamp above does not cover it. A phone can report a current bundle
          while running a service worker from weeks ago — which is exactly
          what happened twice while debugging a push that never arrived, on
          two different devices, both of which looked up to date. Asked of
          the worker itself, so this reports what is INSTALLED, not what the
          server would serve. */}
      <ServiceWorkerStamp />
      <PushLogReadout />
      <AuthLogReadout />
    </>
  );
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
