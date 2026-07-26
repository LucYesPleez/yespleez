/**
 * `contact_code_id -> the name THIS DEVICE has that person saved under`.
 *
 * ⚠⚠ INDEXEDDB, NOT localStorage, AND THAT IS THE WHOLE POINT.
 *
 * This map was localStorage first, which worked in the app and could never
 * have worked where it matters most: **a service worker cannot read
 * localStorage**. Only IndexedDB and the Cache API are available to it. A push
 * notification arriving on a locked phone is rendered by the service worker,
 * so a localStorage map means every push says "Someone from your contacts
 * joined" and never "Sarah" — the exact feature Contact Join Notifications
 * exists to deliver.
 *
 * The same database is opened by `public/sw.js`. **If the name, version or
 * store name changes here it must change there too** — they are two
 * independent readers of one database, and nothing in the build links them.
 *
 * ⚠ NAMES NEVER LEAVE THE DEVICE. This store is the only place they live.
 * It is written after a sync and read at render time; it is never uploaded,
 * never included in a request, and has no server counterpart.
 */

export const DB_NAME = 'yp_contacts';
export const DB_VERSION = 1;
export const STORE = 'names';

function openDb() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { reject(e); return; }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // keyPath 'id' = contact_code_id, so a lookup from a push payload is
        // a single primary-key get with no index to keep in step.
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * In-memory fallback. Private browsing and some embedded webviews refuse to
 * open IndexedDB entirely; matching still works there, only NAMING degrades to
 * the fallback text. Losing a nicety is acceptable; failing a sync is not.
 */
let memory = new Map();
let useMemory = false;

/** Test seam, mirroring `__setOutboxStore`. */
export function __setContactNameMemory(on) {
  useMemory = on;
  memory = new Map();
}

async function withStore(mode, fn) {
  if (useMemory || typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const os = t.objectStore(STORE);
      const out = fn(os);
      t.oncomplete = () => resolve(out?.result ?? out ?? null);
      t.onerror    = () => reject(t.error);
      t.onabort    = () => reject(t.error);
    });
  } catch {
    return null;
  }
}

/** Remember several at once — one transaction per sync, not one per contact. */
export async function rememberNames(entries) {
  const list = Object.entries(entries ?? {}).filter(([, name]) => name);
  if (list.length === 0) return;

  if (useMemory || typeof indexedDB === 'undefined') {
    for (const [id, name] of list) memory.set(String(id), name);
    return;
  }
  await withStore('readwrite', (os) => {
    for (const [id, name] of list) os.put({ id: String(id), name });
  });
}

/** @returns {Promise<string|null>} */
export async function nameFor(contactCodeId) {
  const key = String(contactCodeId);
  if (useMemory || typeof indexedDB === 'undefined') return memory.get(key) ?? null;
  const row = await withStore('readonly', (os) => os.get(key));
  return row?.name ?? null;
}

/**
 * Erase every name. Called when uploaded codes are deleted — those ids no
 * longer exist, so keeping names against them would leave the only copy of an
 * address-book fragment sitting in storage for records that are gone.
 */
export async function clearNames() {
  memory = new Map();
  if (useMemory || typeof indexedDB === 'undefined') return;
  await withStore('readwrite', (os) => os.clear());
}
