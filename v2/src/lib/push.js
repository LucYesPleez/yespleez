import { supabase } from './supabase';

/**
 * MP2 · WEB PUSH SUBSCRIPTION.
 *
 * The only file that touches `pushManager`. Everything else (the settings
 * toggle, MP3's service-worker listeners, MP4's sending function) treats
 * this as the boundary — subscribe/unsubscribe here, deliver elsewhere.
 *
 * ── ONLY EVER CALLED FROM AN EXPLICIT USER TAP ───────────────────────
 *
 * `Notification.requestPermission()` shown on page load gets silently and
 * permanently blocked by both Chrome and iOS the moment a user dismisses it
 * once — there is no way back in from JS after that. So this must only run
 * from a settings toggle the user pressed, never from a mount effect.
 *
 * ── REQUIRES A PRODUCTION BUILD ───────────────────────────────────────
 *
 * The service worker (public/sw.js) only registers when `import.meta.env.PROD`
 * is true — see registerServiceWorker.js. `navigator.serviceWorker.ready`
 * below will hang forever under `npm run dev`. Test this against a built
 * app, the same way PWA install testing already requires.
 *
 * ── ENV ────────────────────────────────────────────────────────────────
 * VITE_VAPID_PUBLIC_KEY must be set (the public half of the keypair MP4's
 * edge function signs with). Generate with `npx web-push generate-vapid-keys`
 * in the owner's own terminal — this shell is sandboxed and cannot install
 * or run that command in a way the real machine would see.
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/**
 * MP·11 — the app-side half of "stay in sync with the OS permission".
 *
 * A push_subscriptions row and this device's actual OS permission can
 * drift apart with no event ever firing: revoking notification permission
 * in the OS/browser settings does not reliably fire anything JS can listen
 * for. So this endpoint is recorded locally the moment a subscription is
 * created — it is the ONLY way `reconcilePushState` can later identify and
 * remove precisely THIS device's row without touching any other device's
 * subscription (endpoint is globally unique, see MP1's migration comment).
 */
const ENDPOINT_STORAGE_KEY = 'yp_push_endpoint';

function rememberEndpoint(endpoint) {
  try { localStorage.setItem(ENDPOINT_STORAGE_KEY, endpoint); } catch { /* private browsing etc — best effort */ }
}
function forgetEndpoint() {
  try { localStorage.removeItem(ENDPOINT_STORAGE_KEY); } catch { /* ignore */ }
}
function rememberedEndpoint() {
  try { return localStorage.getItem(ENDPOINT_STORAGE_KEY); } catch { return null; }
}

/** True when this browser can support Web Push at all. Does not mean permission is granted. */
export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** 'granted' | 'denied' | 'default'. 'denied' cannot be undone from JS — only the browser's own site settings can. */
export function getPushPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * VAPID public keys are URL-safe base64; `pushManager.subscribe` needs a
 * Uint8Array. Standard conversion, no library needed for one function.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/**
 * Ask for permission (if not already decided) and subscribe this device,
 * upserting the row into push_subscriptions. Returns the outcome so the UI
 * can react — this never throws for an expected outcome, only for an
 * actual Supabase/network error.
 *
 * @param {string} userId
 * @returns {Promise<{ok: true} | {ok: false, reason: 'unsupported'|'denied'|'no-vapid-key'|'error', error?: any}>}
 */
export async function subscribeToPush(userId) {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };
  if (!VAPID_PUBLIC_KEY) return { ok: false, reason: 'no-vapid-key' };
  if (!userId) return { ok: false, reason: 'error', error: new Error('subscribeToPush called with no userId') };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json = subscription.toJSON();
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          user_agent: navigator.userAgent,
        },
        { onConflict: 'endpoint' },
      );

    if (error) return { ok: false, reason: 'error', error };
    rememberEndpoint(json.endpoint);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'error', error };
  }
}

/**
 * Unsubscribe this device and remove its row. Both sides matter: leaving
 * the browser subscribed but deleting only the DB row means the device
 * keeps a live subscription nothing will ever send to (harmless but
 * wasteful); leaving the DB row but unsubscribing the browser means MP4
 * pushes into a dead endpoint until the provider's error report is handled.
 *
 * @param {string} userId
 */
export async function unsubscribeFromPush(userId) {
  if (!isPushSupported()) return { ok: true };

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      if (userId) {
        await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint);
      }
    }
    forgetEndpoint();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'error', error };
  }
}

/**
 * Whether THIS device currently holds a live push subscription — for the
 * settings toggle to show its initial state without re-subscribing.
 */
export async function isSubscribedOnThisDevice() {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    const subscription = await registration.pushManager.getSubscription();
    return Boolean(subscription);
  } catch {
    return false;
  }
}

/**
 * MP·11 · SYNC WITH THE OS PERMISSION.
 *
 * Call on mount of anything showing push state, and again whenever the
 * Permissions API reports a change (see PushNotificationToggle). Detects
 * two ways permission can have been pulled out from under the app since
 * the last time it checked:
 *
 *   1. The browser already tore down the subscription itself (Chrome does
 *      this on revoke) — `getSubscription()` returns null even though a
 *      row still sits in push_subscriptions from before.
 *   2. The subscription object is still technically alive but
 *      `Notification.permission` no longer says 'granted' — a push to it
 *      would silently fail forever, so treat it as gone.
 *
 * Either way: unsubscribe locally (idempotent if already gone), delete
 * ONLY this device's row (identified by the endpoint saved at subscribe
 * time — never by user_id alone, which would touch every device), and
 * clear the local record. Returns the resulting state so the UI can
 * repaint without a second round-trip.
 *
 * @param {string} userId
 * @returns {Promise<{subscribed: boolean, permission: string}>}
 */
export async function reconcilePushState(userId) {
  const permission = getPushPermission();
  if (!isPushSupported()) return { subscribed: false, permission };

  let subscription = null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    subscription = registration ? await registration.pushManager.getSubscription() : null;
  } catch { /* treat as no subscription */ }

  const inSync = permission === 'granted' && Boolean(subscription);
  if (inSync) {
    rememberEndpoint(subscription.endpoint); // keep the record current if it ever drifted
    return { subscribed: true, permission };
  }

  // Out of sync: either revoked, or the subscription evaporated on its own.
  const staleEndpoint = subscription?.endpoint || rememberedEndpoint();
  if (subscription) await subscription.unsubscribe().catch(() => {});
  if (staleEndpoint && userId) {
    try {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', staleEndpoint);
    } catch { /* best effort — a stray row is harmless, MP4 will just 410 on it next send and prune it */ }
  }
  forgetEndpoint();
  return { subscribed: false, permission };
}
