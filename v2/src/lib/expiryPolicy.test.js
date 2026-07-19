/**
 * N4 · EVERY NOTIFICATION TYPE HAS A DELIBERATE EXPIRY POSITION.
 *
 * Expiry is per-type by rule: `N4` requires time-sensitivity to be a property
 * of the message, never a global age. That makes the policy table
 * (20260720000002_n4_held_expiry.sql) a registry that must stay in step with
 * TYPE_META, the registry the UI renders from.
 *
 * The drift is silent in the dangerous direction. A type added to TYPE_META
 * with no policy row is simply never expired — no error, no warning — so held
 * applications for gigs played months ago would sit waiting to be delivered on
 * claim, which is the exact outcome `N4` exists to prevent. Nothing else in
 * the system would notice.
 *
 * So a new type must be classified, or explicitly listed below as retained on
 * purpose. Both are fine; silence is not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE      = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, '../../../supabase/migrations/20260720000002_n4_held_expiry.sql');
const NOTIF_META = join(HERE, 'notifMeta.jsx');

/**
 * Types deliberately left unclassified, and therefore RETAINED indefinitely.
 *
 * Retention is the safe default (see the migration header): a wrongly-kept
 * notification can be expired later, a wrongly-expired one is gone. Each entry
 * needs a reason — this list is a set of decisions, not a suppression file.
 */
const DELIBERATELY_RETAINED = {
  generic:        'no semantics to reason about — a catch-all cannot carry a time-sensitivity rule',
  new_message:    'messaging is not built; conversations are not event-bound and holding one costs nothing',
  artist_updated: 'a profile change is not time-bound and does not name a date',
  festival_opened:'announcement, not an opportunity with a deadline; carries no event_id today',
};

function policyTypes() {
  const sql = readFileSync(MIGRATION, 'utf8');
  const block = sql.slice(sql.indexOf('INSERT INTO public.notification_expiry_policy'));
  return new Map(
    [...block.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'(never|event|enquiry)'/g)]
      .map(m => [m[1], m[2]]),
  );
}

function registryTypes() {
  const src = readFileSync(NOTIF_META, 'utf8');
  const block = src.slice(src.indexOf('export const TYPE_META'));
  return [...block.matchAll(/^\s{2}([a-z_]+)\s*:\s*\{/gm)].map(m => m[1]);
}

test('every notification type is either classified for expiry or deliberately retained', () => {
  const policy = policyTypes();
  const unaccounted = registryTypes()
    .filter(t => !policy.has(t) && !(t in DELIBERATELY_RETAINED));

  assert.deepEqual(
    unaccounted, [],
    'These notification types have no expiry policy and are not listed as ' +
    'deliberately retained, so they would never expire and nothing would say so:\n  ' +
    unaccounted.join('\n  ') +
    '\n\nClassify them in supabase/migrations/20260720000002_n4_held_expiry.sql, ' +
    'or add them to DELIBERATELY_RETAINED here with a reason.',
  );
});

test('enduring social relationships never expire (N4)', () => {
  const policy = policyTypes();

  // `N4`: "Not time-bound. 'Twelve people follow you' is as true in six months,
  // and is pure claim incentive." These are the rows that make `N3`'s claim
  // moment worth anything — expiring them would quietly defeat it.
  for (const type of ['new_follower', 'venue_followed']) {
    assert.equal(policy.get(type), 'never', `${type} must never expire — it is the claim incentive`);
  }
});

test('opportunities that name a date are event- or enquiry-bound (N4)', () => {
  const policy = policyTypes();

  // `N4`: "An application delivered after the gig is worse than none."
  for (const type of ['new_application', 'shortlisted', 'slot_offer', 'event_invite']) {
    assert.equal(policy.get(type), 'event', `${type} must expire with its event`);
  }
  assert.equal(policy.get('availability_request'), 'enquiry', 'an enquiry expires on its own date');
});

test('the policy parser actually found the policy', () => {
  // Both assertions above pass vacuously if the regex stops matching — e.g.
  // after the INSERT is reformatted. Fail loudly instead.
  const policy = policyTypes();
  assert.ok(policy.size >= 20, `expected the full policy table, parsed ${policy.size} entries`);
  assert.ok(registryTypes().length >= 25, 'expected to parse TYPE_META');
});

test('expiry never touches delivered notifications', () => {
  // The invariant with the worst failure mode: a false positive deletes
  // somebody's mail. Asserted against the SQL because that is where it lives —
  // both statements that write to notifications must filter on held-ness.
  const sql = readFileSync(MIGRATION, 'utf8');
  const sweep = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.expire_held_notifications'));
  const body = sweep.slice(0, sweep.indexOf('$$;'));

  assert.match(body, /to_user_id IS NULL/,
    'the expiry sweep must restrict itself to held rows — delivered mail is retention, not expiry');
  assert.ok(!/to_user_id IS NOT NULL/.test(body),
    'the expiry sweep must never select delivered rows');
});

test('claim delivery skips expired rows (N3 × N4)', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const deliver = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.deliver_held_notifications'));
  const body = deliver.slice(0, deliver.indexOf('$$;'));

  assert.match(body, /expired_at IS NULL/,
    'delivery must skip expired rows, or a claim hands over gigs already played');
});
