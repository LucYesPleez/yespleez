import { useState, useEffect } from 'react';
import { isInstalled } from '../lib/analytics';
import { installAvailable, onInstallAvailabilityChange } from '../lib/installPrompt';
import InstallSheet from './InstallSheet';
import s from './GlobalHeader.module.css';

/**
 * ADD TO HOME SCREEN — header entry point, beside BETA.
 *
 * ⚠ HIDDEN ONCE INSTALLED. `isInstalled()` (analytics.js) already knows, via
 * display-mode plus the iOS-only `navigator.standalone`. A permanent
 * invitation to install something you are already running reads as a broken
 * check — and note this is why the owner could not see the button on either
 * of their own phones: both have the app installed. It only shows in a
 * browser tab, which is exactly who it is for.
 *
 * This is now only the trigger. The screen itself is the owner's supplied
 * artwork — see InstallSheet.
 */
export default function InstallButton() {
  const [open, setOpen] = useState(false);
  const [canInstall, setCanInstall] = useState(installAvailable);

  // Availability arrives asynchronously — beforeinstallprompt has usually not
  // fired yet at first render — so this subscribes rather than reading once.
  useEffect(() => onInstallAvailabilityChange(() => setCanInstall(installAvailable())), []);

  // Called during render on purpose — a synchronous media/navigator read, not
  // state, and it must re-evaluate if the app is opened installed.
  if (isInstalled()) return null;

  // ⚠⚠ ANDROID ONLY, AND THIS IS THE GATE THAT SAYS SO. Owner: "i dont want it
  // on ios. i have a different one for that."
  //
  // Keyed on whether a native install dialog is actually available, NOT on
  // sniffing the user agent. Safari implements no part of beforeinstallprompt
  // at any version, so iOS is excluded for free — and it is excluded for the
  // RIGHT reason: the button only exists where tapping it can really install
  // something. A UA check would also have to guess about iPadOS pretending to
  // be a Mac, Chrome-on-iOS (which is Safari underneath and equally incapable),
  // and every future browser.
  //
  // The corollary: there is now NO install path on iOS. That is deliberate and
  // temporary — the owner has separate iOS artwork coming. Until it lands,
  // iPhone users cannot enable push, because iOS web push requires a
  // home-screen install. Worth remembering when that design arrives.
  if (!canInstall) return null;

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
      <InstallSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
