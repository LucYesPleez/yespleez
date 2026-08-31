import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ⭐⭐ WHICH OF MY PROFILES AM I SPEAKING AS?
 *
 * A conversation is between PROFILES, and when BOTH belong to one account the
 * drawer cannot work out which side is "you". It used to take the first
 * profile the account could act as, so pressing MESSAGE on a host dashboard
 * could seat the reader as their VENUE, talking to their own host — the
 * identity silently flipped, and the surface that knew the answer had thrown
 * it away.
 *
 * ⛔⛔ THE HINT IS NOT A GRANT. It is honoured only when it names a profile
 * `actableProfileIds` already returned — §A4, ownership is asked, never
 * computed in the client.
 *
 * ⚠ Two different accounts can never hit this: `mineSet` only ever holds
 * profiles the reader can act as. That is why it survived — it is invisible
 * unless one person owns both ends.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));
const read = rel => readFileSync(`${SRC}/${rel}`, 'utf8');

const VIEW    = read('components/ConversationView.jsx');
const UI      = read('lib/conversationUi.jsx');
const DOSSIER = read('components/EnquiryDossierSheet.jsx');
const CARD    = read('components/EnquiryCard.jsx');
const PROFILE = read('screens/ProfileScreen.jsx');

test('the drawer keeps a place for the identity it was opened as', () => {
  assert.match(UI, /asProfileId:\s*null/, 'the preserved state no longer carries asProfileId');
  assert.match(UI, /if \(seed\?\.asProfileId\) st\.asProfileId = seed\.asProfileId;/,
    'open() drops the hint the caller passed');
});

test('⭐ the opener\'s identity is preferred over the fallback', () => {
  const block = VIEW.slice(VIEW.indexOf('const hinted'), VIEW.indexOf('setMine(mineSet)'));
  assert.ok(block.length > 0, 'the sender resolution has been rewritten — re-read this test');
  assert.match(block, /getState\(conversationId\)\.asProfileId/);
  // The hint is FIRST in the chain, or it is not a preference at all.
  assert.ok(block.indexOf('hinted') < block.indexOf("type === 'punter'"),
    'the punter fallback runs before the explicit hint, so the hint cannot win');
});

test('⛔⛔ the hint is refused unless ownership already returned that profile', () => {
  const block = VIEW.slice(VIEW.indexOf('const hinted'), VIEW.indexOf('setMine(mineSet)'));
  assert.match(block, /hinted[\s\S]{0,140}mineSet\.has\(p\.profile_id\)/,
    'an opener could assert an identity the account does not hold');
});

test('the fallbacks survive — the inbox passes no hint at all', () => {
  const block = VIEW.slice(VIEW.indexOf('const hinted'), VIEW.indexOf('setMine(mineSet)'));
  assert.match(block, /type === 'punter'/, 'note-keeping no longer puts Personal on your side');
  assert.match(block, /\?\?\s*participants\.find\(p => mineSet\.has\(p\.profile_id\)\)/,
    'the last-resort fallback is gone, so a hintless open could resolve to nobody');
});

test('every surface that KNOWS the acting identity now states it', () => {
  for (const [name, src, expected] of [
    ['EnquiryDossierSheet', DOSSIER, /asProfileId:\s*viewerProfile\.id/],
    ['EnquiryCard',         CARD,    /asProfileId:\s*viewerProfile\.id/],
    // The clearest case: the person was ASKED which profile speaks and answered.
    ['ProfileScreen',       PROFILE, /asProfileId:\s*fromProfileId/],
  ]) {
    assert.match(src, expected, `${name} still throws away the identity it opened as`);
  }
});
