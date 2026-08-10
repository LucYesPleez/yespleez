import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * D1 — ACCEPTING AN INVITE MUST KEEP THE ACT THAT WAS INVITED.
 *
 * An invitation names exactly one act. `InviteSheet` writes it as the
 * notification's `to_profile_id`, and `venue_enquiries.applicant_profile_id`
 * holds the same value.
 *
 * ⚠ `acceptInvite` used to ignore both and re-derive from the ACCOUNT, via
 * `resolvePerformerProfileId` — which correctly refuses to guess when an
 * account owns several performer profiles (U4) and returns NULL. So a person
 * with a DJ act and a band who accepted an invite got an application
 * attributed to NOBODY: missing from their dashboard, which reads by profile,
 * and unattributable for the host.
 *
 * It picked ambiguity up from the account when the invitation had already
 * resolved it. ⚠ P11 made multi-act accounts a first-class case, so it was
 * getting more likely, not less.
 */

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const ACTIONS = read('./notifActions.js');
const PANEL   = read('../components/NotifPanel.jsx');
const SCREEN  = read('../screens/NotificationsScreen.jsx');

const acceptFn = (() => {
  const from = ACTIONS.indexOf('export async function acceptInvite');
  return ACTIONS.slice(from, ACTIONS.indexOf('\n}', from));
})();

test('acceptInvite accepts the invited profile as an argument', () => {
  assert.match(ACTIONS, /export async function acceptInvite\(data, userId, invitedProfileId = null\)/);
});

test('the invited profile is USED, not re-derived, when present', () => {
  assert.match(acceptFn, /let profileId = invitedProfileId \?\? null;/,
    'the passed-in profile is ignored');
  // The account lookup must be reachable ONLY when nothing was passed.
  assert.match(acceptFn, /if \(!profileId\) \{[\s\S]{0,400}resolvePerformerProfileId\(userId\)/,
    'the account lookup runs unconditionally and can still overwrite a known answer');
});

test('the legacy fallback survives for old invites', () => {
  // Invitations written before the id was guaranteed have no to_profile_id;
  // they must still resolve as before rather than failing.
  assert.match(acceptFn, /resolvePerformerProfileId\(userId\)/);
  assert.match(acceptFn, /ambiguous/,
    'the fallback no longer reports that it declined to guess');
});

test('both call sites pass the notification\'s to_profile_id', () => {
  for (const [name, src] of [['NotifPanel', PANEL], ['NotificationsScreen', SCREEN]]) {
    assert.match(src, /acceptInvite\(data, userId, notif\.to_profile_id \?\? null\)/,
      `${name} still calls acceptInvite without the invited profile`);
  }
});

/**
 * The application row and the notification that announces it must name the SAME
 * act. They are written from one resolved value for that reason — resolving
 * twice is how they diverge.
 */
test('the application and the acceptance notice use one resolved profile', () => {
  assert.match(acceptFn, /from_profile_id:\s*profileId \?\? null/);
  assert.match(acceptFn, /aboutProfileId:\s*profileId \?\? null/);
});
