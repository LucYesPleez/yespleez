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
  __setOutboxClock, __setOutboxIdFactory, __setOutboxTimers,
} from './outbox.js';
import { QUEUED, FAILED, DRAFT_TTL_MS, RETRY_DELAYS_MS, MAX_ATTEMPTS } from './outboxMachine.js';

const CONV = 'conv-1';
let s;
let t;         // controllable clock
let idSeq;
/** Every backoff timer the outbox armed this test, as {ms, fire}. */
let timers;

beforeEach(() => {
  s = memoryStore();
  t = 1_000_000;
  idSeq = 0;
  timers = [];
  __setOutboxClock(() => t);
  __setOutboxIdFactory(() => `id-${++idSeq}`);
  // Captured rather than run: the ladder reaches five minutes, and a test that
  // waited for it would be a test nobody runs.
  __setOutboxTimers(
    (fn, ms) => { const h = { ms, fire: fn }; timers.push(h); return h; },
    (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
  );
  __clearUploaders();
  if (typeof navigator === 'undefined') globalThis.navigator = {};
  navigator.onLine = true;
});

/** The timer the outbox is currently waiting on, if any. */
const pendingTimer = () => timers[timers.length - 1];

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

/* ── FAILED MESSAGES: A LADDER WITH AN END, AND TWO WAYS OUT ──────────
 *
 * ⚠ WHAT THIS REPLACES: every flush re-attempted every failed entry, with no
 * ceiling and no spacing, so a send that could not succeed was retried forever
 * on every send, reconnect and app open. The acceptance criterion for this
 * milestone is the negative one — failed messages must NOT retry forever.
 */

/** Fail `failTimes` attempts, then succeed. Returns the attempt counter. */
function flakyUploader(failTimes) {
  const calls = { n: 0 };
  registerUploader('voice', async () => {
    calls.n++;
    if (calls.n <= failTimes) throw new Error('network down');
    return { id: `row-${calls.n}` };
  });
  return calls;
}

test('⚠ an automatic retry that SUCCEEDS removes the entry', async () => {
  // The latent bug this milestone fixed: `upload-start` and `upload-ok` are only
  // defined on QUEUED, so a failed entry picked up by flush uploaded while still
  // marked failed and was then never removed. The message was delivered and the
  // bubble stayed on screen as a failure — being re-sent by every later flush.
  const calls = flakyUploader(1);
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);
  await enqueueDraft(CONV, s);
  assert.equal((await s.all())[0].state, FAILED, 'first attempt failed');

  t += RETRY_DELAYS_MS[1];
  await flush(s);

  assert.equal(calls.n, 2, 'the automatic retry ran');
  assert.deepEqual(await s.all(), [], 'and delivery CLEARED it — no permanent failed bubble');
});

test('a failed entry is not retried before its backoff has elapsed', async () => {
  const calls = flakyUploader(99);
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);
  await enqueueDraft(CONV, s);
  assert.equal(calls.n, 1);

  await flush(s);                       // same instant — far too early
  assert.equal(calls.n, 1, 'a flush inside the wait must not attempt anything');

  t += RETRY_DELAYS_MS[1] - 1;
  await flush(s);
  assert.equal(calls.n, 1, 'still one millisecond short');

  t += 1;
  await flush(s);
  assert.equal(calls.n, 2, 'and goes the moment the rung comes due');
});

test('⚠ automatic retries STOP after the ladder is spent', async () => {
  const calls = flakyUploader(99);
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);
  await enqueueDraft(CONV, s);

  // Walk every rung, jumping the clock far enough that only the ceiling can stop us.
  for (let i = 1; i < MAX_ATTEMPTS + 5; i++) {
    t += 10 * 60 * 1000;
    await flush(s);
  }

  assert.equal(calls.n, MAX_ATTEMPTS,
    `exactly ${MAX_ATTEMPTS} attempts — the whole point is that this number exists`);
  const entry = (await s.all())[0];
  assert.equal(entry.state, FAILED, 'and the message is still here, never discarded');
  assert.equal(entry.attempts, MAX_ATTEMPTS);
});

test('an exhausted entry arms no further timer — nothing will wake it but the user', async () => {
  flakyUploader(99);
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);
  await enqueueDraft(CONV, s);
  assert.ok(pendingTimer(), 'while rungs remain, a sweep is scheduled');

  for (let i = 1; i < MAX_ATTEMPTS; i++) { t += 10 * 60 * 1000; await flush(s); }

  assert.equal(timers.length, 0, 'spent ladder, no timer — otherwise it is still a loop');
});

test('the scheduled sweep waits for the SOONEST entry', async () => {
  flakyUploader(99);
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);
  await enqueueDraft(CONV, s);

  assert.equal(pendingTimer().ms, RETRY_DELAYS_MS[1], 'first rung after the immediate attempt');
});

test('manual Retry works on an exhausted entry and restarts the ladder', async () => {
  const calls = flakyUploader(99);
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);
  await enqueueDraft(CONV, s);
  for (let i = 1; i < MAX_ATTEMPTS; i++) { t += 10 * 60 * 1000; await flush(s); }
  assert.equal(calls.n, MAX_ATTEMPTS, 'ladder spent');

  await retry((await s.all())[0].id, s);

  assert.equal(calls.n, MAX_ATTEMPTS + 1, 'the user asking is always honoured');
  const entry = (await s.all())[0];
  assert.equal(entry.attempts, 1, 'and the schedule starts over from Immediate');
  assert.ok(pendingTimer(), 'so automatic retries resume');
});

test('the automatic sweep does NOT reset the ladder — only the user does', async () => {
  flakyUploader(99);
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);
  await enqueueDraft(CONV, s);
  t += 10 * 60 * 1000;
  await flush(s);

  assert.equal((await s.all())[0].attempts, 2,
    'an automatic attempt advances the ladder; resetting here would loop forever');
});

test('Delete removes a failed message from this device', async () => {
  flakyUploader(99);
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);
  await enqueueDraft(CONV, s);
  const failed = (await s.all())[0];
  assert.equal(failed.state, FAILED);

  await remove(failed.id, s);

  assert.deepEqual(await s.all(), [], 'the dead-end message is gone');
  await flush(s);
  assert.deepEqual(await s.all(), [], 'and stays gone — a deleted send never comes back');
});

test('the entry id — the idempotency key — survives every retry', async () => {
  // Retrying must never mint a new identity, or the client_id that makes a
  // re-send safe at the database would change and duplicate the message.
  flakyUploader(99);
  await saveDraft({ conversationId: CONV, kind: 'voice', payload: voicePayload() }, s);
  await enqueueDraft(CONV, s);
  const first = (await s.all())[0].id;

  t += 10 * 60 * 1000; await flush(s);
  await retry(first, s);

  const all = await s.all();
  assert.equal(all.length, 1, 'one message, not three');
  assert.equal(all[0].id, first, 'and one identity throughout');
});
