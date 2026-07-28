import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { isInstalled } from '../lib/analytics';
import { installAvailable, onInstallAvailabilityChange } from '../lib/installPrompt';
import InstallSheet from './InstallSheet';
import InstallSpotlight from './InstallSpotlight';
import useBreath from '../hooks/useBreath';
import {
  coachDismissed, dismissCoach, resetCoach,
  BREATH_MS, SPOTLIGHT_INTERVAL_MS, AMBIENT_FIRST_MS, AMBIENT_INTERVAL_MS,
} from '../lib/installCoach';
import s from './GlobalHeader.module.css';
import sp from './InstallSpotlight.module.css';

/**
 * ⚠ iPadOS REPORTS ITSELF AS A MAC. Since iPadOS 13 the user agent says
 * "Macintosh", so an /iPad/ test misses every modern iPad. A touch-capable
 * "Mac" is the standard tell, and it matters here because an iPad that fails
 * this check gets no install screen at all — Safari never fires
 * beforeinstallprompt, so it would fall through both branches.
 */
function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
}

/**
 * WHICH iOS BROWSER — because the install steps genuinely differ.
 *
 * ⚠ EVERY iOS BROWSER IS SAFARI UNDERNEATH, so the usual "is it Chrome"
 * checks are useless here: Chrome for iOS still reports Safari and WebKit,
 * because Apple requires it to use WebKit. What distinguishes them is a
 * vendor token each adds: CriOS (Chrome), FxiOS (Firefox), EdgiOS (Edge),
 * OPiOS/OPT (Opera).
 *
 * ⚠ SAFARI IS THE DEFAULT, SO IT IS THE FALLBACK. Anything not carrying a
 * known vendor token is treated as Safari — a browser we have never heard of
 * is far more likely to use Safari's share-sheet flow (it has no choice about
 * the engine) than Chrome's ••• menu.
 *
 * The two flows are not cosmetic variants:
 *   Chrome  ••• More  →  Add to Home Screen  →  Add
 *   Safari  Share ⬆    →  Add to Home Screen  →  Add
 * Safari has no ••• button at all, so showing Chrome's guide there sends the
 * user hunting for a control that does not exist.
 */
function iosBrowser() {
  const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
  return /CriOS|FxiOS|EdgiOS|OPiOS|OPT\//.test(ua) ? 'chrome' : 'safari';
}

/**
 * ADD TO HOME SCREEN — header entry point, beside BETA.
 *
 * ⚠ HIDDEN ONCE INSTALLED, on both platforms. `isInstalled()` (analytics.js)
 * knows via display-mode plus the iOS-only `navigator.standalone`. This is why
 * the owner could not see the button on either of their own phones: both have
 * the app installed. It shows in a browser tab, which is exactly who it is for.
 *
 * Two platforms, two screens, and they are not variants of one thing:
 *
 *   ANDROID  shown only once a native install dialog is genuinely available,
 *            i.e. beforeinstallprompt has been captured. The artwork's pill
 *            fires the real thing.
 *   iOS      shown whenever not installed. Safari has no install API at any
 *            version, so the screen is a four-step guide with nothing to tap.
 *            Availability can never become true here, which is exactly why iOS
 *            needs its own condition rather than sharing Android's.
 */
/**
 * ⏱ TEMPORARY — `?install=android` / `ios-chrome` / `ios-safari` forces the
 * sheet, on any device, whatever is installed.
 *
 * ⚠ WITHOUT THIS THERE IS NO WAY TO SEE TWO OF THE THREE SCREENS. Each one is
 * gated on the platform it serves, which is correct for users and hostile to
 * review: the owner cannot see the Safari guide from Android, nor the Android
 * one from an iPhone. Worse, Chrome does not fire beforeinstallprompt when the
 * app is ALREADY INSTALLED — so on a phone with YesPleez installed the Android
 * button is unreachable even in a browser tab, and checking it would mean
 * uninstalling the app first.
 *
 * Opt-in by URL only. A user who never types `?install=` cannot reach it, and
 * it cannot change what any real visitor sees. Delete once the screens are
 * signed off.
 */
function forcedPlatform() {
  if (typeof window === 'undefined') return null;
  // HashRouter puts the app's own query after the '#', so both halves of the
  // URL have to be checked — `?install=` alone misses `/#/messages?install=`.
  const raw = window.location.search + window.location.hash;
  const m = /[?&]install=(android|ios-chrome|ios-safari)/.exec(raw);
  return m ? m[1] : null;
}

/**
 * ⏱ TEMPORARY, and a sibling of `?install=` above — `?coach=reset` clears the
 * "already taught" flag so the spotlight can be seen again, and `?coach=off`
 * suppresses it. The spotlight is a ONCE-PER-DEVICE event by design, which
 * makes it un-reviewable the moment anyone has seen it: there is otherwise no
 * way back to it short of clearing site data, which also signs you out.
 */
function coachOverride() {
  if (typeof window === 'undefined') return null;
  const raw = window.location.search + window.location.hash;
  const m = /[?&]coach=(reset|off)/.exec(raw);
  return m ? m[1] : null;
}

export default function InstallButton() {
  const [open, setOpen] = useState(false);
  const [canInstall, setCanInstall] = useState(installAvailable);
  const [taught, setTaught] = useState(coachDismissed);
  const btnRef = useRef(null);
  const location = useLocation();
  const forced = forcedPlatform();
  const override = coachOverride();

  // Availability arrives asynchronously — beforeinstallprompt has usually not
  // fired at first render — so this subscribes rather than reading once.
  useEffect(() => onInstallAvailabilityChange(() => setCanInstall(installAvailable())), []);

  // ⏱ Runs before the first paint of the overlay so `?coach=reset` shows the
  // spotlight on THIS load rather than the next one.
  useEffect(() => {
    if (override === 'reset') { resetCoach(); setTaught(false); }
    if (override === 'off') setTaught(true);
  }, [override]);

  // Called during render on purpose — a synchronous media/navigator read, not
  // state, and it must re-evaluate if the app is opened installed.
  // ⏱ The override wins here too: the owner's own phones both have the app
  // installed, which is exactly why they could not see the button at all.
  const installed = isInstalled() && !forced;
  const ios = isIOS();

  // ⚠ ANDROID IS GATED ON CAPABILITY, NOT ON A USER-AGENT GUESS. The button
  // appears only where tapping it can really install something, which also
  // covers Chromium on desktop without naming it. iOS is gated separately
  // because its screen promises instructions, not an install — a promise
  // Safari can always keep.
  const platform = installed ? null : (forced || (ios
    ? (iosBrowser() === 'chrome' ? 'ios-chrome' : 'ios-safari')
    : (canInstall ? 'android' : null)));

  /**
   * THE SPOTLIGHT IS iOS-ONLY, and that is not an oversight.
   *
   * On Android the icon fires a native install dialog the OS itself renders —
   * one tap, no instructions needed, and Chrome will nag on its own if we do
   * nothing. On iOS the icon opens a picture of a menu the user has to find
   * inside Safari, and there is no system prompt anywhere in the flow. iOS is
   * the only platform where NOT KNOWING WHERE TO TAP is the thing standing
   * between a user and an installed app, so it is the only one worth dimming
   * the whole screen for.
   */
  const spotlightEligible = !!platform && platform.startsWith('ios');
  const coaching = spotlightEligible && !taught && !open;

  /**
   * ONE CLOCK, TWO ACTS — and it lives here because the icon lives here.
   *
   * The breath drives three things at once: the icon's own shimmer to full
   * white, the halo out in the overlay, and (after dismissal) the ambient ring
   * in the header. They are in three different elements across two components,
   * so a single flag is the only thing that keeps them one event. Two hooks
   * would start a frame or two apart and read as a stutter.
   *
   *   ACT ONE (coaching)  first breath at 900ms — long enough for the veil to
   *                       have settled, short enough that the light arrives
   *                       while the user is still taking the screen in — then
   *                       every 8s.
   *   ACT TWO (taught)    4s into every new page, then every 12s. The route is
   *                       the reset key, so "each new page" means each new
   *                       page rather than wherever the interval happened to be.
   *
   * ⚠ SILENT WHILE THE SHEET IS OPEN. The install guide is full-screen; a
   * glow pulsing on a header icon behind it is pointing at something the user
   * cannot see and has already found.
   */
  const ambientOnly = !!platform && taught && !open;
  const lit = useBreath(
    coaching || ambientOnly,
    coaching ? 900 : AMBIENT_FIRST_MS,
    coaching ? SPOTLIGHT_INTERVAL_MS : AMBIENT_INTERVAL_MS,
    coaching ? 'coach' : location.pathname,
  );

  if (!platform) return null;

  /**
   * Tapping the icon SPENDS the spotlight, whether or not an install follows.
   * The lesson has landed at that point — they found the control — and if
   * they back out of the sheet, re-dimming the entire screen to point at an
   * icon they just pressed would be nagging, not teaching.
   */
  function handleTap() {
    setOpen(true);
    if (!taught) { dismissCoach(); setTaught(true); }
  }

  function handleLater() {
    dismissCoach();
    setTaught(true);
  }

  return (
    <>
      {/* ⚠ DELIBERATELY LARGER THAN THE HEADER'S OTHER ICONS (18px). Share,
          info and bell are chrome — always present, never the point. This is
          the install CTA. Owner: "it's going to be used as the button to
          install the app", and at chrome size it read as one more thing to
          ignore.
          ⚠ The stroke thins as it grows (1.7 → 1.5). A 1.7 stroke scaled to
          26px looks HEAVIER than its neighbours rather than merely bigger,
          which reads as a different icon set instead of an emphasised one. */}
      <button
        type="button"
        ref={btnRef}
        className={s.iconBtn}
        onClick={handleTap}
        aria-label="Add YesPleez to your home screen"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Add to home screen"
        style={{ marginLeft: 2 }}
      >
        {/* ACT TWO ONLY. While the spotlight is up the overlay's own halo is
            already ringing this icon; a second ring inside the button would
            double the light on the one thing whose brightness is being
            carefully controlled. */}
        {ambientOnly && (
          <span
            key={lit ? 'amb-on' : 'amb-off'}
            className={`${sp.ambient} ${lit ? sp.breathing : ''}`}
            aria-hidden="true"
          />
        )}

        {/* ⚠ THE LIGHTING CLASSES BELONG ON THE <svg>, NOT THE BUTTON — the
            ring above blends with `screen`, and a `filter` on their shared
            parent would trap it in the button's own blend group and turn it
            from light into grey paint. See InstallSpotlight.module.css.
            The two classes are independent layers: `targetLit` is where the
            icon RESTS while coaching, `targetBreath` is the rise to full
            white on each breath, and the animation declares no endpoints so
            it returns to whichever rest state applies. */}
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
             className={`${coaching ? sp.targetLit : ''} ${lit ? sp.targetBreath : ''}`}
             style={{ '--breath': `${BREATH_MS}ms` }}>
          {/* Phone outline, interrupted lower-right so the badge sits in a gap
              rather than crossing the stroke — matches the supplied artwork. */}
          <path d="M15.5 10V5.5A3.5 3.5 0 0 0 12 2H6.5A3.5 3.5 0 0 0 3 5.5v13A3.5 3.5 0 0 0 6.5 22H12a3.5 3.5 0 0 0 3.32-2.4" />
          <path d="M7.6 4.9h3.3" />
          <path d="M7.6 19.3h3.3" />
          <rect x="13.6" y="11.6" width="9.4" height="9.4" rx="3.2" />
          <path d="M18.3 14.4v3.8" />
          <path d="M16.4 16.3h3.8" />
        </svg>
      </button>

      {/* ⚠ Mounted always, not `{open && <InstallSheet/>}`. The sheet animates
          in from off-screen, and a component that only exists once open has
          nothing to animate FROM — it would appear instantly in place. It is
          pointer-transparent and renders no image while closed, so it costs
          nothing to leave mounted. */}
      <InstallSheet open={open} onClose={() => setOpen(false)} platform={platform} />

      {/* ⚠ MOUNTED ONLY WHILE COACHING, unlike the sheet above. It has nothing
          to animate in FROM — it fades the room down around an icon that is
          already in place — and while mounted it locks body scroll and fences
          off every control on the page. Left mounted-but-hidden it would be a
          scroll lock waiting for a stray truthy render. */}
      {coaching && (
        <InstallSpotlight open lit={lit} targetRef={btnRef} onDismiss={handleLater} />
      )}
    </>
  );
}
