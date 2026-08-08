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
import { readFileSync, readdirSync } from 'node:fs';
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

/**
 * ⚠ SCANS EVERY MIGRATION, not just N4's.
 *
 * It read one file until 2026-08-07, which was true only while one migration
 * had ever written to this table. D2 classified two festival types in a later
 * one and this test failed them as unaccounted — correctly complaining, at the
 * wrong thing. A registry that grows across migrations is normal; a test that
 * only knows the first one turns every future classification into a false
 * alarm, and false alarms are how a real one gets waved through.
 *
 * Column ORDER is read from each INSERT rather than assumed: N4 writes
 * `(type, policy)`, D2 writes `(type, category, policy, note)`, and a positional
 * regex would silently read a category as a policy.
 */
/**
 * Split a VALUES tuple on commas that are OUTSIDE quotes.
 *
 * ⚠ A plain `.split(',')` looks right and quietly drops rows. N4 classifies
 * `profile_claimed` with the note "account-level fact, not time-bound" — the
 * comma inside that string produced one value too many, the arity check
 * discarded the row, and the type was reported as unclassified when it had been
 * classified all along. A parser that silently loses input is worse here than
 * no parser, because the failure looks like a real finding.
 */
function splitSqlTuple(body) {
  const out = [];
  let cur = '';
  let inString = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "'") {
      // '' inside a string is an escaped quote, not a terminator.
      if (inString && body[i + 1] === "'") { cur += "''"; i++; continue; }
      inString = !inString;
      cur += ch;
      continue;
    }
    if (ch === ',' && !inString) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(v => v.trim().replace(/^'|'$/g, ''));
}

function policyTypes() {
  const dir = join(HERE, '../../../supabase/migrations');
  const found = new Map();

  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql'))) {
    // ⚠ COMMENTS ARE STRIPPED FIRST, and this is not tidiness. The statement is
    // read up to its terminating `;`, and N4's own explanatory comment contains
    // one — "claim moment worth anything; expiring them would defeat N3" — so
    // parsing the raw text captured the prose and zero rows. It reported every
    // type as unclassified while the classifications sat right there.
    const sql = readFileSync(join(dir, file), 'utf8').replace(/--[^\n]*/g, '');
    const inserts = sql.matchAll(
      /INSERT\s+INTO\s+public\.notification_expiry_policy\s*\(([^)]*)\)\s*VALUES([\s\S]*?);/gi,
    );

    for (const insert of inserts) {
      const cols = insert[1].split(',').map(c => c.trim().toLowerCase());
      const iType = cols.indexOf('type');
      const iPolicy = cols.indexOf('policy');
      if (iType === -1 || iPolicy === -1) continue;

      for (const tuple of insert[2].matchAll(/\(([^)]*)\)/g)) {
        const vals = splitSqlTuple(tuple[1]);
        // Skips the `ON CONFLICT (type)` trailer, which is a parenthesised
        // group in the same statement but not a row.
        if (vals.length !== cols.length) continue;
        found.set(vals[iType], vals[iPolicy]);
      }
    }
  }
  return found;
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
