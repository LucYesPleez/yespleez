/**
 * ⏱ TEMPORARY — reads the account the SERVICE WORKER writes of each push.
 *
 * A service worker on a phone has no console anyone can read, and the failure
 * being chased is invisible from outside: Android shows nothing while iPhone
 * shows the same notification, from the same send, on the same worker build.
 * Three hypotheses have already been wrong (stale bundle, stale worker,
 * deferred delivery), so the worker now records what actually happens and this
 * reads it back for the ⓘ sheet.
 *
 * ⚠ WRITER LIVES IN public/sw.js AND THIS IS THE ONLY OTHER READER. The
 * database name, version and store are a hand-copy — sw.js is served verbatim
 * and cannot import anything. If they change there, change them here.
 *
 * ⚠ NEVER CREATES OR UPGRADES THE DATABASE. Opened without a version so an
 * absent database resolves empty instead of racing sw.js to define the schema;
 * two writers creating the same store is how a blocked upgrade hangs the very
 * push handler being measured.
 *
 * Delete with the sw.js logging once the cause is known.
 */
const DB = 'yp_push_log';
const STORE = 'events';

/**
 * @returns {Promise<Array<{t: string, stage: string, detail: string|null}>>}
 *   oldest first — this is read as a SEQUENCE (received → parsed →
 *   name-resolved → shown), and the order is the whole point.
 */
export function readPushLog() {
  if (typeof indexedDB === 'undefined') return Promise.resolve([]);
  return new Promise((resolve) => {
    let req;
    // No version argument: open whatever exists, create nothing.
    try { req = indexedDB.open(DB); } catch { resolve([]); return; }

    // A push handler can hold the database briefly; never wait forever for it.
    const done = setTimeout(() => resolve([]), 1200);
    const finish = (v) => { clearTimeout(done); resolve(v); };

    req.onerror   = () => finish([]);
    req.onblocked = () => finish([]);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) { finish([]); return; }
      try {
        const all = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        all.onsuccess = () => finish(Array.isArray(all.result) ? all.result : []);
        all.onerror   = () => finish([]);
      } catch { finish([]); }
    };
  });
}
