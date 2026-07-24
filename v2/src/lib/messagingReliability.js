/**
 * MESSAGING RELIABILITY — the runtime that keeps the Outbox delivering.
 *
 * Called once from App. It teaches the Outbox how to send each kind, then makes
 * two promises hold without the user thinking about them:
 *
 *   · a message queued while offline delivers itself the moment reception
 *     returns — the `online` event runs a flush;
 *   · a message queued in a previous session (the tab was closed, the browser
 *     updated, the battery died mid-send) delivers on the next app open, and
 *     stale drafts are swept then too.
 *
 * This is the festival promise made real: record a Voicey with no signal, press
 * Send, pocket the phone, and it goes when the bars come back — the same as
 * text, because now everything shares one path.
 */

import { flush, pruneAbandoned } from './outbox';
import { registerMessageUploaders } from './outboxUploaders';

let started = false;

/** Idempotent — StrictMode double-invokes effects, and this must run once. */
export function startMessaging() {
  if (started) return;
  started = true;

  registerMessageUploaders();

  try {
    // Reception returned. Deliver everything that was waiting. The flush is
    // self-guarding, so a flurry of online/offline flaps cannot double-send.
    window.addEventListener('online', () => { void flush(); });
  } catch { /* no window (SSR/tests) — nothing to bind */ }

  // App open: clear drafts nobody came back to, then try to deliver anything a
  // previous session left queued or failed. Both are fire-and-forget; a failure
  // here must never delay the app starting.
  void pruneAbandoned();
  void flush();
}

/** Test seam. */
export function __resetMessagingStarted() { started = false; }
