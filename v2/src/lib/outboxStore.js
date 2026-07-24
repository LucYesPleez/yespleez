/**
 * OUTBOX STORAGE — two backends, one interface.
 *
 * The outbox logic is written against this shape so it can run on an in-memory
 * Map in tests (there is no IndexedDB in the Node runner) and on real
 * IndexedDB in the browser, unchanged:
 *
 *   put(entry)                     upsert by id
 *   get(id)                        one entry or null
 *   getDraft(conversationId)       the single draft, or null
 *   byState(state)                 every entry in a state
 *   byConversation(conversationId) every entry for a conversation
 *   remove(id)                     delete by id
 *   all()                          every entry
 *
 * Blobs are stored as-is — IndexedDB keeps them without base64 inflation, which
 * matters when a draft can be minutes of audio.
 */

import { DRAFT } from './outboxMachine';

/* ── IN-MEMORY (tests, and a fallback when IndexedDB is unavailable) ── */

/**
 * A Map-backed store with the full interface. Also the graceful fallback for
 * private-mode browsers where indexedDB throws: the outbox still works for the
 * session, it simply does not survive a reload — which is strictly better than
 * a composer that cannot save at all.
 */
export function memoryStore() {
  const rows = new Map();
  return {
    async put(entry)  { rows.set(entry.id, { ...entry }); },
    async get(id)     { const r = rows.get(id); return r ? { ...r } : null; },
    async getDraft(conversationId) {
      for (const r of rows.values()) {
        if (r.conversationId === conversationId && r.state === DRAFT) return { ...r };
      }
      return null;
    },
    async byState(state)          { return [...rows.values()].filter(r => r.state === state).map(r => ({ ...r })); },
    async byConversation(cid)     { return [...rows.values()].filter(r => r.conversationId === cid).map(r => ({ ...r })); },
    async remove(id)              { rows.delete(id); },
    async all()                   { return [...rows.values()].map(r => ({ ...r })); },
  };
}

/* ── INDEXEDDB (the browser) ─────────────────────────────────────── */

const DB_NAME  = 'yp_outbox';
const STORE    = 'entries';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        // conversationId powers getDraft/byConversation; state powers the flush
        // work list. Both are hot paths, so both are indexed rather than scanned.
        os.createIndex('conversationId', 'conversationId', { unique: false });
        os.createIndex('state', 'state', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const os = t.objectStore(STORE);
    let out;
    Promise.resolve(fn(os)).then(v => { out = v; }).catch(reject);
    t.oncomplete = () => resolve(out);
    t.onerror    = () => reject(t.error);
    t.onabort    = () => reject(t.error);
  });
}

function reqAsync(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

/**
 * The real store. Opens the database lazily and caches the handle.
 *
 * ⚠ FALLS BACK TO MEMORY IF INDEXEDDB IS UNAVAILABLE. Safari private mode and
 * locked-down profiles throw on open; rule 2 (a draft is durable) is best-effort
 * there rather than a crash, so a draft lives for the session and the user still
 * loses nothing they did not choose to.
 */
export function indexedDbStore() {
  let dbPromise = null;
  let fallback  = null;

  async function db() {
    if (fallback) return null;
    if (!dbPromise) {
      dbPromise = openDb().catch(() => { fallback = memoryStore(); return null; });
    }
    return dbPromise;
  }

  return {
    async put(entry) {
      const database = await db();
      if (!database) return fallback.put(entry);
      return tx(database, 'readwrite', os => reqAsync(os.put({ ...entry })));
    },
    async get(id) {
      const database = await db();
      if (!database) return fallback.get(id);
      return tx(database, 'readonly', os => reqAsync(os.get(id))).then(r => r ?? null);
    },
    async getDraft(conversationId) {
      const database = await db();
      if (!database) return fallback.getDraft(conversationId);
      const rows = await tx(database, 'readonly', os =>
        reqAsync(os.index('conversationId').getAll(conversationId)));
      return (rows || []).find(r => r.state === DRAFT) ?? null;
    },
    async byState(state) {
      const database = await db();
      if (!database) return fallback.byState(state);
      return tx(database, 'readonly', os => reqAsync(os.index('state').getAll(state))).then(r => r || []);
    },
    async byConversation(conversationId) {
      const database = await db();
      if (!database) return fallback.byConversation(conversationId);
      return tx(database, 'readonly', os =>
        reqAsync(os.index('conversationId').getAll(conversationId))).then(r => r || []);
    },
    async remove(id) {
      const database = await db();
      if (!database) return fallback.remove(id);
      return tx(database, 'readwrite', os => reqAsync(os.delete(id)));
    },
    async all() {
      const database = await db();
      if (!database) return fallback.all();
      return tx(database, 'readonly', os => reqAsync(os.getAll())).then(r => r || []);
    },
  };
}
