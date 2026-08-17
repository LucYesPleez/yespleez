import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { track, EVENTS } from './analytics';

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

/**
 * ── THE TWO WAYS A LINK LEAVES THE APP ──────────────────────────────
 *
 * Lifted out of ShareSheet (owner, 2026-08-05) when Invite Friends became a
 * single button instead of a row that opened that sheet. Both surfaces call
 * these, so there is still exactly ONE implementation of each act — the rule
 * the sharing architecture has always had, kept true as the UI changed.
 *
 * ⚠ TRACKING BELONGS HERE, NOT AT THE CALL SITE. It fires only after the act
 * actually completes, so a cancelled native sheet is not counted as a share —
 * and a caller that forgot to track would silently under-report.
 *
 * ⚠ THE RESOURCE TYPE ONLY, NEVER `url` OR `title`. A private link is a
 * capability; putting one in an analytics row copies it somewhere with
 * different access rules than the thing it opens.
 */
export async function nativeShare(target) {
  if (!canNativeShare() || !target) return false;
  try {
    await navigator.share({
      title: target.title,
      text:  target.preview || undefined,
      url:   target.url,
    });
    track(EVENTS.SHARED, { resource: target.type ?? null, method: 'native' });
    return true;
  } catch {
    // A cancelled share sheet rejects. Not an error worth surfacing.
    return false;
  }
}

export async function copyLink(target) {
  if (!target?.url) return false;
  try {
    await navigator.clipboard.writeText(target.url);
    track(EVENTS.SHARED, { resource: target.type ?? null, method: 'copy_link' });
    return true;
  } catch {
    return false;
  }
}

/**
 * ⭐ THE WHOLE MESSAGE, ⛔ not just the link.
 *
 * ⚠ `copyLink` puts a bare URL on the clipboard, which is right for "share this
 * page" and wrong for an OFFER: the recipient gets a naked link from a number
 * they may not know. This copies the composed text WITH the link in it, so what
 * lands in a text message or an Instagram DM reads as something a person wrote.
 *
 * ⛔ A THIRD implementation of copying must not appear at a call site. That is
 * the rule this module exists for, and the reason this lives here rather than
 * in the sheet that needed it first.
 */
export async function copyMessage(target) {
  const text = target?.preview || target?.url;
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    track(EVENTS.SHARED, { resource: target.type ?? null, method: 'copy_message' });
    return true;
  } catch {
    return false;
  }
}

/** Whether the platform offers a share sheet at all. */
export function canNativeShare() {
  return typeof navigator !== 'undefined' && !!navigator.share;
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
