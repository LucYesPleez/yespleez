import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/**
 * SHARE ARCHITECTURE — resource-driven, permanent.
 *
 * The Share button in GlobalHeader is GENERIC and must stay that way. It has no
 * knowledge of events, profiles, venues or festivals, and no `if (isEvent)`
 * branch will ever be correct here.
 *
 * Instead each shareable SCREEN declares its own canonical payload:
 *
 *     useShareTarget({
 *       type:    'event',
 *       title:   event.name,
 *       url:     shareUrl(`/event/${event.id}`),
 *       preview: event.blurb,
 *       access:  'public',
 *     });
 *
 * The header renders whatever the current screen declared. A screen that
 * declares nothing gets the page fallback (current URL, document title), so
 * nothing breaks — but a screen representing a shareable RESOURCE should always
 * declare, because the fallback cannot know the resource's real title or its
 * canonical URL.
 *
 * ── WHY A CANONICAL URL, NOT window.location.href ────────────────────
 *
 * The old handler shared `window.location.href`. That is the CURRENT page,
 * which is usually right and occasionally embarrassing: a profile reached
 * through a legacy `/profile/<user_id>` URL would share the legacy form, which
 * M5.1's redirect shim exists to retire. A resource knows its own canonical
 * address; the address bar only knows how you happened to arrive.
 *
 * ── PRIVATE RESOURCES ────────────────────────────────────────────────
 *
 * `access: 'private'` still produces a link. Permission is resolved when the
 * link is OPENED, not when it is created — the recipient lands on
 * `/access-required`. This is deliberate: generating a link is not granting
 * access, and refusing to generate one would mean building the access model
 * first. Collaborator management, invitations, ACL editing and ownership
 * transfer are a FUTURE Access Management milestone and are NOT part of this.
 */

const ShareTargetCtx = createContext(null);

/** The app-level store. One live target at a time — whatever screen is mounted. */
export function ShareTargetProvider({ children }) {
  const [target, setTarget] = useState(null);
  const value = useMemo(() => ({ target, setTarget }), [target]);
  return <ShareTargetCtx.Provider value={value}>{children}</ShareTargetCtx.Provider>;
}

/**
 * Declare this screen's canonical share payload.
 *
 * Registers on mount, clears on unmount — so navigating away from a resource
 * cannot leave its payload behind for the next screen to share by accident.
 *
 * @param {object|null} payload {type, title, url, preview, access}
 */
export function useShareTarget(payload) {
  const ctx = useContext(ShareTargetCtx);
  const setTarget = ctx?.setTarget;

  // Serialised so a caller passing an object literal inline does not re-register
  // on every render. Screens should not have to useMemo to use this safely.
  const key = payload ? JSON.stringify(payload) : null;

  useEffect(() => {
    if (!setTarget) return undefined;
    setTarget(key ? JSON.parse(key) : null);
    return () => setTarget(null);
  }, [key, setTarget]);
}

/** Read the live target. Used by the header; screens should not need this. */
export function useCurrentShareTarget() {
  return useContext(ShareTargetCtx)?.target ?? null;
}

/**
 * Absolute URL for an in-app path.
 *
 * The app uses HashRouter, so a shareable link MUST carry the `#` — a
 * path-based URL silently renders home, which is the worst kind of broken link
 * because it looks like it worked.
 */
export function shareUrl(path) {
  const clean = String(path || '/').replace(/^#/, '');
  return `${window.location.origin}${window.location.pathname}#${clean.startsWith('/') ? clean : `/${clean}`}`;
}

/** The fallback payload for a screen that declares nothing. */
export function pageFallback() {
  return {
    type:   'page',
    title:  document.title || 'YesPleez',
    url:    window.location.href,
    access: 'public',
  };
}
