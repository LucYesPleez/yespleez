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

test('an accepted INCOMING enquiry names the venue\'s next move', () => {
  const incoming = nextSteps('incoming');
  assert.match(incoming, /accepted:\s*'Next: add this act to an event\.'/,
    'the venue is no longer told what to do with an act it just accepted');
});

test('⛔⛔ an accepted OUTGOING enquiry never asks the performer to make the event', () => {
  const outgoing = nextSteps('outgoing');
  assert.match(outgoing, /accepted:\s*'Waiting for the host to add you to an event\.'/);
  assert.doesNotMatch(outgoing, /create/i,
    'the performer is being pointed at event creation, which the role rule forbids');
});

test('⛔⛔ ADD TO EVENT is gated on the VIEWER being a venue or host, not on direction', () => {
  // An artist can hold an INCOMING enquiry — a venue invite is incoming to the
  // act — so a direction-only gate would hand a DJ an event picker.
  assert.match(CARD, /EVENT_OWNER_TYPES\s*=\s*new Set\(\['venue',\s*'host'\]\)/);
  assert.match(CARD, /canAddToEvent[\s\S]{0,220}EVENT_OWNER_TYPES\.has\(viewerProfile\?\.type\)/,
    'the event picker is not gated on the viewer being an event owner');
  assert.match(CARD, /canAddToEvent[\s\S]{0,220}displayStatus === 'accepted'/);
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
