import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ⛔⛔ ROLE OWNERSHIP — EVENT CREATION. Ratified by the owner, 2026-08-31.
 *
 *   An accepted enquiry does NOT transfer event ownership.
 *   Venues and Hosts/Promoters create events; performers are ADDED to them.
 *
 * The failure this guards against is not a crash — it is the product quietly
 * turning an artist into a promoter because they accepted a booking. That is
 * invisible in a screenshot of the happy path and would be found, if ever, by
 * a confused DJ being asked to create the night they were booked for.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));
const read = rel => readFileSync(`${SRC}/${rel}`, 'utf8');

const CARD   = read('components/EnquiryCard.jsx');
const PANEL  = read('components/EnquiryPanel.jsx');
const ARTIST = read('screens/ArtistDashboard.jsx');
const VENUE  = read('screens/VenueDashboard.jsx');
const HOST   = read('screens/HostDashboard.jsx');

/**
 * The map of "what happens next", parsed from the card's own source.
 *
 * ⚠ COMMENTS STRIPPED, and this is not incidental. The block explaining WHY a
 * performer is never sent to event creation necessarily contains the words
 * "CREATE EVENT", so the first version of this test failed on its own
 * documentation — the same trap `preSendCheckContract` records. Assert against
 * CODE; prose is allowed to name the thing it forbids.
 */
function nextSteps(direction) {
  const start = CARD.indexOf(`  ${direction}: {`);
  assert.ok(start > 0, `NEXT_STEPS.${direction} is gone`);
  return CARD.slice(start, CARD.indexOf('\n  }', start))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * ⭐⭐ SUPERSEDED 2026-08-31 (same day): the accepted copy is DERIVED, because
 * it depends on who owns event creation and on whether an event exists — see
 * lib/enquiryNextStep and its tests, which hold the ratified table.
 *
 * A hard-coded `accepted:` string is now a REGRESSION, not a fix: the first
 * version told a venue to "add this act to an event" when no event existed,
 * which is an instruction that cannot be followed. That is the confusion a
 * real venue reported.
 */
test('⛔ neither direction hard-codes the accepted copy any more', () => {
  for (const dir of ['incoming', 'outgoing']) {
    assert.doesNotMatch(nextSteps(dir), /accepted:/,
      `NEXT_STEPS.${dir} has re-grown a static accepted string — it cannot express who acts`);
  }
  assert.match(CARD, /acceptedNextStep\(\{/, 'the card no longer derives the accepted block');
});

test('⛔⛔ the performer is never pointed at event creation', () => {
  const model = read('lib/enquiryNextStep.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.match(model, /EVENT_OWNER_PRIORITY\s*=\s*\['host',\s*'venue'\]/,
    'the set of types that may own an event has changed');
  for (const performer of ['artist', 'band', 'standup']) {
    assert.doesNotMatch(model, new RegExp(`'${performer}'`),
      `${performer} appears in the ownership model, which can only be to give it an event`);
  }
});

test('⛔⛔ the event action is gated on the VIEWER being a venue or host, not on direction', () => {
  // An artist can hold an INCOMING enquiry — a venue invite is incoming to the
  // act — so a direction-only gate would hand a DJ an event picker.
  assert.match(CARD, /EVENT_OWNER_TYPES\s*=\s*new Set\(\['venue',\s*'host'\]\)/);
  assert.match(CARD, /eventAction[\s\S]{0,260}EVENT_OWNER_TYPES\.has\(viewerProfile\?\.type\)/,
    'the event action is not gated on the viewer being an event owner');
});

test('⭐ MESSAGE is offered on every accepted enquiry, to both sides', () => {
  // The waiting party gets no workflow button, so this is their only action —
  // and it must reach the chat directly, not a sheet containing another button.
  assert.match(CARD, /accepted && \(\s*<button[\s\S]{0,400}openChat/,
    'the accepted block no longer offers MESSAGE');
  assert.match(CARD, /open:\s*openConversation/,
    'the card must RENAME `open` — the context has no `openConversation` key');
});

test('the picker reuses the existing artist → event path rather than a second one', () => {
  assert.match(CARD, /import ShortlistToEventSheet from '\.\/ShortlistToEventSheet'/);
  const sheet = read('components/ShortlistToEventSheet.jsx');
  assert.match(sheet, /ownedByFilter/,
    'the event list must be scoped to events this viewer owns or manages');
});

/**
 * ⭐ THE CAPABILITY IS ABSENT ON THE PERFORMER SURFACE, not merely hidden.
 * Same discipline as the availability calendar's private `markers`: a screen
 * that must never offer this simply does not pass what it needs.
 */
test('⛔ the artist dashboard hands the enquiry panel no account id', () => {
  assert.doesNotMatch(ARTIST, /viewerUserId/,
    'the performer dashboard is feeding the event picker its account id');
});

test('the venue and host dashboards do pass it', () => {
  for (const [name, src] of [['VenueDashboard', VENUE], ['HostDashboard', HOST]]) {
    assert.match(src, /viewerUserId=\{userId\}/, `${name} cannot offer ADD TO EVENT`);
  }
  assert.match(PANEL, /viewerUserId/, 'the panel drops the prop before the card sees it');
});
