import { useState, useEffect } from 'react';
import { isInstalled } from '../lib/analytics';
import { installAvailable, onInstallAvailabilityChange } from '../lib/installPrompt';
import InstallSheet from './InstallSheet';
import s from './GlobalHeader.module.css';

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

export default function InstallButton() {
  const [open, setOpen] = useState(false);
  const [canInstall, setCanInstall] = useState(installAvailable);
  const forced = forcedPlatform();

  // Availability arrives asynchronously — beforeinstallprompt has usually not
  // fired at first render — so this subscribes rather than reading once.
  useEffect(() => onInstallAvailabilityChange(() => setCanInstall(installAvailable())), []);

  // Called during render on purpose — a synchronous media/navigator read, not
  // state, and it must re-evaluate if the app is opened installed.
  // ⏱ The override wins here too: the owner's own phones both have the app
  // installed, which is exactly why they could not see the button at all.
  if (isInstalled() && !forced) return null;

  const ios = isIOS();

  // ⚠ ANDROID IS GATED ON CAPABILITY, NOT ON A USER-AGENT GUESS. The button
  // appears only where tapping it can really install something, which also
  // covers Chromium on desktop without naming it. iOS is gated separately
  // because its screen promises instructions, not an install — a promise
  // Safari can always keep.
  const platform = forced || (ios
    ? (iosBrowser() === 'chrome' ? 'ios-chrome' : 'ios-safari')
    : (canInstall ? 'android' : null));
  if (!platform) return null;

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
        className={s.iconBtn}
        onClick={() => setOpen(true)}
        aria-label="Add YesPleez to your home screen"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Add to home screen"
        style={{ marginLeft: 2 }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
    </>
  );
}
