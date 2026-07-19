/**
 * N3 · CLAIM DELIVERY — the assumption the database migration rests on.
 *
 * Delivery is a trigger on profiles.user_id transitioning NULL → NOT NULL
 * (20260720000001_n3_claim_delivery.sql). That trigger runs with INVOKER
 * rights, which is correct ONLY while claims are completed in the SQL editor
 * by a privileged role that RLS does not constrain.
 *
 * The moment an ordinary authenticated user can complete a claim from the app,
 * that stops being true: a held row has to_user_id IS NULL, so an RLS UPDATE
 * policy scoped to `to_user_id = auth.uid()` cannot match it, and delivery
 * fails SILENTLY — the claim succeeds, the held pile stays invisible, and
 * nothing errors.
 *
 * That is a landmine with a long fuse: the code that steps on it (a claim
 * button) is nowhere near the code that breaks (a database trigger), and the
 * symptom is an absence. So the precondition is asserted here rather than left
 * as a comment in a .sql file nobody re-reads.
 *
 * If this test fails, the migration's "INVOKER RIGHTS" note has come due:
 * revisit SECURITY DEFINER before shipping the claim path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { out.push(...sourceFiles(full)); continue; }
    if (/\.(jsx?|mjs)$/.test(entry) && !/\.test\.jsx?$/.test(entry)) out.push(full);
  }
  return out;
}

test('no app code completes a claim by writing profiles.user_id', () => {
  const offenders = [];
  const marker = /\.from\(\s*['"]profiles['"]\s*\)/g;

  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    let m;
    while ((m = marker.exec(source)) !== null) {
      const chain = source.slice(m.index, m.index + 400);
      if (!/\buser_id\s*:/.test(chain)) continue;

      // The trigger fires only on user_id transitioning NULL → NOT NULL on an
      // EXISTING row, so only .update() can complete a claim.
      //
      // An .upsert() keyed on user_id is self-owned creation, not a claim:
      // MySceneScreen writes the signed-in user's own punter profile with
      // onConflict 'user_id,type'. Its INSERT branch does not fire an UPDATE
      // trigger at all, and on its UPDATE branch OLD.user_id equals
      // NEW.user_id — it is the conflict key — so the NULL guard is false.
      // Flagging it would train the next reader to ignore this test.
      const selfKeyedUpsert = /\.upsert\(/.test(chain) && /onConflict\s*:\s*['"][^'"]*user_id/.test(chain);
      if (selfKeyedUpsert) continue;

      if (/\.update\(/.test(chain)) {
        offenders.push(`${relative(SRC, file)} — ${chain.split('\n')[0].trim()}`);
      }
    }
  }

  assert.deepEqual(
    offenders, [],
    'Claim completion appears to have moved into the app:\n  ' + offenders.join('\n  ') +
    '\n\nN3 delivery is a database trigger running with INVOKER rights, which cannot ' +
    'update held rows (to_user_id IS NULL) under an RLS policy scoped to auth.uid(). ' +
    'Delivery would fail silently. Revisit SECURITY DEFINER in ' +
    'supabase/migrations/20260720000001_n3_claim_delivery.sql before shipping this.',
  );
});

test('the claim path is still the manual review route', () => {
  // Pairs with the assertion above: it passes trivially if ClaimDialog were
  // deleted or rewritten, so confirm the manual route is what actually ships.
  const dialog = readFileSync(join(SRC, 'components/ClaimDialog.jsx'), 'utf8');

  assert.match(dialog, /claims@yespleez\.com/, 'the claim route should still be manual review');
  assert.ok(
    !/\.from\(\s*['"]profiles['"]\s*\)[\s\S]{0,200}\.update\(/.test(dialog),
    'ClaimDialog must not complete a claim directly',
  );
});
