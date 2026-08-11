import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ⚠⚠ SEC-1 / SEC-2 — THE POLICIES THAT STOP ANONYMOUS CLIENTS READING
 * UNPUBLISHED EVENTS, UNANNOUNCED LINEUPS AND PENDING OFFERS.
 *
 * Measured 2026-08-11 against the live database with the publishable key and
 * no session: anon received 78/78 events, 149/149 lineup_members and 64/64
 * performances — byte-identical to the service role. RLS filtered nothing.
 *
 * ⛔ THE CAUSE WAS TWO PERMISSIVE POLICIES ON ONE TABLE. Postgres ORs them, so
 * `USING (true)` beside `USING (status = 'live')` means the narrow one never
 * mattered. These tests exist mainly to stop a broad policy reappearing.
 *
 * ⚠ SOURCE-LEVEL ONLY. These assert what the migrations DECLARE. They cannot
 * prove what the database RETURNS — that needs the live three-identity check
 * (anon · authenticated non-owner · owner) re-run after applying.
 */

const sqlOf = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');

const SEC1 = sqlOf('../../../../supabase/migrations/20260811000001_sec1_event_draft_visibility.sql');
const SEC2 = sqlOf('../../../../supabase/migrations/20260811000002_sec2_lineup_and_settime_visibility.sql');
const ALL  = SEC1 + '\n' + SEC2;

// ── The broad policies are gone ─────────────────────────────────────────────

test('SEC-1 drops BOTH old event SELECT policies', () => {
  assert.match(SEC1, /drop policy if exists "public read events"\s+on public\.events/);
  assert.match(SEC1, /drop policy if exists "public read live events" on public\.events/,
    'the narrow policy is left behind — harmless, but it is the decoration that hid the bug');
});

test('SEC-2 drops both `Anyone can read` policies', () => {
  assert.match(SEC2, /drop policy if exists "Anyone can read lineup_members"/);
  assert.match(SEC2, /drop policy if exists "Anyone can read performances"/);
});

/**
 * ⛔ THE REGRESSION THAT MATTERS MOST. A single `USING (true)` anywhere in
 * these files re-opens everything, because permissive policies are OR'd.
 */
test('⛔ no policy created here is unconditional', () => {
  assert.doesNotMatch(ALL, /for select using \(\s*true\s*\)/i,
    'a USING (true) SELECT policy is back — that is the whole bug');
});

// ── Anonymous sees published data only ──────────────────────────────────────

test('anon can still read LIVE events (public pages must not break)', () => {
  assert.match(SEC1, /status = 'live'/);
});

test('drafts are reachable only through an ownership arm', () => {
  const body = SEC1.slice(SEC1.indexOf('create policy'));
  assert.match(body, /host_id = auth\.uid\(\)/);
  assert.match(body, /owner_profile_id in \(\s*select id from public\.profiles where user_id = auth\.uid\(\)/);
  // ⛔ Nothing may make status irrelevant.
  assert.doesNotMatch(body, /or\s+true/i);
});

/**
 * ⭐ 73 of 78 events have `host_id = NULL` (Studio imports have no author) and
 * 36 have no `owner_profile_id`. Without the owner-profile arm the host
 * dashboard loses authored events; without `status = 'live'` the public
 * catalogue disappears. Both arms are load bearing.
 */
test('the owner arm keys on the PROFILE, not only the account', () => {
  assert.match(SEC1, /owner_profile_id in/,
    'venue- and festival-owned events have no host_id and would vanish');
});

// ── An offer is not an announcement ─────────────────────────────────────────

/**
 * ⭐⭐ Only `accepted` slots on a live event are public. ⛔ `offered`, `draft`
 * and `declined` must never reach the public arm — "we asked this artist" is
 * not public until they answer, and a decline is a private no.
 */
test('the public arm admits ONLY accepted slots on live events', () => {
  assert.match(SEC2, /performances\.status = 'accepted'\s*\n?\s*and exists \(/,
    'the public can see set times that are not confirmed');
  const publicArm = SEC2.slice(SEC2.indexOf("performances.status = 'accepted'"));
  assert.match(publicArm, /e\.status = 'live'/,
    'confirmed slots on UNPUBLISHED events would be public');
});

test('⛔ no status other than accepted is ever made public', () => {
  assert.doesNotMatch(SEC2, /status (=|in) .*'offered'/,
    'a pending invitation is being exposed');
  assert.doesNotMatch(SEC2, /status (=|in) .*'declined'/,
    'a refusal is being exposed');
});

/**
 * ⚠⚠ LOAD BEARING. `acceptSlotOffer` (lib/notifActions.js) SELECTs the
 * performance row before updating it. An act that cannot read its own
 * `offered` row cannot accept it — removing this arm breaks accepting a slot
 * with no error message.
 */
test('the act can always read its OWN slot, whatever its status', () => {
  const own = SEC2.slice(SEC2.indexOf('create policy "read confirmed set times'));
  const firstArm = own.slice(0, own.indexOf('or exists'));
  assert.match(firstArm, /lineup_members m/);
  assert.match(firstArm, /m\.artist_id = auth\.uid\(\)/);
  assert.match(firstArm, /m\.artist_profile_id in/);
  assert.doesNotMatch(firstArm, /status/,
    "the act's own arm is filtered by status — they could not see the offer to accept it");
});

test('a booked act still sees its own lineup row on an unpublished event', () => {
  const lm = SEC2.slice(SEC2.indexOf('create policy "read lineup'), SEC2.indexOf('create policy "read confirmed'));
  assert.match(lm, /lineup_members\.artist_id = auth\.uid\(\)/);
  assert.match(lm, /lineup_members\.artist_profile_id in/);
});

// ── Writes are untouched ────────────────────────────────────────────────────

/**
 * ⛔ This is a READ fix. A migration that quietly altered write access would be
 * a far worse bug than the one it closes.
 */
test('⛔ no write policy is created, dropped or altered', () => {
  assert.doesNotMatch(ALL, /for (insert|update|delete)/i, 'a write policy is being changed');
  assert.doesNotMatch(ALL, /with check/i, 'a WITH CHECK clause implies a write policy');
  assert.doesNotMatch(ALL, /drop policy[^\n]*(manage|insert|update|delete)/i,
    'a write policy is being dropped');
  const drops = ALL.match(/drop policy/g) || [];
  assert.equal(drops.length, 4, 'exactly four SELECT policies should be dropped');
});

test('every policy created is FOR SELECT', () => {
  const creates = ALL.match(/create policy[\s\S]*?for select/gi) || [];
  const allCreates = ALL.match(/create policy/gi) || [];
  assert.equal(creates.length, allCreates.length, 'a created policy is not scoped to SELECT');
  assert.equal(allCreates.length, 3, 'expected exactly three new policies');
});

/**
 * ⚠ `CREATE POLICY` has no `IF NOT EXISTS`, and the Supabase SQL editor runs
 * the whole script as ONE transaction — so a re-run without the guards aborts
 * the lot and leaves the table with NO select policy.
 */
test('every drop is guarded so the script is re-runnable', () => {
  const drops = ALL.match(/drop policy[^;]*/g) || [];
  drops.forEach(d => assert.match(d, /if exists/, `unguarded drop: ${d.slice(0, 60)}`));
});

test('SEC-2 states its dependency on SEC-1', () => {
  const raw = readFileSync(fileURLToPath(new URL(
    '../../../../supabase/migrations/20260811000002_sec2_lineup_and_settime_visibility.sql',
    import.meta.url)), 'utf8');
  assert.match(raw, /APPLY SEC-1 FIRST/,
    'the ordering dependency is not written down where it will be read');
});
