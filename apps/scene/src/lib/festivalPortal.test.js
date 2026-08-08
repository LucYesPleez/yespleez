/**
 * ONE APPLICATION PIPELINE — owner's ruling, 2026-08-06:
 *
 *   "A user should never be able to apply through the wrong application."
 *
 * Scene's apply writes `applications`. The Festival Portal's dashboard reads
 * `festival_applications`. They are different tables, so an applicant who used
 * Scene's form on a festival's event would submit into a table the organiser's
 * dashboard never opens — no error, no warning, no trace. The application is
 * simply gone, and the first person to notice is the applicant who never hears
 * back.
 *
 * ⚠ THE REAL RISK IS A THIRD APPLY SURFACE. There were already TWO independent
 * ones when this landed — EventScreen builds an ApplyButton for the new event
 * page, EventPublicView builds another for the older one — and neither knew
 * about the other. A third gets added the same way, and the fix silently only
 * covers two thirds of the app.
 *
 * So the assertion is structural: any file that renders ApplyButton must also
 * consult `applicationsBelongToFestival`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationsBelongToFestival } from './festivalPortal.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { out.push(...sourceFiles(full)); continue; }
    if (/\.jsx?$/.test(entry) && !/\.test\.jsx?$/.test(entry)) out.push(full);
  }
  return out;
}

test('a festival-owned event defers; everything else does not', () => {
  assert.equal(applicationsBelongToFestival({ type: 'festival' }), true);
  for (const type of ['host', 'venue', 'artist', 'band', 'standup', 'punter']) {
    assert.equal(applicationsBelongToFestival({ type }), false,
      `${type} events must keep Scene's own apply flow`);
  }
});

test('an unknown or missing owner keeps Scene\'s flow', () => {
  // Deferring on absent data would be the worse failure: the event would send
  // applicants to a Portal that has never heard of it, and Scene's working
  // pipeline would be switched off on the strength of a failed profile fetch.
  for (const owner of [null, undefined, {}, { type: null }, { type: '' }]) {
    assert.equal(applicationsBelongToFestival(owner), false);
  }
});

test('the public is never sent to the Portal to apply', () => {
  // Owner reversed the hand-off on 2026-08-06: applying happens in Scene, on
  // the normal event page. The Portal is the ORGANISER's tool and the public
  // does not need to know it exists — so no punter-facing surface may build a
  // Portal URL. The role picker's FESTIVAL card is the one legitimate crossing,
  // and it is reached through Industry.
  const src = readFileSync(join(SRC, 'lib', 'festivalPortal.js'), 'utf8');
  assert.doesNotMatch(src, /export\s+function\s+festivalApplyUrl/,
    'festivalApplyUrl is back. Applying belongs in Scene — see ' +
    'screens/event/FestivalApply.jsx.');
});

test('EVERY surface that renders ApplyButton also consults the rule', () => {
  const offenders = [];

  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    const source = readFileSync(file, 'utf8');

    // Rendering it, not merely importing or defining it.
    if (!/<ApplyButton\b/.test(source)) continue;
    if (/applicationsBelongToFestival/.test(source)) continue;

    offenders.push(rel);
  }

  assert.deepEqual(offenders, [],
    'These render Scene\'s apply form without checking whether the Festival ' +
    'app owns the pipeline. On a festival\'s event that writes an application ' +
    'into `applications`, which no festival dashboard reads — it is lost ' +
    'silently. Branch on applicationsBelongToFestival(ownerProfile) and render ' +
    'FestivalApply instead — Scene keeps the applicant, and writes to ' +
    '`festival_applications` rather than its own `applications` table.');
});
