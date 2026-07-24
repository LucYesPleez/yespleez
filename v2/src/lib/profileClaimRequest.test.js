/**
 * C1 · PROFILE CLAIM SUBMISSION — regression tests.
 *
 * Exercises the REAL profileClaimRequest.js with only the Supabase client
 * stubbed — same approach as messaging.test.js and analytics.test.js.
 *
 * What they lock down, in order of how expensive the bug would be:
 *
 *   1. Submission NEVER touches `profiles`. Completion is the reviewer-only
 *      approve function; the moment a client write to profiles appears here,
 *      the N3 delivery invariant (claimDelivery.test.js) is in danger.
 *   2. The JS relationship list matches the migration's CHECK. Drift means a
 *      real owner's claim is rejected by Postgres at the exact moment they
 *      try to claim their page — the worst possible first impression.
 *   3. The insert keeps its `.select()` AND the migration keeps the
 *      select-own policy it depends on (INSERT ... RETURNING is governed by
 *      the SELECT policy — the beta_feedback lesson, pinned from both sides).
 *   4. The claimant is the session, never a parameter.
 */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE      = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, '../../../supabase/migrations/20260724000003_c1_profile_claim_requests.sql');

const USER    = '22222222-2222-2222-2222-222222222222';
const OTHER   = '99999999-9999-9999-9999-999999999999';
const PROFILE = '11111111-1111-1111-1111-111111111111';

let inserted = [];
let queries = [];
let sessionUser = { id: USER, email: 'me@example.com' };
let insertError = null;
// What a `profiles` SELECT resolves to — drives ownsProfileOfType. Default:
// the account owns nothing, so the pre-check never blocks.
let ownsRows = [];

mock.module('./supabase', {
  exports: {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: sessionUser }, error: null }),
      },
      from(table) {
        const q = {
          table,
          selectCalled: false,
          eqs: [],
          insert(row) { inserted.push({ table, row }); q.row = row; return q; },
          select(cols) { q.selectCalled = true; q.cols = cols; return q; },
          eq(col, val) { q.eqs.push([col, val]); return q; },
          order() { return q; },
          limit() { return q; },
          single: async () => (insertError
            ? { data: null, error: insertError }
            : { data: { id: 42, status: 'pending', created_at: '2026-07-24' }, error: null }),
          // ownsProfileOfType awaits a `profiles` select; every other awaited
          // query (fetchMyClaimRequest) is on profile_claim_requests.
          then(resolve) { resolve({ data: table === 'profiles' ? ownsRows : [], error: null }); },
        };
        queries.push(q);
        return q;
      },
    },
  },
});

const { submitClaimRequest, fetchMyClaimRequest, CLAIM_RELATIONSHIPS } =
  await import('./profileClaimRequest.js');

beforeEach(() => {
  inserted = [];
  queries = [];
  sessionUser = { id: USER, email: 'me@example.com' };
  insertError = null;
  ownsRows = [];
});

/* ---- 1 · submission never touches profiles ---- */

test('a submission writes profile_claim_requests and nothing else', async () => {
  const { request, error } = await submitClaimRequest({
    profileId: PROFILE, relationship: 'owner', evidence: 'https://example.com',
  });
  assert.equal(error, null);
  assert.equal(request.id, 42);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].table, 'profile_claim_requests');
  const profileWrites = inserted.filter(i => i.table === 'profiles');
  assert.equal(profileWrites.length, 0,
    'submission must never write profiles — completion is approve_profile_claim(), ' +
    'reviewer-only, where the N3 held-notification trigger fires');
});

test('a claim is blocked when the account already owns that type (no doomed row)', async () => {
  // profiles enforces UNIQUE (user_id, type); such a claim could never be
  // approved, so it must not be created and flip the profile to public
  // "under review" only to be rejected. The DB guard is the final backstop;
  // this is the legible gate in front of it.
  ownsRows = [{ id: 'existing-artist' }];
  const { request, error } = await submitClaimRequest({
    profileId: PROFILE, profileType: 'artist', relationship: 'owner', evidence: 'https://example.com',
  });
  assert.equal(request, null);
  assert.match(error.message, /already have a profile of this type|duplicate/i);
  assert.equal(inserted.length, 0, 'no claim row may be created for a claim that can never be approved');
});

test('the pre-check is skipped when profileType is not supplied (DB still backstops)', async () => {
  // Older callers may omit profileType; the gate is best-effort and must not
  // silently fail closed. It proceeds to insert; the database guard remains.
  ownsRows = [{ id: 'existing-artist' }];   // would block IF the type were known
  const { request, error } = await submitClaimRequest({
    profileId: PROFILE, relationship: 'owner', evidence: 'proof',
  });
  assert.equal(error, null);
  assert.equal(request.id, 42);
});

test('the claimant is the session user, never a parameter', async () => {
  await submitClaimRequest({
    profileId: PROFILE, relationship: 'owner', evidence: 'proof',
    userId: OTHER, user_id: OTHER,   // must be ignored — the params do not exist
  });
  assert.equal(inserted[0].row.user_id, USER);
});

test('signed out is refused before the network', async () => {
  sessionUser = null;
  const { request, error } = await submitClaimRequest({
    profileId: PROFILE, relationship: 'owner', evidence: 'proof',
  });
  assert.equal(request, null);
  assert.match(error.message, /account/i);
  assert.equal(inserted.length, 0);
});

/* ---- 2 · the JS ↔ SQL relationship contract ---- */

function migrationCheckValues(column) {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf(`CHECK (${column} IN`);
  assert.notEqual(start, -1, `no CHECK (${column} IN …) in the C1 migration`);
  const end = sql.indexOf('))', start);
  return [...sql.slice(start, end).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
}

test('every relationship the dialog offers is accepted by the migration CHECK', () => {
  const allowed = migrationCheckValues('relationship');
  for (const r of CLAIM_RELATIONSHIPS) {
    assert.ok(allowed.includes(r.value),
      `'${r.value}' is offered in the UI but the CHECK refuses it — a real owner's ` +
      'claim would fail at the moment of submission');
  }
});

test('the migration CHECK offers no relationship the dialog does not', () => {
  const allowed = migrationCheckValues('relationship');
  const known = CLAIM_RELATIONSHIPS.map(r => r.value);
  for (const v of allowed) {
    assert.ok(known.includes(v), `migration allows '${v}' but the UI cannot produce it`);
  }
});

test('an unknown relationship and blank evidence are refused before the network', async () => {
  const bad1 = await submitClaimRequest({ profileId: PROFILE, relationship: 'fan', evidence: 'x' });
  assert.match(bad1.error.message, /connected/i);
  const bad2 = await submitClaimRequest({ profileId: PROFILE, relationship: 'owner', evidence: '   ' });
  assert.match(bad2.error.message, /evidence/i);
  assert.equal(inserted.length, 0);
});

/* ---- 3 · INSERT ... RETURNING, pinned from both sides ---- */

test('the insert keeps .select() and the migration keeps the policy it depends on', async () => {
  await submitClaimRequest({ profileId: PROFILE, relationship: 'owner', evidence: 'proof' });
  const q = queries.find(x => x.table === 'profile_claim_requests');
  assert.equal(q.selectCalled, true,
    'the dialog shows the submitted state from the returned row — RETURNING is required here');

  const sql = readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /claim requests select own/,
    'INSERT ... RETURNING is governed by the SELECT policy; removing it breaks every ' +
    'submission with an RLS error (the beta_feedback lesson)');
});

/* ---- 4 · refusals read as sentences ---- */

test('a duplicate live claim maps 23505 to a human sentence', async () => {
  insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
  const { error } = await submitClaimRequest({ profileId: PROFILE, relationship: 'owner', evidence: 'proof' });
  assert.match(error.message, /already have a claim under review/i);
});

test('losing the race to another claimant maps 42501 to a human sentence', async () => {
  insertError = { code: '42501', message: 'new row violates row-level security policy' };
  const { error } = await submitClaimRequest({ profileId: PROFILE, relationship: 'owner', evidence: 'proof' });
  assert.match(error.message, /no longer be claimed/i);
});

/* ---- fetchMyClaimRequest ---- */

test('my-request lookup is scoped to the session user and this profile', async () => {
  await fetchMyClaimRequest(PROFILE);
  const q = queries.find(x => x.table === 'profile_claim_requests');
  assert.deepEqual(q.eqs, [['profile_id', PROFILE], ['user_id', USER]]);
});

test('signed out, the lookup answers null without touching the network', async () => {
  sessionUser = null;
  const { request, error } = await fetchMyClaimRequest(PROFILE);
  assert.equal(request, null);
  assert.equal(error, null);
  assert.equal(queries.length, 0);
});
