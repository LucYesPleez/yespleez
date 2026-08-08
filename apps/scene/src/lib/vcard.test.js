/**
 * vCard parsing — regression tests.
 *
 * This is the contact-import path for iOS and desktop, the platforms the
 * Contact Picker does not serve. The failure that matters most is not a crash:
 * it is a number that parses to something PLAUSIBLE BUT WRONG, because that
 * silently matches the user against a stranger, or against nobody, with no
 * error anywhere. Line folding and quoted-printable are the two mechanisms
 * that do exactly that, so both are pinned here against real exporter output
 * rather than idealised vCards.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseVCard } from './vcard.js';

const card = (body) => `BEGIN:VCARD\r\nVERSION:3.0\r\n${body}\r\nEND:VCARD\r\n`;

// ── THE ORDINARY CASE ────────────────────────────────────────────────────

test('a simple card yields one contact', () => {
  assert.deepEqual(
    parseVCard(card('FN:Sarah Chen\r\nTEL;TYPE=CELL:+61412345678')),
    [{ number: '+61412345678', name: 'Sarah Chen' }],
  );
});

test('several cards in one file all come through', () => {
  const text = card('FN:A\r\nTEL:+61400000001') + card('FN:B\r\nTEL:+61400000002');
  assert.deepEqual(parseVCard(text).map(c => c.name), ['A', 'B']);
});

test('one person with several numbers yields one entry per number', () => {
  // Any of them might be the one a friend saved — matching the picker path,
  // which uploads every tel on a contact for the same reason.
  const got = parseVCard(card('FN:Sarah\r\nTEL;TYPE=CELL:+61400000001\r\nTEL;TYPE=HOME:+61299990000'));
  assert.deepEqual(got.map(c => c.number), ['+61400000001', '+61299990000']);
  assert.ok(got.every(c => c.name === 'Sarah'));
});

// ── THE TWO SILENT-CORRUPTION MECHANISMS ─────────────────────────────────

test('⚠ a FOLDED number is rejoined, not truncated', () => {
  // RFC 6350 line folding: a continuation begins with a space. Parsing
  // line-by-line without unfolding truncates the value at the fold, which for
  // a phone number produces a shorter number that is still shaped like one —
  // no error, no match, no clue why.
  const folded = 'BEGIN:VCARD\r\nFN:Sarah\r\nTEL:+6141234\r\n 5678\r\nEND:VCARD\r\n';
  assert.deepEqual(parseVCard(folded), [{ number: '+61412345678', name: 'Sarah' }]);
});

test('a tab continuation folds the same as a space', () => {
  const folded = 'BEGIN:VCARD\r\nFN:S\r\nTEL:+6141234\r\n\t5678\r\nEND:VCARD\r\n';
  assert.equal(parseVCard(folded)[0].number, '+61412345678');
});

test('⚠ quoted-printable names are decoded, not shown as escape codes', () => {
  // vCard 2.1, which many Android and Outlook exports still are, encodes any
  // non-ASCII value. Undecoded, this reaches the user as "Zo=C3=AB" in the
  // "saved as …" line — the one place a contact's own name is shown back.
  const qp = 'BEGIN:VCARD\r\nVERSION:2.1\r\n'
    + 'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Zo=C3=AB\r\n'
    + 'TEL;CELL:+61400000003\r\nEND:VCARD\r\n';
  assert.equal(parseVCard(qp)[0].name, 'Zoë');
});

test('a plain value containing = is left alone', () => {
  // Mutation guard: decoding unconditionally would corrupt ordinary values.
  // Only an ENCODING=QUOTED-PRINTABLE parameter may trigger it.
  assert.equal(parseVCard(card('FN:A=B\r\nTEL:+61400000004'))[0].name, 'A=B');
});

// ── EXPORTER DIALECTS ────────────────────────────────────────────────────

test("Apple's item-group prefix is understood", () => {
  // macOS/iOS Contacts emits `item1.TEL:` for grouped properties. Treating the
  // prefix as part of the property name loses the number entirely — and iOS is
  // the single most important source of these files.
  const apple = card('FN:Sarah\r\nitem1.TEL;type=CELL:+61400000005');
  assert.deepEqual(parseVCard(apple), [{ number: '+61400000005', name: 'Sarah' }]);
});

test('N is used when FN is absent, as "Given Family"', () => {
  assert.equal(parseVCard(card('N:Chen;Sarah;;;\r\nTEL:+61400000006'))[0].name, 'Sarah Chen');
});

test('FN wins over N when both are present', () => {
  assert.equal(
    parseVCard(card('N:Chen;Sarah;;;\r\nFN:Sazza\r\nTEL:+61400000007'))[0].name,
    'Sazza',
  );
});

test('LF-only files parse the same as CRLF', () => {
  assert.equal(parseVCard('BEGIN:VCARD\nFN:S\nTEL:+61400000008\nEND:VCARD\n').length, 1);
});

// ── LENIENCY: A BAD CARD COSTS ONE CONTACT, NEVER THE FILE ───────────────

test('a contact with no number is skipped, and does not take the file with it', () => {
  const text = card('FN:No Number') + card('FN:Has One\r\nTEL:+61400000009');
  assert.deepEqual(parseVCard(text), [{ number: '+61400000009', name: 'Has One' }]);
});

test('a number with no name is kept — the number is what matches', () => {
  assert.deepEqual(parseVCard(card('TEL:+61400000010')), [{ number: '+61400000010', name: null }]);
});

test('a final card missing END:VCARD is still kept', () => {
  // Truncated exports are common and the last contact is a real person.
  assert.equal(parseVCard('BEGIN:VCARD\r\nFN:S\r\nTEL:+61400000011\r\n').length, 1);
});

test('⚠ an unterminated card does not bleed its name into the next one', () => {
  // BEGIN resets rather than flushes. Without that, "Ghost" would attach to
  // the following card's number and the user would see a match "saved as"
  // entirely the wrong person.
  const text = 'BEGIN:VCARD\r\nFN:Ghost\r\nBEGIN:VCARD\r\nFN:Real\r\nTEL:+61400000012\r\nEND:VCARD\r\n';
  assert.deepEqual(parseVCard(text), [{ number: '+61400000012', name: 'Real' }]);
});

test('junk input yields nothing rather than throwing', () => {
  for (const bad of ['', null, undefined, 'not a vcard at all', 'BEGIN:VCARD']) {
    assert.deepEqual(parseVCard(bad), []);
  }
});
