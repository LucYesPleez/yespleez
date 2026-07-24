/**
 * OUTBOX UPLOADERS — the adapters that turn a returned `{ error }` into the
 * throw the Outbox needs, tested on the real flush path.
 *
 * ⚠ THE FAILURE THIS GUARDS: both sendMessage and sendVoiceNote report failure
 * by RETURNING `{ error }`, not by rejecting. An adapter that forgot to convert
 * that into a throw would let the Outbox treat a failed send as delivered and
 * remove the message — the exact silent-discard the whole milestone forbids.
 */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let sendMessageResult;
let sendVoiceResult;
let sentMessageArgs = [];
let sentVoiceArgs = [];

mock.module('./messaging.js', {
  exports: {
    sendMessage: async (args) => { sentMessageArgs.push(args); return sendMessageResult; },
  },
});
mock.module('./voiceNotes.js', {
  exports: {
    sendVoiceNote: async (args) => { sentVoiceArgs.push(args); return sendVoiceResult; },
    VOICE_FALLBACK_BODY: 'Voice message',
  },
});

const { memoryStore } = await import('./outboxStore.js');
const {
  saveDraft, enqueueDraft, __setOutboxClock, __setOutboxIdFactory, __clearUploaders,
} = await import('./outbox.js');
const { registerMessageUploaders, __resetUploadersRegistered } = await import('./outboxUploaders.js');
const { FAILED } = await import('./outboxMachine.js');

let s, t, idSeq;

beforeEach(() => {
  s = memoryStore();
  t = 1_000_000; idSeq = 0;
  __setOutboxClock(() => t);
  __setOutboxIdFactory(() => `id-${++idSeq}`);
  __clearUploaders();
  __resetUploadersRegistered();
  registerMessageUploaders();
  sentMessageArgs = []; sentVoiceArgs = [];
  sendMessageResult = { message: { id: 'row-1' }, error: null };
  sendVoiceResult   = { message: { id: 'row-2' }, error: null };
  if (typeof navigator === 'undefined') globalThis.navigator = {};
  navigator.onLine = true;
});

test('TEXT is a full Outbox tenant — it sends through the same lifecycle, no bypass', async () => {
  await saveDraft({ conversationId: 'c', kind: 'text', payload: { body: 'hi', fromProfileId: 'p1' } }, s);
  await enqueueDraft('c', s);

  assert.equal(sentMessageArgs.length, 1, 'the text uploader ran');
  assert.deepEqual(sentMessageArgs[0], { conversationId: 'c', fromProfileId: 'p1', body: 'hi' });
  assert.deepEqual(await s.all(), [], 'delivered → removed');
});

test('VOICE sends segments[0] with its record-time wave, and delivers', async () => {
  await saveDraft({ conversationId: 'c', kind: 'voice', payload: {
    segments: ['the-blob'], durationMs: 4200, wave: 'w', capture: { mime: 'audio/webm' }, fromProfileId: 'p1',
  } }, s);
  await enqueueDraft('c', s);

  assert.equal(sentVoiceArgs.length, 1);
  assert.equal(sentVoiceArgs[0].blob, 'the-blob', 'the single segment is the blob');
  assert.equal(sentVoiceArgs[0].wave, 'w', 'the stored wave is reused, never re-decoded');
  assert.equal(sentVoiceArgs[0].fromProfileId, 'p1', 'attribution travels on the entry');
  assert.deepEqual(await s.all(), []);
});

test('⚠ a returned error becomes a FAILED entry, not a delivered one', async () => {
  sendMessageResult = { message: null, error: { message: 'rls denied' } };
  await saveDraft({ conversationId: 'c', kind: 'text', payload: { body: 'hi', fromProfileId: 'p1' } }, s);
  await enqueueDraft('c', s);

  const all = await s.all();
  assert.equal(all.length, 1, 'the message survives a returned error');
  assert.equal(all[0].state, FAILED, 'a returned {error} must convert to a throw → failed, never a silent drop');
});

test('a voice draft with no audio fails rather than sending an empty note', async () => {
  await saveDraft({ conversationId: 'c', kind: 'voice', payload: { segments: [], fromProfileId: 'p1' } }, s);
  await enqueueDraft('c', s);
  assert.equal(sentVoiceArgs.length, 0, 'nothing was sent');
  assert.equal((await s.all())[0].state, FAILED);
});
