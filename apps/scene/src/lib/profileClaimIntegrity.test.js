import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * P3 — AN OWNERLESS PROFILE CAN NEVER BE "CLAIMED".
 *
 * ⭐⭐ WHAT WENT WRONG, so it is not reintroduced: M1 added
 * `claim_status TEXT NOT NULL DEFAULT 'claimed'` and justified it by MEASURING
 * that zero profiles had a null `user_id`. That was true when written. Then
 * ownerless profiles became legitimate — external acts on public lineups — and
 * by 2026-08-29 **142 of 220** rows had `user_id IS NULL`. The measurement
 * silently stopped holding, and 14 profiles on one event were stored as
 * "claimed" with no account, no `claimed_at` and no `claimed_via`.
 *
 * ⭐ THE LESSON THESE TESTS DEFEND: a default justified by a measurement needs
 * that measurement to keep holding. A CONSTRAINT cannot go quietly out of date,
 * so the fix is structural rather than another correct-at-the-time default.
 *
 * ⚠⚠ SOURCE-LEVEL ONLY. These assert what the migration DECLARES. They cannot
 * prove what the database ENFORCES — that needs the live probes run after the
 * migration is applied: an ownerless insert defaulting to `unclaimed`, an
 * attempt to set one `claimed` being REJECTED, and the claimed-with-account
 * rows left untouched. ⛔ Do not read a green suite here as proof the
 * constraint exists.
 */

const sqlOf = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const RAW = sqlOf('../../../../supabase/migrations/20260829000001_p3_claim_status_integrity.sql');
const SQL = RAW.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');

// ── The default ────────────────────────────────────────────────────────────
test('P3 · the default becomes unclaimed', () => {
  assert.match(
    SQL,
    /ALTER COLUMN claim_status SET DEFAULT 'unclaimed'/,
    'a new profile must be unclaimed until somebody owns it',
  );
});

test('P3 · the old default is not restored anywhere in this migration', () => {
  assert.doesNotMatch(
    SQL,
    /SET DEFAULT 'claimed'/,
    "⛔ DEFAULT 'claimed' is the defect; it must not reappear",
  );
});

// ── The correction, and its blast radius ───────────────────────────────────
test('P3 · the UPDATE touches ONLY rows that are both ownerless and claimed', () => {
  const update = SQL.match(/UPDATE public\.profiles[\s\S]*?;/)?.[0] ?? '';
  assert.match(update, /SET claim_status = 'unclaimed'/);
  assert.match(update, /WHERE user_id IS NULL/,
    'without this a real person\'s claim could be undone');
  assert.match(update, /AND claim_status = 'claimed'/,
    'without this, pending and rejected rows would be flattened too');
});

// ── The constraint ─────────────────────────────────────────────────────────
test('P3 · the invariant is a CHECK constraint, not a convention', () => {
  assert.match(
    SQL,
    /ADD CONSTRAINT profiles_claimed_requires_account\s+CHECK \(user_id IS NOT NULL OR claim_status <> 'claimed'\)/,
    'the default only helps an insert that omits the column; the constraint rejects the state however it is reached',
  );
});

test('P3 · the constraint is validated, never NOT VALID', () => {
  assert.doesNotMatch(
    SQL,
    /NOT VALID/,
    '⛔ a NOT VALID constraint is never checked against existing rows and reads as protection that is not there',
  );
});

test('P3 · the UPDATE runs BEFORE the constraint is added', () => {
  // Otherwise the migration fails on the 14 rows it exists to fix.
  assert.ok(
    SQL.indexOf('UPDATE public.profiles') < SQL.indexOf('ADD CONSTRAINT profiles_claimed_requires_account'),
    'the table must be clean before the constraint validates against it',
  );
});

// ── What the constraint must NOT reject ────────────────────────────────────
/**
 * ⭐ The live vocabulary was verified before writing the CHECK: `claimed` (92)
 * and `unclaimed` (128) are the only values in use; `pending` and `rejected`
 * are declared for this vocabulary and currently unused.
 *
 * ⛔ A PENDING CLAIM IS EXACTLY AN OWNERLESS ROW MID-CLAIM. A constraint that
 * rejected it would break the claim flow the first day somebody used it, and
 * `profileClaim.js` already treats pending as still unclaimed.
 */
const permits = (userId, status) => userId !== null || status !== 'claimed';

test('P3 · every legitimate state survives the invariant', () => {
  assert.equal(permits(null, 'unclaimed'), true, 'an external lineup act');
  assert.equal(permits(null, 'pending'),   true, 'a claim under review — must not be rejected');
  assert.equal(permits(null, 'rejected'),  true, 'a refused claim on an unowned row');
  assert.equal(permits('uuid', 'claimed'), true, 'a registered person who claimed their profile');
  assert.equal(permits('uuid', 'pending'), true, 'ownership never depends on the status string');
});

test('P3 · the one forbidden combination is forbidden', () => {
  assert.equal(
    permits(null, 'claimed'), false,
    'an ownerless profile stored as claimed is the defect this migration exists to make impossible',
  );
});

// ── The Studio importer stays correct ──────────────────────────────────────
/**
 * ⚠ Studio inserts acts with `claim_status: 'unclaimed'` EXPLICITLY, which is
 * why 137 imported profiles were never affected by the bad default. The new
 * default agrees with it rather than overriding it, so the importer needs no
 * change — and this test records that, because "we also changed Studio" would
 * be a false memory later.
 */
test('P3 · nothing here overrides an explicitly supplied status', () => {
  assert.doesNotMatch(SQL, /TRIGGER/i, 'no trigger rewrites what a caller supplied');
  assert.doesNotMatch(SQL, /claim_status = 'unclaimed'\s*;/,
    'the UPDATE must stay predicated, never an unconditional rewrite');
});
