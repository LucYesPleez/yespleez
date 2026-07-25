/* eslint-env serviceworker */
/**
 * YESPLEEZ SERVICE WORKER
 *
 * Two jobs, in this order of importance:
 *
 *   1. MAKE THE APP INSTALLABLE. Chromium refuses to offer installation
 *      unless a service worker with a fetch handler is registered, so
 *      without this file Android and desktop cannot install YesPleez at all
 *      — and the A1 install metric would read zero for a platform reason
 *      rather than a user-interest one.
 *   2. Survive a bad connection. A gig listing that opens on a dead phone
 *      signal at a venue is the whole point of installing it.
 *
 * ⚠ THE FAILURE MODE THIS FILE IS DESIGNED AROUND ─────────────────────
 *
 * A careless service worker serves a stale build FOREVER. Users get an old
 * app, hard refresh does not fix it (the worker answers before the network
 * is consulted), and the only remedy is talking every tester through
 * clearing site data. It is the single worst outcome available here, and it
 * is worse than having no offline support at all.
 *
 * Two rules keep that impossible:
 *
 *   HTML IS NEVER SERVED FROM CACHE WHILE ONLINE. Navigations go to the
 *   network first, every time. index.html is the document that names which
 *   build's assets to load, so as long as it is fresh, the app is fresh.
 *   Cache is the OFFLINE fallback only.
 *
 *   ONLY CONTENT-HASHED FILES ARE CACHED INDEFINITELY. Vite emits
 *   /assets/<name>-<hash>.js — the filename changes whenever the contents
 *   change, so a cached copy can never be the wrong version of anything. A
 *   new build simply requests names that are not in the cache yet.
 *
 * Everything else same-origin (icons, default avatars, chat wallpaper) uses
 * stale-while-revalidate: instant from cache, refreshed in the background,
 * so replacing one of those files costs at most one stale view.
 *
 * ⚠ NOTHING CROSS-ORIGIN IS TOUCHED. Supabase REST, auth, storage and
 * realtime all pass straight through to the network — this worker never
 * calls respondWith() for them. Caching an API response here would mean
 * serving one user's data to the next person on the device, and caching an
 * auth call would be worse. If you ever add a cross-origin rule, that is the
 * question to answer first.
 */

/**
 * Bump to force every client to discard its caches on next activation.
 *
 * Not needed for ordinary deploys — hashed filenames and network-first HTML
 * handle those on their own. This is the manual escape hatch for the day
 * something is genuinely stuck: change the value, ship, and every install
 * starts from empty.
 */
const CACHE_VERSION = 'v1';
const SHELL_CACHE   = `yp-shell-${CACHE_VERSION}`;
const ASSET_CACHE   = `yp-assets-${CACHE_VERSION}`;
const OWNED_CACHES  = [SHELL_CACHE, ASSET_CACHE];

/** The document every route renders into — this app is a hash router, so there is exactly one. */
const SHELL_URL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // `reload` bypasses the HTTP cache so a freshly installed worker cannot
    // precache a copy the browser had already staled out.
    await cache.add(new Request(SHELL_URL, { cache: 'reload' }));
    // Take over without waiting for every existing tab to close. Safe here
    // because HTML is network-first: a client that switches to this worker
    // mid-session still gets fresh documents.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n.startsWith('yp-') && !OWNED_CACHES.includes(n))
           .map(n => caches.delete(n)),
    );
    await self.clients.claim();
  })());
});

/** Vite's content-hashed build output. These filenames are immutable by construction. */
function isHashedAsset(url) {
  return url.pathname.startsWith('/assets/');
}

/**
 * Network-first, cache as backup. Used for navigations only.
 *
 * The cache is written on every successful load so the offline fallback is
 * the most recent shell the user actually saw, not the one from install day.
 */
async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(SHELL_URL, fresh.clone());
    return fresh;
  } catch {
    // Offline. This branch is also what Chromium's installability check
    // exercises when it probes start_url with the network disabled.
    const cached = await cache.match(SHELL_URL);
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>YesPleez — offline</title>' +
      '<body style="background:#0a0a0f;color:#fff;font-family:system-ui;display:grid;' +
      'place-items:center;height:100vh;margin:0"><p>You are offline.</p></body>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

/**
 * Keep the asset cache from growing without limit.
 *
 * Content-hashed filenames are why cache-first is safe, and also why the
 * cache never invalidates anything on its own: every deploy asks for names
 * that have never been seen, and the previous build's bundle stays behind
 * forever. That is harmless per deploy and about a megabyte a time, which
 * over a few months of beta builds is not nothing.
 *
 * FIFO, because Cache.keys() resolves in insertion order — the oldest entry
 * is the front of the list. Evicting a still-needed asset costs one network
 * fetch, not a broken page, so being approximate here is fine.
 */
const MAX_ASSET_ENTRIES = 40;

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map(k => cache.delete(k)));
}

/** Cache-first. Only ever called for filenames that change when their contents change. */
async function cacheFirst(request) {
  const cache  = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    await cache.put(request, fresh.clone());
    await trimCache(cache, MAX_ASSET_ENTRIES);
  }
  return fresh;
}

/**
 * Stale-while-revalidate. For same-origin files whose names do NOT change
 * when they do — icons, default avatars, the chat wallpaper.
 *
 * Returns the cached copy at once and refreshes it in the background, so
 * replacing one of these costs at most a single stale view rather than
 * being wrong until the cache is cleared.
 */
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (fresh) => {
      if (fresh && fresh.ok) {
        await cache.put(request, fresh.clone());
        await trimCache(cache, MAX_ASSET_ENTRIES);
      }
      return fresh;
    })
    .catch(() => null);
  return cached || network.then(r => r || Response.error());
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET is ever cacheable. A POST is an action, not a document.
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }

  // ⚠ Cross-origin is Supabase — REST, auth, storage, realtime. Left
  // entirely alone; see the header note.
  if (url.origin !== self.location.origin) return;

  // Dev-server internals. This worker only registers in production builds,
  // but a stale registration from a previous session must not intercept
  // Vite's module graph and make HMR look broken.
  if (url.pathname.startsWith('/@') || url.pathname.startsWith('/src/') || url.pathname.startsWith('/node_modules/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

/**
 * MP3 · PUSH NOTIFICATIONS.
 *
 * A third job, added after the two above — same file, same worker, but this
 * pair of listeners has nothing to do with caching and must not be allowed
 * to grow into it. If you're touching fetch/install/activate for a push
 * reason, stop; the boundary is deliberate.
 *
 * ⚠ THE PAYLOAD CONTRACT — never plaintext message content. ─────────────
 *
 * The push service (and the OS notification tray it renders through) is
 * outside this app's trust boundary. MP4's sending function must never put
 * a message's text into the push payload, and this handler must never be
 * changed to expect it there. What IS safe to carry: a conversation id (a
 * routing token, not a secret), a sender's display name, and a message
 * KIND (text/voice/image/file/hand — for picking a sound, not for showing
 * content). This is also what keeps push compatible with libsignal once
 * encryption lands: the server sending the push will not possess the
 * plaintext to leak even if it wanted to.
 *
 * A later "show the real message text in the preview" feature (the
 * Always/When-unlocked/Never setting on the roadmap) has to be satisfied
 * WITHOUT changing this contract — e.g. the client already caches recent
 * message text locally and looks it up by conversationId when building the
 * notification, or a future end-to-end-encrypted payload is decrypted
 * here. Sending the plaintext through the push service is not an option.
 */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try { payload = event.data.json(); } catch { return; }

  const { conversationId, senderName, kind, badgeCount } = payload || {};
  if (!conversationId) return; // no routing token, nothing to show or open

  const title = senderName ? senderName : 'New message';
  const body  = kind === 'voice' ? 'Sent a voice note'
              : kind === 'image' ? 'Sent a photo'
              : kind === 'file'  ? 'Sent a file'
              : kind === 'hand'  ? 'Sent a message'
              : 'Sent a message';

  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      // Same conversation collapses to one notification instead of stacking
      // one per message — a burst of five texts reads as one alert, not five.
      tag: `conversation-${conversationId}`,
      renotify: true,
    }),
    // MP·5b — the ONLY place the OS icon badge is ever set from a push,
    // since this is the only code that still runs when the app is fully
    // closed. `navigator` is a valid global in a service worker (it is a
    // WorkerNavigator, not a Window one, but the Badging API is defined on
    // both). `badgeCount` is null rather than 0 when the server-side lookup
    // failed — treat null as "leave the badge alone", NOT as "clear it";
    // clearing on an unrelated failure would hide a real unread badge.
    (typeof badgeCount === 'number' && 'setAppBadge' in navigator)
      ? (badgeCount > 0 ? navigator.setAppBadge(badgeCount) : navigator.clearAppBadge()).catch(() => {})
      : Promise.resolve(),
  ]));
});

/**
 * ⚠ OWNER DECISION (2026-07-25): tapping a notification opens the app's
 * landing page, NEVER the conversation directly. Tried the deep-link
 * version first; the owner's explicit preference after seeing it in
 * practice: "I want to look and see is it the bell or the messages that
 * have the notification, in which case I'll decide if I even want to open
 * that message." A glance-then-decide step, not a jump straight into the
 * thread. Do not reintroduce a conversation URL here without checking back
 * — this was tested behavior, not an oversight.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = '/';

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Focus an existing tab rather than opening a duplicate — same idiom as
    // any native app, and it keeps the Outbox/realtime state that tab
    // already holds instead of a fresh reload racing to catch up.
    for (const client of allClients) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(url).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
