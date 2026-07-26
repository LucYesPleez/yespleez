/**
 * sw.js · THE CONTACT-JOIN PUSH MUST SURVIVE A BROKEN IndexedDB.
 *
 * ⚠ THIS GUARDS A BUG THAT ACTUALLY SHIPPED, and it is tested here rather than
 * left to review because the failure is completely silent. The push handler
 * awaits a name lookup before calling showNotification. When that lookup never
 * settled, the await never returned, the notification was never shown, and iOS
 * discarded the push and killed the worker — no error, no notification, no
 * trace anywhere. The server-side logs said `sent: 4` the whole time.
 *
 * `indexedDB.open` has at least two paths that fire NO callback: `onblocked`,
 * when another connection holds the database, and a worker suspended
 * mid-request. Neither is exotic on a phone.
 *
 * ⚠ sw.js IS NOT A MODULE. It is served verbatim from public/ and cannot be
 * imported, so the function is extracted from source and evaluated. That is
 * the price of testing the file that actually ships rather than a copy of it.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SW_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'sw.js');
const SW_SRC = readFileSync(SW_PATH, 'utf8');

/** Pull contactNameFor (and its constants) out of the shipped file. */
function loadContactNameFor(indexedDBStub) {
  const start = SW_SRC.indexOf('const CONTACT_NAME_TIMEOUT_MS');
  const end   = SW_SRC.indexOf('function setBadge');
  assert.ok(start !== -1 && end > start,
    'could not locate contactNameFor in sw.js — the markers this test slices on have moved');

  const body = SW_SRC.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(
    'indexedDB', 'CONTACTS_DB', 'CONTACTS_DB_VERSION', 'CONTACTS_STORE',
    `${body}; return contactNameFor;`,
  )(indexedDBStub, 'yp_contacts', 1, 'names');
}

/** An open() that resolves through the usual success path with one stored row. */
function workingDb(rows) {
  return {
    open() {
      const req = {};
      queueMicrotask(() => {
        req.result = {
          objectStoreNames: { contains: () => true },
          transaction: () => ({
            objectStore: () => ({
              get(key) {
                const g = {};
                queueMicrotask(() => {
                  g.result = rows[key] ? { id: key, name: rows[key] } : undefined;
                  g.onsuccess?.();
                });
                return g;
              },
            }),
          }),
        };
        req.onsuccess?.();
      });
      return req;
    },
  };
}

// ── THE FAILURE THAT SHIPPED ─────────────────────────────────────────────

test('⚠ an open() that never fires a callback still settles', async () => {
  // The exact production failure. Without a timeout this promise hangs, the
  // await above it never returns, and the notification is lost in silence.
  const started = Date.now();
  const contactNameFor = loadContactNameFor({ open: () => ({}) });

  const name = await contactNameFor('abc');
  const elapsed = Date.now() - started;

  assert.equal(name, null, 'a hung lookup must resolve null, not hang');
  assert.ok(elapsed < 3000, `must settle promptly; took ${elapsed}ms`);
});

test('⚠ onblocked settles instead of hanging', async () => {
  // Fires INSTEAD of onsuccess when another connection holds the database —
  // i.e. whenever the app itself has it open, which on a phone is often.
  const contactNameFor = loadContactNameFor({
    open() {
      const req = {};
      queueMicrotask(() => req.onblocked?.());
      return req;
    },
  });
  assert.equal(await contactNameFor('abc'), null);
});

test('a throwing open() settles rather than rejecting', async () => {
  const contactNameFor = loadContactNameFor({
    open() { throw new Error('SecurityError'); },
  });
  assert.equal(await contactNameFor('abc'), null);
});

test('a missing object store settles null', async () => {
  // The device synced contacts never — the store does not exist and a
  // transaction against it would throw.
  const contactNameFor = loadContactNameFor({
    open() {
      const req = {};
      queueMicrotask(() => {
        req.result = { objectStoreNames: { contains: () => false } };
        req.onsuccess?.();
      });
      return req;
    },
  });
  assert.equal(await contactNameFor('abc'), null);
});

// ── AND IT STILL HAS TO WORK ─────────────────────────────────────────────

test('a healthy lookup returns the stored name', async () => {
  // Mutation guard on every test above: if contactNameFor simply returned
  // null unconditionally, they would all pass and the feature would be dead.
  const contactNameFor = loadContactNameFor(workingDb({ 'code-1': 'Sarah' }));
  assert.equal(await contactNameFor('code-1'), 'Sarah');
});

test('an unknown id returns null, not undefined', async () => {
  const contactNameFor = loadContactNameFor(workingDb({}));
  assert.equal(await contactNameFor('nope'), null);
});

test('no id short-circuits without touching the database', async () => {
  const contactNameFor = loadContactNameFor({
    open() { throw new Error('must not be opened'); },
  });
  assert.equal(await contactNameFor(null), null);
});

// ── THE COPY THE OWNER SPECIFIED ─────────────────────────────────────────

test('both notification wordings are exactly as specified', () => {
  // Checked against the shipped file because this text is the entire
  // user-visible output of the feature, and the fallback is what renders
  // whenever a name cannot be resolved — which is every failure above.
  assert.ok(
    SW_SRC.includes('from your contacts joined YesPleez.'),
    'the named wording has drifted',
  );
  assert.ok(
    SW_SRC.includes("'Someone from your contacts joined YesPleez.'"),
    'the fallback wording has drifted',
  );
});

test('⚠ showNotification is not gated on the name resolving', () => {
  // Structural, because the ordering is the bug. There must be no `return`
  // between the lookup and the show that could skip it.
  const branch = SW_SRC.slice(
    SW_SRC.indexOf("payload?.type === 'contact_joined'"),
    SW_SRC.indexOf('if (!conversationId) return'),
  );
  assert.ok(branch.includes('showNotification'), 'the branch no longer shows a notification');
  assert.ok(
    /catch\s*{\s*name = null/.test(branch),
    'the lookup is no longer wrapped — a throw could once again cost the notification',
  );
});
