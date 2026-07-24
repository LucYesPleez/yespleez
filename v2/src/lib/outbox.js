/**
 * THE OUTBOX — one durable lifecycle for every message a user creates.
 *
 * This is the operations layer: it turns the pure transitions in outboxMachine
 * into async actions over a store, and it is the ONLY place the app touches the
 * outbox. It is kind-agnostic by construction — it reads the envelope, never the
 * payload, and delegates the actual upload to a registry keyed by kind. A future
 * photo or document ships a payload shape and an uploader and inherits drafts,
 * retry and offline with no change here.
 *
 * See docs/messaging-outbox-2026-07.md.
 *
 * ── THE TWO RULES THIS FILE ENFORCES ─────────────────────────────────
 *
 *   1. User-created content is never silently discarded.
 *   2. Once a message reaches Draft it is durable — only explicit user intent
 *      (Delete, or a confirmed Send) may remove it.
 *
 * Every removal below is one of exactly those two: a successful send, or a
 * delete the user asked for. Nothing else deletes.
 */

import { indexedDbStore } from './outboxStore';
import {
  decideTransition, needsUpload, isAbandoned, SENT, DRAFT, DRAFT_TTL_MS,
} from './outboxMachine';

/** Timestamp seam — overridable in tests so ageing is deterministic. */
let clock = () => Date.now();
export function __setOutboxClock(fn) { clock = fn || (() => Date.now()); }

/** Id seam — overridable so a test can assert a stable id. */
let makeId = () => (globalThis.crypto?.randomUUID?.() ?? `ob_${clock()}_${Math.random().toString(16).slice(2)}`);
export function __setOutboxIdFactory(fn) { makeId = fn; }

/* ── THE UPLOADER REGISTRY ───────────────────────────────────────── */

const uploaders = new Map();

/**
 * Teach the outbox how to send one kind. The uploader receives the whole entry
 * and must throw on failure (a rejection routes the entry to `failed`, kept for
 * retry) and resolve on success (the entry is then removed — the server row is
 * the record from that point).
 */
export function registerUploader(kind, fn) { uploaders.set(kind, fn); }
export function __clearUploaders() { uploaders.clear(); }

/* ── THE DEFAULT STORE ───────────────────────────────────────────── */

let store = null;
/** The process-wide store, created lazily. Tests inject a memoryStore instead. */
export function outboxStore() { return store ?? (store = indexedDbStore()); }
export function __setOutboxStore(s) { store = s; }

/* ── DRAFTS ──────────────────────────────────────────────────────── */

/**
 * Save (or update) the conversation's draft. Continuous auto-save calls this on
 * every change; it is one upsert, not a growing pile, because a conversation has
 * exactly one draft and this reuses its row.
 *
 * ⚠ ENFORCES ONE DRAFT PER CONVERSATION. If a draft already exists it is
 * updated in place (same id, refreshed `updatedAt`); the 30-day broom measures
 * from that timestamp, so an actively edited draft is never stale.
 */
export async function saveDraft({ conversationId, kind, payload }, s = outboxStore()) {
  const now = clock();
  const existing = await s.getDraft(conversationId);
  const entry = {
    id:        existing?.id ?? makeId(),
    conversationId,
    kind,
    state:     DRAFT,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    payload,
  };
  await s.put(entry);
  return entry;
}

/** The conversation's draft for auto-restore, or null. */
export function restoreDraft(conversationId, s = outboxStore()) {
  return s.getDraft(conversationId);
}

/**
 * Remove the conversation's draft. The explicit-delete path, and the one the
 * composer calls when a draft is sent or discarded by the user. A no-op when
 * there is nothing to remove, so callers need not check first.
 */
export async function deleteDraft(conversationId, s = outboxStore()) {
  const draft = await s.getDraft(conversationId);
  if (draft) await s.remove(draft.id);
}

/* ── SENDING ─────────────────────────────────────────────────────── */

/**
 * Move an entry along the lifecycle by one event, persisting the new state.
 * Returns the updated entry, or null when the entry was removed (sent/deleted)
 * or the event did not apply.
 */
async function transition(id, event, s) {
  const entry = await s.get(id);
  if (!entry) return null;
  const next = decideTransition(entry.state, event);
  if (next === null) return entry;          // inert — never a silent drop
  if (next === SENT || next === 'deleted') { await s.remove(id); return null; }
  const updated = { ...entry, state: next, updatedAt: clock() };
  await s.put(updated);
  return updated;
}

/**
 * The user pressed Send. The draft becomes a queued outbox entry and a flush is
 * attempted immediately. If there is no connectivity the entry simply stays
 * queued and a later flush (reconnect, or app open) delivers it — the Send does
 * not fail, it defers, exactly as text does.
 */
export async function enqueueDraft(conversationId, s = outboxStore()) {
  const draft = await s.getDraft(conversationId);
  if (!draft) return null;
  // Persist the queued state FIRST — from this line the message is durable, so
  // whatever the flush does next (deliver, defer offline, or error to failed)
  // the content is already safe. Then attempt delivery. Awaited so the caller
  // knows the immediate outcome; offline simply returns at once, leaving the
  // entry queued for a later sweep.
  const queued = await transition(draft.id, 'send', s);
  await flush(s);
  return queued;
}

/** Retry a failed entry — the manual button and the reconnect sweep share this. */
export async function retry(id, s = outboxStore()) {
  await transition(id, 'retry', s);
  return flush(s);
}

/** Explicit delete of any entry, in any state. The permitted destructive act. */
export async function remove(id, s = outboxStore()) {
  await transition(id, 'delete', s);
}

/* ── THE FLUSH LOOP ──────────────────────────────────────────────── */

let flushing = false;

/**
 * Deliver everything waiting on the network. Idempotent and self-guarding, so
 * the `online` event, an app-open sweep and an enqueue can all call it without
 * racing each other into a double upload.
 *
 * Each entry: mark uploading → run its kind's uploader → remove on success,
 * mark failed on error. A failed entry is KEPT (rule 1); it shows Retry and the
 * next flush picks it up again. An unknown kind is left failed rather than
 * dropped, so a registry gap is visible instead of a lost message.
 */
export async function flush(s = outboxStore()) {
  if (flushing) return;
  flushing = true;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const work = [...(await s.byState('queued')), ...(await s.byState('failed'))];
    for (const entry of work) {
      const uploader = uploaders.get(entry.kind);
      if (!uploader) continue;              // no way to send this kind yet — keep it

      const claimed = await transition(entry.id, 'upload-start', s);
      if (!claimed) continue;

      try {
        await uploader(claimed);
        await transition(entry.id, 'upload-ok', s);   // confirmed → removed
      } catch {
        await transition(entry.id, 'upload-fail', s);  // kept for retry
      }
    }
  } finally {
    flushing = false;
  }
}

/* ── RETENTION ───────────────────────────────────────────────────── */

/**
 * Delete drafts nobody has returned to in 30 days. Only drafts age out — a
 * failed send is content the user asked to deliver and is never pruned. Run on
 * app open. Returns how many were swept, for a log.
 */
export async function pruneAbandoned(s = outboxStore(), ttl = DRAFT_TTL_MS) {
  const now = clock();
  const drafts = await s.byState(DRAFT);
  let swept = 0;
  for (const d of drafts) {
    if (isAbandoned(d, now, ttl)) { await s.remove(d.id); swept++; }
  }
  return swept;
}

export { needsUpload };
