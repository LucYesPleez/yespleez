import { test } from 'node:test';
import assert from 'node:assert/strict';

import { offerMessage, offerTarget } from './eventOffer.js';

const base = {
  eventName: 'Bass Heavy',
  date: '2026-10-03',
  venue: 'The Federal',
  url: 'https://yespleez.pages.dev/#/event/e-1',
};

test('the message greets them, names the event, and ends with the link', () => {
  const m = offerMessage({ ...base, toName: 'Madds' });
  assert.match(m, /^Hey Madds!/);
  assert.match(m, /Bass Heavy/);
  assert.match(m, /3 Oct 2026/);
  assert.match(m, /The Federal/);
  assert.ok(m.trimEnd().endsWith(base.url), 'the link must be last so it linkifies');
});

/**
 * ⚠ A host copying a link to POST somewhere has nobody to greet, and
 * "Hey there!" reads worse than no greeting at all.
 */
test('⛔ no name means no greeting, ⛔ not an empty one', () => {
  const m = offerMessage(base);
  assert.doesNotMatch(m, /Hey/);
  assert.doesNotMatch(m, /undefined|null/);
  assert.match(m, /^You are invited/);
});

test('⚠ missing date or venue leaves no dangling words', () => {
  const m = offerMessage({ eventName: 'Bass Heavy', url: base.url });
  assert.doesNotMatch(m, / on \n| at \n|  /);
  assert.doesNotMatch(m, /undefined|null/);
  assert.match(m, /play at Bass Heavy\./);
});

/**
 * ⛔⛔ THE TWO THINGS V1 DID THAT THIS DELIBERATELY DOES NOT (owner,
 * 2026-08-17). A claim code is a second identity system; a slot promise cannot
 * stay true while the host is still moving the running order around.
 */
test('⛔⛔ the offer carries NO claim code and NO slot', () => {
  const m = offerMessage({ ...base, toName: 'Madds' });
  assert.doesNotMatch(m, /code/i);
  assert.doesNotMatch(m, /slot/i);
  assert.doesNotMatch(m, /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i, 'no set time is promised');
});

test('the copy carries no em dashes, whatever it is pasted into', () => {
  assert.doesNotMatch(offerMessage({ ...base, toName: 'Madds' }), /—/);
  assert.doesNotMatch(offerMessage(base), /—/);
});

test('the share target carries the whole message, not just the link', () => {
  const t = offerTarget({ ...base, toName: 'Madds' });
  assert.equal(t.url, base.url);
  assert.match(t.preview, /Hey Madds!/);
  assert.match(t.preview, /yespleez/);
  assert.equal(t.type, 'event_offer');
});

/**
 * ⛔⛔ THE GREETING RAN INTO THE SENTENCE. Assembled with `join('')`, it shipped
 * `Hey Gravid!You are invited` — spotted on screen, ⛔ not by any test above,
 * which is why this one exists.
 */
test('⛔⛔ there is a space after the greeting', () => {
  const m = offerMessage({ ...base, toName: 'Gravid' });
  assert.match(m, /^Hey Gravid! You are invited/);
  assert.doesNotMatch(m, /![A-Za-z]/, 'nothing may butt up against an exclamation mark');
});

/**
 * ⭐ A HUMAN DATE. `events.config.date` is stored `2026-10-03`, and a message a
 * host sends to an artist must not read like a database row.
 */
test('the stored date is formatted, ⛔ not pasted raw', () => {
  const m = offerMessage({ eventName: 'Bass Heavy', date: '2026-10-03', url: base.url });
  assert.doesNotMatch(m, /2026-10-03/);
  assert.match(m, /3 Oct 2026/);
});

/* ⚠ The date is LOCAL. A UTC parse of a bare YYYY-MM-DD lands on the previous
   day for every AU morning, which would invite people to the wrong night. */
test('⛔ the date does not shift a day', () => {
  assert.match(offerMessage({ eventName: 'X', date: '2026-01-01', url: 'u' }), /1 Jan 2026/);
});

test('⛔ a date that is not YYYY-MM-DD never prints as "Invalid Date"', () => {
  const m = offerMessage({ eventName: 'X', date: 'next Friday', url: 'u' });
  assert.doesNotMatch(m, /invalid/i);
  assert.match(m, /on next Friday/, 'worse-looking and still true beats confidently wrong');
});
