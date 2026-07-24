/**
 * THE OUTBOX OPERATIONS — tested on their real code path against the in-memory
 * store (there is no IndexedDB in the Node runner, and the memory store shares
 * the exact interface the IndexedDB one exposes).
 *
 * The tests target the two constitutional rules specifically:
 *   1. content is never silently discarded;
 *   2. a draft is durable — only Delete or a confirmed Send removes it.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from './outboxStore.js';
import {
  saveDraft, restoreDraft, deleteDraft, enqueueDraft, retry, remove,
  flush, pruneAbandoned, registerUploader, __clearUploaders,
  __setOutboxClock, __setOutboxIdFactory,
} from './outbox.js';
import { QUEUED, FAILED, DRAFT_TTL_MS } from './outboxMachine.js';

const CONV = 'conv-1';
let s;
let t;         // controllable clock
let idSeq;

beforeEach(() => {
  s = memoryStore();
  t = 1_000_000;
  idSeq = 0;
  __setOutboxClock(() => t);
  __setOutboxIdFactory(() => `id-${++idSeq}`);
  __clearUploaders();
  if (typeof navigator === 'undefined') globalThis.navigator = {};
  navigator.onLine = true;
});

const voicePayload = (n = 1) => ({
  segments: Array.from({ length: n }, (_, i) => `blob-${i}`),
  durationMs: 3000, wave: 'w', mime: 'audio/webm', capture: {},
});

/* ── DRAFTS: ONE PER CONVERSATION, AUTO-SAVE IS AN UPSERT ─────────── */

test('saving twice keeps ONE draft per conversation, updating in place', async () => {
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload(1) }, s);
  t += 5000;
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload(1) }, s);

  const all = await s.all();
  assert.equal(all.length, 1, 'continuous auto-save must not pile up rows');
  assert.equal(all[0].id, 'id-1', 'the same row is reused');
  assert.equal(all[0].updatedAt, 1_005_000, 'updatedAt advances with each save');
  assert.equal(all[0].createdAt, 1_000_000, 'createdAt is preserved');
});

test('the voice draft stores a SEGMENT LIST, even with one segment', async () => {
  // The shape that keeps Resume Recording a future addition with no migration.
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload(1) }, s);
  const d = await restoreDraft(CONV, s);
  assert.ok(Array.isArray(d.payload.segments), 'segments must be a list');
  assert.equal(d.payload.segments.length, 1);
});

test('a draft is restored for the conversation it belongs to, and not others', async () => {
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);
  assert.ok(await restoreDraft(CONV, s));
  assert.equal(await restoreDraft('other', s), null);
});

test('explicit delete removes the draft', async () => {
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);
  await deleteDraft(CONV, s);
  assert.equal(await restoreDraft(CONV, s), null);
  assert.deepEqual(await s.all(), []);
});

/* ── SENDING: SUCCESS REMOVES, FAILURE KEEPS ─────────────────────── */

test('a successful send uploads then removes the entry — the thread now owns it', async () => {
  const sent = [];
  registerUploader('voice', async entry => { sent.push(entry); });
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);

  await enqueueDraft(CONV, s);

  assert.equal(sent.length, 1, 'the uploader ran');
  assert.equal(sent[0].kind, 'voice');
  assert.deepEqual(await s.all(), [], 'a sent entry is a removed entry');
});

test('⚠ a FAILED upload keeps the entry for retry — never discarded', async () => {
  // The reliability promise. If this ever deletes on failure, a Voicey is lost
  // the moment the network hiccups, which is exactly the trust break M9f exists
  // to prevent.
  registerUploader('voice', async () => { throw new Error('network down'); });
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);

  await enqueueDraft(CONV, s);

  const all = await s.all();
  assert.equal(all.length, 1, 'the entry survives a failed upload');
  assert.equal(all[0].state, FAILED);
});

test('retry re-sends a failed entry and removes it on success', async () => {
  let attempt = 0;
  registerUploader('voice', async () => { if (++attempt === 1) throw new Error('down'); });
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);

  await enqueueDraft(CONV, s);                       // fails → failed
  assert.equal((await s.all())[0].state, FAILED);

  const failedId = (await s.all())[0].id;
  await retry(failedId, s);                          // succeeds → removed

  assert.deepEqual(await s.all(), [], 'a retried, delivered entry is gone');
  assert.equal(attempt, 2);
});

/* ── OFFLINE ─────────────────────────────────────────────────────── */

test('⚠ Send while offline QUEUES rather than failing, then delivers on reconnect', async () => {
  const sent = [];
  registerUploader('voice', async e => { sent.push(e); });
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);

  navigator.onLine = false;
  await enqueueDraft(CONV, s);                       // no network — must not fail

  let all = await s.all();
  assert.equal(all.length, 1, 'the message is held, not lost');
  assert.equal(all[0].state, QUEUED, 'queued IS the offline state');
  assert.equal(sent.length, 0, 'nothing was uploaded while offline');

  navigator.onLine = true;
  await flush(s);                                    // the reconnect sweep

  assert.equal(sent.length, 1, 'it delivers when connectivity returns');
  assert.deepEqual(await s.all(), []);
});

test('explicit delete removes a queued entry too — delete works in any state', async () => {
  // The one destructive act, and it must reach a message that has already left
  // the draft stage (queued/failed), not only a draft.
  registerUploader('voice', async () => { throw new Error('down'); });
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);
  await enqueueDraft(CONV, s);                        // → failed
  const id = (await s.all())[0].id;

  await remove(id, s);
  assert.deepEqual(await s.all(), [], 'the user can delete a stuck send');
});

test('an unknown kind is kept, not dropped — a registry gap stays visible', async () => {
  await saveDraft({ conversationId: CONV, kind: 'video', payload: { segments: [] } }, s);
  await enqueueDraft(CONV, s);                       // no 'video' uploader registered
  const all = await s.all();
  assert.equal(all.length, 1, 'a message we cannot yet send is still not discarded');
});

test('flush does not double-send the same entry under concurrent calls', async () => {
  let running = 0, maxConcurrent = 0, sent = 0;
  registerUploader('voice', async () => {
    running++; maxConcurrent = Math.max(maxConcurrent, running);
    await Promise.resolve();
    sent++; running--;
  });
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);
  await enqueueDraft(CONV, s);   // enqueue already fires one flush…
  await Promise.all([flush(s), flush(s)]);           // …and two more race it
  assert.equal(sent, 1, 'the guard stops a queued entry uploading twice');
});

/* ── RETENTION ───────────────────────────────────────────────────── */

test('prune sweeps drafts older than 30 days and nothing else', async () => {
  await saveDraft({ conversationId: 'old',  kind: 'voice', payload: voicePayload() }, s);
  t += DRAFT_TTL_MS + 1;                             // age the first past the horizon
  await saveDraft({ conversationId: 'fresh', kind: 'voice', payload: voicePayload() }, s);

  const swept = await pruneAbandoned(s);
  assert.equal(swept, 1);
  assert.equal(await restoreDraft('old', s), null, 'the stale draft is gone');
  assert.ok(await restoreDraft('fresh', s), 'the recent draft is kept');
});

test('⚠ prune never touches a failed entry, however old', async () => {
  registerUploader('voice', async () => { throw new Error('down'); });
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);
  await enqueueDraft(CONV, s);                        // → failed
  t += DRAFT_TTL_MS * 5;                              // age it far past the horizon

  const swept = await pruneAbandoned(s);
  assert.equal(swept, 0);
  assert.equal((await s.all())[0].state, FAILED, 'a send the user asked for is never aged out');
});
