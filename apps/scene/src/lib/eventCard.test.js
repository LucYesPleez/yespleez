/**
 * SHARING AN EVENT INTO A CONVERSATION — the payload contract.
 *
 * ⚠⚠ THE CARD IS BUILT FROM THE VIEW MODEL, NOT THE EVENT ROW, and these tests
 * exist mostly to keep it that way. The first version read the row: it invented
 * a `start_at` column that does not exist (the date lives in `config`), and it
 * would have read the venue name straight past the WITHHELD check the event
 * page performs. The card renders with no permission check of its own, so every
 * value in it must arrive already vetted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventCardBody, eventCardPayload, readEventCard, cardWhen,
} from './eventCard.js';

/** The shape `eventViewModel` returns, trimmed to what the card reads. */
const VM = {
  name: 'The Jungle Giants',
  identity: {
    // ⚠ ISO, because that is what is actually stored in `config` — the display
    // form "15 Aug 2026" is produced by lib/dates, never held. An earlier
    // version of this fixture used the display form and made the card look
    // correct in a test while it emitted "Invalid Date" against real data.
    when: { date: '2026-08-15', startTime: '8:00pm' },
    where: { venue: 'Hoey Moey', locality: 'Coffs Harbour', state: 'NSW' },
  },
  hero: { cover: { url: 'https://cdn.test/cover.webp' }, poster: null },
};

test('the body is legible on its own', () => {
  // M9a: three surfaces only ever see `body` — the inbox preview, a push
  // notification and a screen reader.
  assert.equal(eventCardBody(VM), 'The Jungle Giants — 15 Aug 2026 · 8:00pm');
});

test('a nameless event still produces a non-blank body', () => {
  // `messages_body_not_blank` would reject the insert outright.
  assert.equal(eventCardBody({}).trim().length > 0, true);
  assert.equal(eventCardBody(null).trim().length > 0, true);
});

test('⚠ THE DATE USES THE APP\'S OWN FORMATTER, NOT A SECOND ONE', () => {
  // The stored value is ISO. Emitting it raw put "2026-08-15" in a chat next
  // to an event page reading "15 Aug 2026" — this asserts they now agree.
  assert.equal(cardWhen(VM), '15 Aug 2026 · 8:00pm');
  // Date with no time is normal and must not produce a dangling separator.
  assert.equal(cardWhen({ identity: { when: { date: '2026-08-15' } } }), '15 Aug 2026');
  // A time with no date says nothing useful, so it says nothing.
  assert.equal(cardWhen({ identity: { when: { startTime: '8:00pm' } } }), '');
  assert.equal(cardWhen({}), '');
  assert.equal(cardWhen(null), '');
});

test('⛔⛔ A WITHHELD VENUE IS NEVER PUT IN THE CARD', () => {
  // eventViewModel returns `where.venue: null` when the event hides its venue.
  // The card must carry that null through — it renders past every check, so a
  // venue copied in here would be visible to someone the event page refuses.
  const withheld = { ...VM, identity: { ...VM.identity, where: { venue: null, locality: 'Coffs Harbour' } } };
  const p = eventCardPayload('evt-1', withheld);
  assert.equal(p.snapshot.venue, null,
    'This is the privacy bug the row-reading version would have shipped.');
});

test('the payload keeps the id and a vetted snapshot', () => {
  const p = eventCardPayload('evt-1', VM);
  assert.equal(p.eventId, 'evt-1');
  assert.equal(p.snapshot.name, 'The Jungle Giants');
  assert.equal(p.snapshot.venue, 'Hoey Moey');
  assert.equal(p.snapshot.when, '15 Aug 2026 · 8:00pm');
  assert.equal(p.snapshot.cover, 'https://cdn.test/cover.webp');
});

test('the poster stands in when there is no cover', () => {
  const p = eventCardPayload('e', { ...VM, hero: { cover: null, poster: { url: 'p.webp' } } });
  assert.equal(p.snapshot.cover, 'p.webp');
});

test('⛔ THE SNAPSHOT CARRIES ONLY THESE FOUR FIELDS', () => {
  // A new key here must be justified as public AND as already-vetted by the
  // view model. This test is the moment that question gets asked.
  assert.deepEqual(
    Object.keys(eventCardPayload('e', VM).snapshot).sort(),
    ['cover', 'name', 'venue', 'when'],
  );
});

test('an event with no id cannot be shared', () => {
  assert.equal(eventCardPayload(null, VM), null);
});

test('⚠ a malformed payload reads as null rather than throwing', () => {
  // A renderer that throws takes the whole conversation down, not one bubble.
  assert.equal(readEventCard({ payload: null }), null);
  assert.equal(readEventCard({ payload: 'nonsense' }), null);
  assert.equal(readEventCard({ payload: {} }), null);
  assert.equal(readEventCard({ payload: { eventId: 42 } }), null);
  assert.equal(readEventCard(undefined), null);
});

test('a card with an id but a broken snapshot still resolves', () => {
  const card = readEventCard({ payload: { eventId: 'evt-9', snapshot: 'not-an-object' } });
  assert.equal(card.eventId, 'evt-9');
  assert.equal(card.name, null);
  assert.equal(card.venue, null);
});

test('non-string and empty snapshot fields are refused, not coerced', () => {
  const card = readEventCard({ payload: { eventId: 'e', snapshot: { name: { evil: true }, venue: 12, when: '   ' } } });
  assert.equal(card.name, null);
  assert.equal(card.venue, null, 'Coercing would render "[object Object]" into the thread.');
  assert.equal(card.when, null, 'Whitespace is absent, not a value — the line is omitted, never blank.');
});
