/**
 * AUTH DIAGNOSTICS — regression tests.
 *
 * This module exists to answer ONE question after the owner is unexpectedly
 * signed out of the iOS PWA: did Supabase remove the session (ours to fix) or
 * did iOS evict the storage bucket (not ours, and a completely different fix)?
 *
 * ⚠ THE COST OF A WRONG VERDICT IS HIGHER THAN THE COST OF NO VERDICT. A
 * misclassification does not read as "unknown", it reads as a confident answer
 * — and would send the next round of work at the wrong cause, which is exactly
 * the failure this whole measurement was built to prevent (two hypotheses had
 * already been guessed and disproved before it). So every state it can
 * observe is pinned here, including the two that are easy to conflate.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyStorage, authTokenKey } from './authDiagnostics.js';

// ── THE FOUR STORAGE STATES ──────────────────────────────────────────────

test('token and canary both present is healthy', () => {
  assert.equal(
    classifyStorage({ hasToken: true, hasCanary: true, hasHistory: true, hasMirror: true }),
    'healthy',
  );
});

test('canary survives but the token is gone → Supabase removed the session', () => {
  // The whole point of the canary: a targeted _removeSession() deletes exactly
  // one key, so anything else in the same bucket is still standing.
  assert.equal(
    classifyStorage({ hasToken: false, hasCanary: true, hasHistory: true, hasMirror: true }),
    'session-removed',
  );
});

test('a token with no canary reads as hand-cleared, never as eviction', () => {
  assert.equal(
    classifyStorage({ hasToken: true, hasCanary: false, hasHistory: true, hasMirror: true }),
    'canary-cleared',
  );
});

// ── EVICTION, AND WHY IT NEEDS A WITNESS OUTSIDE localStorage ────────────

test('⚠ localStorage gone but the COOKIE survived → eviction', () => {
  // The load-bearing case. Everything in localStorage is gone, so nothing in
  // localStorage can explain why; the cookie is the only witness, and iOS
  // evicts cookies under a different policy than script-writable storage.
  assert.equal(
    classifyStorage({ hasToken: false, hasCanary: false, hasHistory: false, hasMirror: true }),
    'storage-evicted',
  );
});

test('⚠ eviction is called on the MIRROR, not on surviving history', () => {
  // Regression guard on the bug this replaced. The first version keyed
  // 'storage-evicted' off `hasHistory` — but a real eviction takes the log
  // too, so that branch could never fire for the case it was named after and
  // a genuine wipe silently reported as 'first-run'. The mirror must decide
  // this, and it must decide it even with no history at all (above).
  // With no mirror, an all-gone bucket must NOT claim eviction:
  assert.notEqual(
    classifyStorage({ hasToken: false, hasCanary: false, hasHistory: true, hasMirror: false }),
    'storage-evicted',
  );
});

test('history without a mirror is a partial wipe, not a confident verdict', () => {
  assert.equal(
    classifyStorage({ hasToken: false, hasCanary: false, hasHistory: true, hasMirror: false }),
    'storage-partial-wipe',
  );
});

// ── THE CONFLATION THIS MUST NOT MAKE ────────────────────────────────────

test('⚠ a never-signed-in device is first-run, NOT a phantom eviction', () => {
  // Empty storage on a fresh device is byte-for-byte identical to a fully
  // evicted one. Without the mirror there is genuinely no way to tell, and the
  // honest answer is the benign one — otherwise EVERY new device would report
  // being wiped and the signal would be worthless the day it started being read.
  assert.equal(
    classifyStorage({ hasToken: false, hasCanary: false, hasHistory: false, hasMirror: false }),
    'first-run',
  );

  // Mutation-check: flipping only the mirror must change the verdict. If both
  // returned the same string, the test above would still pass with the entire
  // mirror branch deleted.
  assert.notEqual(
    classifyStorage({ hasToken: false, hasCanary: false, hasHistory: false, hasMirror: false }),
    classifyStorage({ hasToken: false, hasCanary: false, hasHistory: false, hasMirror: true }),
  );
});

// ── THE KEY IT WATCHES ───────────────────────────────────────────────────

test('the auth key is derived from the project ref, matching GoTrue', () => {
  // If this drifts from the key auth-js actually writes, the canary watches a
  // key that is never populated and reports an eviction on every single boot.
  assert.equal(
    authTokenKey('https://abcdefghijk.supabase.co'),
    'sb-abcdefghijk-auth-token',
  );
});

test('an unusable project URL yields no key rather than a wrong one', () => {
  // Guarding this matters because the failure is silent: a malformed key still
  // reads cleanly from localStorage, it just always returns null.
  for (const bad of [undefined, null, '', 'not a url']) {
    assert.equal(authTokenKey(bad), null);
  }
});
