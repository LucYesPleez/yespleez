/**
 * ⛔ NO IDENTITY MAY BORROW ANOTHER'S — owner's rule, 2026-08-06:
 *
 *   · if an identity has a default image, use it
 *   · if it does not, render no image
 *   · never pretend another identity's default image belongs to it
 *
 * 10F introduced `profileIdentity()` and `UNKNOWN_PROFILE` to end the
 * hand-written `PROFILE_TYPES[t] || PROFILE_TYPES.artist` fallback, which its
 * own comment records as having been "copy-pasted across cards, screens and
 * editors — each copy free to pick a different (and differently wrong)
 * fallback". Ten copies survived that pass: three borrowing a whole identity
 * and seven borrowing just the photo.
 *
 * They were invisible for a year because every profile type happened to own
 * artwork, so the fallback never fired. `festival` arrived without a WebP and
 * they all fired at once — a festival rendered in cyan, labelled "DJ / PROD.",
 * wearing a DJ's placeholder face. Nothing logged. Nothing looked broken. It
 * looked like a DJ.
 *
 * ⚠ A BLANK IS SAFE; A STRANGER'S PHOTO IS NOT. Absence reads as missing, which
 * is true. Another identity's artwork reads as this identity, which is a lie —
 * and the lie is what this test exists to keep out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Dashboards legitimately theme themselves from a type they are GIVEN, and
 * fall back to venue as a house default rather than as a guess about somebody's
 * identity. Named, not silently skipped — if either grows into rendering a
 * profile that isn't the dashboard's own, it belongs under the rule.
 */
const HOUSE_DEFAULTS = new Set([
  join('components', 'DashboardHeader.jsx'),
  join('components', 'DashboardProfileCard.jsx'),
]);

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { out.push(...sourceFiles(full)); continue; }
    if (/\.jsx?$/.test(entry) && !/\.test\.jsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Prose is how this file and profileTypes.js explain the defect, and a comment
 * quoting the bad pattern must not read as the bad pattern.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')  // block comments, including JSX {/* … */}
    .replace(/^\s*\/\/.*$/gm, '');     // whole-line comments
}

/**
 * ⚠ BOTH HALVES ARE REQUIRED, and the second half alone is NOT a defect.
 *
 * `vp.avatar || PROFILE_TYPES.venue.defaultImage` in a venue-only component is
 * correct — a venue falling back to a VENUE's artwork is an identity using its
 * own. BookingInvitation and OpportunityCard both do exactly that and are fine.
 *
 * The defect is a DYNAMIC lookup rescued by a HARDCODED type: whatever this
 * profile is, if I don't recognise it, treat it as a DJ. That is the line that
 * renders a festival in cyan.
 */
const DYNAMIC_LOOKUP = /PROFILE_TYPES\s*\[|\?\.\s*defaultImage/;
const HARDCODED_RESCUE = /\|\|\s*PROFILE_TYPES\.\w+/;

test('no file rescues an unknown type with a hardcoded identity', () => {
  const offenders = [];

  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    if (HOUSE_DEFAULTS.has(rel)) continue;

    for (const line of stripComments(readFileSync(file, 'utf8')).split('\n')) {
      const code = line.trim();
      if (!code) continue;
      if (DYNAMIC_LOOKUP.test(code) && HARDCODED_RESCUE.test(code)) {
        offenders.push(`${rel} → ${code}`);
      }
    }
  }

  assert.deepEqual(offenders, [],
    'This borrows another profile type\'s identity as a fallback. An ' +
    'unrecognised or artwork-less type will render AS that type — the wrong ' +
    'colour, the wrong label, and a stranger\'s face — with nothing in the ' +
    'console. Use profileIdentity(type) for tokens, which returns ' +
    'UNKNOWN_PROFILE, and <ProfileAvatar> for pictures, which renders a tinted ' +
    'initial when there is no artwork.');
});

test('the avatar component is the only place a missing picture is decided', () => {
  // Not about aesthetics: seven call sites each free to invent their own
  // "what if there is no image" is precisely how seven of them ended up
  // inventing the same wrong one.
  const offenders = [];

  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    if (rel === join('components', 'ProfileAvatar.jsx')) continue;
    const source = readFileSync(file, 'utf8');
    if (/<img[^>]*\bsrc=\{[^}]*\bdefaultImage\b[^}]*\|\|/.test(source)) {
      offenders.push(rel);
    }
  }

  assert.deepEqual(offenders, [],
    'An <img> here chains a fallback after defaultImage. Render <ProfileAvatar> ' +
    'instead — it owns that decision once, so the next identity added to the ' +
    'platform needs no call-site change.');
});
