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
/**
 * ⚠ BUMP THIS WHENEVER sw.js CHANGES IN A WAY A DEVICE MUST PICK UP.
 *
 * The ⓘ build stamp reports the JS BUNDLE, which is a different file with a
 * different update lifecycle — a phone can show a current bundle while running
 * a service worker from weeks ago. That gap has now cost two debugging
 * sessions: an iPhone and an Android both looked "up to date" while running an
 * old push handler, and there was no way to tell from the device.
 *
 * The app asks for this over postMessage and shows it beside the bundle stamp,
 * so "which worker is actually installed?" is answerable from the phone.
 * Hand-maintained on purpose: sw.js is served verbatim from public/ and never
 * passes through Vite, so no build-time value can be injected here.
 */
const SW_BUILD = '2026-08-22b · fallback stamped';

/**
 * ⏱ TEMPORARY — WHAT HAPPENS TO A PUSH ON THIS DEVICE?
 *
 * Android shows no notification while iPhone shows one, from the same send.
 * Established so far: FCM accepted the push for the Android's own endpoint
 * (sent:4, pruned:0, endpoint fcm.googleapis.com), and the installed worker is
 * current (this file). So the push reaches Chrome and the right code is
 * present — yet nothing appears, and three hypotheses have now been wrong.
 *
 * A service worker on a phone has no console anyone can read, so it writes its
 * own account of each push here and the app displays it. This distinguishes
 * the three remaining possibilities, which look identical from the outside:
 *
 *   no 'received' entry   the push event never fired — Chrome/FCM never woke
 *                         the worker. Not our code at all.
 *   'received', no 'shown'  we were called and did not render — an exception,
 *                         or a promise that never settled.
 *   'shown' but no banner the OS suppressed the notification it was given.
 *                         Permission, or a notification channel setting.
 *
 * Its own database, deliberately: adding a store to yp_contacts would need a
 * version bump on a database the app also holds open, and a blocked upgrade
 * could hang the very handler being measured.
 */
const PUSH_LOG_DB = 'yp_push_log';
const PUSH_LOG_STORE = 'events';

function logPush(stage, detail) {
  try {
    const req = indexedDB.open(PUSH_LOG_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PUSH_LOG_STORE)) {
        db.createObjectStore(PUSH_LOG_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => {
      try {
        const db = req.result;
        const os = db.transaction(PUSH_LOG_STORE, 'readwrite').objectStore(PUSH_LOG_STORE);
        os.add({ t: new Date().toISOString(), stage, detail: detail ?? null });
        // Keep it small — this is a rolling window, not an archive.
        const all = os.getAllKeys();
        all.onsuccess = () => {
          const keys = all.result || [];
          for (const k of keys.slice(0, Math.max(0, keys.length - 40))) os.delete(k);
        };
      } catch { /* a diagnostic must never break the push path */ }
    };
  } catch { /* same */ }
}

/* ⚠ BUMPED TO v2 (2026-08-22) TO THROW AWAY POLLUTED CACHES. Every tab that
   ran the previous worker has dead `/index.html?_v=…` probes in yp-assets-v1,
   crowding out the real bundle. `activate` deletes every yp- cache it does not
   own, so renaming them is the cheapest possible repair: one extra download
   each, once, and no migration code to keep forever.
   ⛔ Do not bump this for an ordinary deploy — asset names are content-hashed,
   so a new build reuses the cache correctly. Bump it only when what is IN the
   cache is wrong. */
const CACHE_VERSION = 'v2';
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
    /* ⛔ THE SUCCESS PATH IS RETURNED UNTOUCHED, deliberately. Rebuilding it to
       add a header would put this worker in the way of every document the app
       ever loads, to label the case that is already obvious. Absence of the
       header below IS the network answer. */
    lastShell = { source: 'network', at: new Date().toISOString() };
    return fresh;
  } catch {
    // Offline. This branch is also what Chromium's installability check
    // exercises when it probes start_url with the network disabled.
    const cached = await cache.match(SHELL_URL);
    if (cached) {
      /**
       * ⭐⭐ A FALLBACK LOAD SAYS SO (owner, 2026-08-22: "stamp the fallback so
       * we can tell").
       *
       * ⚠⚠ THIS BRANCH IS INDISTINGUISHABLE FROM A NORMAL LOAD WITHOUT IT, and
       * that cost real time: the cached shell can be an OLDER BUILD, so the app
       * boots looking current while running code from a previous deploy, and
       * every question after that ("did it ship?", "is the CSS live?") gets a
       * confidently wrong answer. It fires on ANY fetch failure — a dead venue
       * signal, yes, but also one aborted request.
       *
       * ⚠ The body is streamed through as-is; only headers are added, so the
       * document itself is byte-identical to what was cached.
       */
      const headers = new Headers(cached.headers);
      headers.set('X-YP-Shell', 'cache');
      lastShell = { source: 'cache', at: new Date().toISOString() };
      return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
    }
    lastShell = { source: 'offline-page', at: new Date().toISOString() };
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>YesPleez — offline</title>' +
      '<body style="background:#0a0a0f;color:#fff;font-family:system-ui;display:grid;' +
      'place-items:center;height:100vh;margin:0"><p>You are offline.</p></body>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-YP-Shell': 'offline-page' } },
    );
  }
}

/**
 * How the last document was served, for the ⓘ panel to ask about.
 *
 * ⚠⚠ IN MEMORY, AND THE WORKER IS KILLED WHEN IDLE — so `null` means "this
 * worker has not served a document since it started", ⛔ NOT "nothing has gone
 * wrong". The header on the response is the durable evidence; this is the
 * version you can read from a phone with no DevTools attached.
 */
let lastShell = null;

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

  /**
   * ⛔⛔ THE DOCUMENT IS NEVER CACHED OUTSIDE A NAVIGATION. `lib/appUpdate`
   * asks "is a newer build deployed?" by fetching `/index.html?_v=<now>` with
   * `cache: 'no-store'` — but `no-store` speaks to the HTTP cache, ⛔ NOT to
   * this worker, which intercepts either way. That request is not a
   * navigation, so it fell through to `staleWhileRevalidate` and was WRITTEN
   * INTO THE ASSET CACHE.
   *
   * ⚠⚠ MEASURED, 2026-08-22: three checks put three permanent entries in
   * `yp-assets-v1`. The timestamp makes every probe URL unique, so not one of
   * them is ever read again — and the cache FIFO-trims at 40, so a tab left
   * open feeds its own probes in at one every 30 minutes and EVICTS the real
   * bundle, css and audio this cache exists to hold. The check itself still
   * worked, which is why it was invisible.
   *
   * ⛔ Passing through, ⛔ not caching-with-an-exception: the update check must
   * reach the network or its silence means "up to date" when it is not, and
   * `no-store` only does its job once this worker stops answering for it.
   */
  if (url.pathname === '/index.html') return;

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
/**
 * `contact_code_id -> the name THIS DEVICE saved that person under`.
 *
 * ⚠⚠ THE SECOND READER OF ONE DATABASE, AND NOTHING IN THE BUILD LINKS THEM.
 * The writer is `src/lib/contactNameStore.js`. This file is served from
 * `public/` verbatim — it is not bundled, so it cannot import that module and
 * these constants are a hand-copy. **If DB_NAME, DB_VERSION or STORE change
 * there, they must change here too**, or every contact-join push silently
 * loses its name and degrades to "Someone from your contacts".
 *
 * Returns null on every failure path rather than throwing: a missing name
 * costs a nicer string, while a rejection here would lose the notification
 * entirely.
 */
const CONTACTS_DB = 'yp_contacts';
const CONTACTS_DB_VERSION = 1;
const CONTACTS_STORE = 'names';

const CONTACT_NAME_TIMEOUT_MS = 1200;

function contactNameFor(contactCodeId) {
  if (!contactCodeId || typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    // ⚠⚠ THIS PROMISE MUST ALWAYS SETTLE, AND THE TIMEOUT IS NOT BELT-AND-
    // BRACES — IT IS THE POINT.
    //
    // A push handler shows its notification AFTER this resolves. If the open
    // never fires any callback, `await` never returns, showNotification is
    // never called, and the OS silently discards the push and kills the
    // worker. The user sees nothing and no error exists anywhere.
    // `indexedDB.open` has at least two such paths: `onblocked`, which fires
    // instead of onsuccess when another connection holds the database, and a
    // suspended-then-resumed worker where the request is simply abandoned.
    //
    // Message pushes never touch IndexedDB, which is exactly why they were
    // unaffected while contact joins produced nothing at all.
    //
    // Losing a name costs the nicer string. Losing the notification costs the
    // feature. Never trade the second for the first.
    const done = setTimeout(() => resolve(null), CONTACT_NAME_TIMEOUT_MS);
    const finish = (value) => { clearTimeout(done); resolve(value); };

    let req;
    try { req = indexedDB.open(CONTACTS_DB, CONTACTS_DB_VERSION); }
    catch { finish(null); return; }

    req.onerror   = () => finish(null);
    req.onblocked = () => finish(null);
    req.onsuccess = () => {
      const db = req.result;
      // The app may never have synced on this device, in which case the store
      // does not exist and a transaction against it would throw.
      if (!db.objectStoreNames.contains(CONTACTS_STORE)) { finish(null); return; }
      try {
        const os = db.transaction(CONTACTS_STORE, 'readonly').objectStore(CONTACTS_STORE);
        const get = os.get(String(contactCodeId));
        get.onsuccess = () => finish(get.result?.name ?? null);
        get.onerror   = () => finish(null);
      } catch { finish(null); }
    };
  });
}

/**
 * MP·5b — the OS icon badge, set from the only code that still runs when the
 * app is fully closed.
 *
 * ⚠ null MEANS "LEAVE IT ALONE", NOT "CLEAR IT". The server sends null when
 * its count lookup failed; clearing on an unrelated failure would hide a real
 * unread badge.
 */
function setBadge(badgeCount) {
  if (typeof badgeCount !== 'number' || !('setAppBadge' in navigator)) return Promise.resolve();
  return (badgeCount > 0 ? navigator.setAppBadge(badgeCount) : navigator.clearAppBadge())
    .catch(() => {});
}

/**
 * "Which worker am I actually running?" — answered by the worker itself.
 *
 * Reports SW_BUILD plus the capabilities that matter for diagnosing a missing
 * notification. `contactJoinPush` is read from the code path's own existence
 * rather than asserted separately, so it cannot claim a feature this file does
 * not have.
 *
 * Replies down the MessagePort the caller supplies; a worker with no such
 * listener simply never answers, which the app treats as "too old to say".
 */
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'yp:sw-version') return;
  event.ports?.[0]?.postMessage({
    build: SW_BUILD,
    cacheVersion: CACHE_VERSION,
    /* ⚠ null means this worker has not served a document since it started —
       a worker is killed when idle — ⛔ NOT "nothing has gone wrong". The
       X-YP-Shell header on the response is the durable evidence; this is the
       copy you can read from a phone with no DevTools attached. */
    lastShell,
    contactJoinPush: typeof contactNameFor === 'function',
  });
});

self.addEventListener('push', (event) => {
  // ⏱ FIRST LINE, BEFORE ANY GUARD. If this entry is missing after a send, the
  // push event never reached the worker at all and nothing below is implicated.
  logPush('received', `permission=${self.Notification?.permission ?? 'unknown'}`);

  if (!event.data) { logPush('dropped', 'no event.data'); return; }

  let payload;
  try { payload = event.data.json(); }
  catch (e) { logPush('dropped', 'payload not JSON: ' + String(e?.message || e)); return; }
  logPush('parsed', `type=${payload?.type ?? '(message)'}`);

  const { conversationId, senderName, kind, badgeCount } = payload || {};

  // ── CJ2 · A CONTACT JOINED ──────────────────────────────────────────
  //
  // ⚠ THE NAME IS RESOLVED HERE, ON THE DEVICE, AND NOWHERE ELSE. The server
  // sends only `contactCodeId` — an opaque id that means nothing off this
  // phone — because contact names have never left it and must not start now.
  // Looking the name up in IndexedDB is the entire reason that map was moved
  // out of localStorage: a service worker cannot read localStorage, and this
  // handler is what renders a push on a locked phone. Without this lookup
  // every notification would read "Someone from your contacts", which is the
  // one thing the feature exists to avoid.
  //
  // Branch BEFORE the conversationId guard below: a contact join has no
  // conversation, and that guard would otherwise drop it silently.
  if (payload?.type === 'contact_joined') {
    event.waitUntil((async () => {
      // ⚠⚠ THE NAME IS AN ENHANCEMENT. THE NOTIFICATION IS THE PRODUCT.
      //
      // Owner, after this shipped broken once: "Never lose a notification
      // because a friendly name couldn't be resolved." Every failure mode of
      // the lookup — timeout, blocked database, missing store, absent entry,
      // an exception from anywhere inside it — collapses to `null` here, and
      // null simply means the fallback wording. There is deliberately no path
      // from a naming problem to a missing notification.
      //
      // The catch is not decoration: contactNameFor is written not to throw,
      // but "written not to throw" is a claim about today's code, and the cost
      // of it being wrong is a silently dropped push — the exact failure that
      // sent us round this loop once already.
      let name = null;
      try { name = await contactNameFor(payload.contactCodeId); }
      catch { name = null; }
      logPush('name-resolved', name ? 'found' : 'fallback');

      try {
        await self.registration.showNotification(
          name
            ? `${name} from your contacts joined YesPleez.`
            : 'Someone from your contacts joined YesPleez.',
          {
            icon: '/icon-192.png',
            // Its own tag, so a join never collapses into a conversation's
            // notification and several joins collapse with each other.
            tag: 'contact-joined',
            renotify: true,
          },
        );
        // ⏱ Did the call merely RESOLVE, or is a notification actually
        // registered? Measured on desktop Chrome that showNotification can
        // resolve cleanly while the browser registers nothing at all — the OS
        // had discarded it. "Resolved" and "displayed" are different claims
        // and only the second one matters, so both are recorded.
        const live = await self.registration.getNotifications({ tag: 'contact-joined' });
        logPush('shown', `resolved, registered=${live.length}`);
      } catch (e) {
        logPush('show-failed', String(e?.name || '') + ': ' + String(e?.message || e));
      }

      try { await setBadge(badgeCount); } catch { /* badge is cosmetic */ }
    })());
    return;
  }

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
    // MP·5b — see setBadge above; shared with the contact-join branch so the
    // two can never disagree about what a null count means.
    setBadge(badgeCount),
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
